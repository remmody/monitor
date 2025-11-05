// internal/collector/collector.go
package collector

import (
	"context"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
	"github.com/shirou/gopsutil/v4/sensors"

	pb "monitor/internal/telemetry"
)

type Config struct {
	Interval time.Duration
	TopN     int32
}

type Collector struct {
	cfg          Config
	mu           sync.RWMutex
	snapshot     atomic.Pointer[pb.Snapshot]
	
	// Кэш неизменяемых данных
	hostInfoOnce sync.Once
	hostInfo     *host.InfoStat
	cpuInfoOnce  sync.Once
	cpuModel     string
	cpuPhys      uint32
	cpuLogical   uint32
	
	// Дельта для I/O
	prevDiskIO map[string]disk.IOCountersStat
	prevNetIO  map[string]net.IOCountersStat
	
	// Кэш температур (обновляем раз в 10 секунд)
	tempCache     []*pb.Temperature
	tempCacheTime time.Time
	
	// Кэш списка PID (обновляем раз в 3 секунды)
	pidCache     []int32
	pidCacheTime time.Time
	
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func New(cfg Config) *Collector {
	ctx, cancel := context.WithCancel(context.Background())
	
	c := &Collector{
		cfg:        cfg,
		prevDiskIO: make(map[string]disk.IOCountersStat, 8),
		prevNetIO:  make(map[string]net.IOCountersStat, 8),
		ctx:        ctx,
		cancel:     cancel,
	}
	
	// Инициализация первого снимка
	snap := c.collect()
	c.snapshot.Store(snap)
	
	// ЕДИНСТВЕННАЯ фоновая goroutine для сбора
	c.wg.Add(1)
	go c.collectLoop()
	
	return c
}

func (c *Collector) GetSnapshot() *pb.Snapshot {
	return c.snapshot.Load()
}

func (c *Collector) Close() {
	c.cancel()
	c.wg.Wait()
}

func (c *Collector) collectLoop() {
	defer c.wg.Done()
	
	ticker := time.NewTicker(c.cfg.Interval)
	defer ticker.Stop()
	
	for {
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
			snap := c.collect()
			c.snapshot.Store(snap)
		}
	}
}

// ПОЛНОСТЬЮ ПОСЛЕДОВАТЕЛЬНЫЙ сбор - НИ ОДНОЙ goroutine
func (c *Collector) collect() *pb.Snapshot {
	snap := &pb.Snapshot{
		CollectedUnixMs: time.Now().UnixMilli(),
	}
	
	// Все вызовы СТРОГО последовательные
	snap.Host = c.collectHost()
	snap.Load = c.collectLoad()
	snap.Cpu = c.collectCPU()
	snap.Mem, snap.Swap = c.collectMemory()
	snap.Filesystems = c.collectFilesystems()
	snap.DiskIo = c.collectDiskIO()
	snap.Net = c.collectNet()
	snap.Temperatures = c.collectTemperatures()
	snap.TopProcs = c.collectTopProcs()
	
	return snap
}

func (c *Collector) collectHost() *pb.HostInfo {
	c.hostInfoOnce.Do(func() {
		info, _ := host.Info()
		c.hostInfo = info
	})
	
	if c.hostInfo == nil {
		return nil
	}
	
	return &pb.HostInfo{
		Hostname:             c.hostInfo.Hostname,
		Os:                   c.hostInfo.OS,
		Platform:             c.hostInfo.Platform,
		PlatformFamily:       c.hostInfo.PlatformFamily,
		PlatformVersion:      c.hostInfo.PlatformVersion,
		KernelVersion:        c.hostInfo.KernelVersion,
		UptimeSec:            c.hostInfo.Uptime,
		BootTime:             c.hostInfo.BootTime,
		VirtualizationSystem: c.hostInfo.VirtualizationSystem,
		VirtualizationRole:   c.hostInfo.VirtualizationRole,
	}
}

func (c *Collector) collectLoad() *pb.LoadAvg {
	avg, err := load.Avg()
	if err != nil {
		return nil
	}
	
	return &pb.LoadAvg{
		Load1:  avg.Load1,
		Load5:  avg.Load5,
		Load15: avg.Load15,
	}
}

func (c *Collector) collectCPU() *pb.CpuSummary {
	c.cpuInfoOnce.Do(func() {
		infos, _ := cpu.Info()
		if len(infos) > 0 {
			c.cpuModel = infos[0].ModelName
		}
		c.cpuPhys = uint32(runtime.NumCPU())
		counts, _ := cpu.Counts(true)
		c.cpuLogical = uint32(counts)
	})
	
	// 300ms интервал для минимальной нагрузки
	percs, err := cpu.Percent(300*time.Millisecond, true)
	if err != nil {
		return nil
	}
	
	cores := make([]*pb.CpuCore, len(percs))
	var totalPercent float64
	
	for i, p := range percs {
		cores[i] = &pb.CpuCore{
			Id:      uint32(i),
			Percent: p,
			Mhz:     0,
		}
		totalPercent += p
	}
	
	if len(cores) > 0 {
		totalPercent /= float64(len(cores))
	}
	
	return &pb.CpuSummary{
		TotalPercent: totalPercent,
		Cores:        cores,
		Logical:      c.cpuLogical,
		Physical:     c.cpuPhys,
		ModelName:    c.cpuModel,
	}
}

func (c *Collector) collectMemory() (*pb.Mem, *pb.Swap) {
	vmem, err := mem.VirtualMemory()
	if err != nil {
		return nil, nil
	}
	
	swap, err := mem.SwapMemory()
	if err != nil {
		return &pb.Mem{
			Total:       vmem.Total,
			Used:        vmem.Used,
			Free:        vmem.Free,
			Available:   vmem.Available,
			UsedPercent: vmem.UsedPercent,
		}, nil
	}
	
	return &pb.Mem{
			Total:       vmem.Total,
			Used:        vmem.Used,
			Free:        vmem.Free,
			Available:   vmem.Available,
			UsedPercent: vmem.UsedPercent,
		}, &pb.Swap{
			Total:       swap.Total,
			Used:        swap.Used,
			Free:        swap.Free,
			UsedPercent: swap.UsedPercent,
		}
}

func (c *Collector) collectFilesystems() []*pb.FsUsage {
	parts, err := disk.Partitions(false)
	if err != nil {
		return nil
	}
	
	result := make([]*pb.FsUsage, 0, len(parts))
	
	for _, part := range parts {
		usage, err := disk.Usage(part.Mountpoint)
		if err != nil {
			continue
		}
		
		result = append(result, &pb.FsUsage{
			Mountpoint:  part.Mountpoint,
			Fstype:      part.Fstype,
			Total:       usage.Total,
			Used:        usage.Used,
			Free:        usage.Free,
			UsedPercent: usage.UsedPercent,
		})
	}
	
	return result
}

func (c *Collector) collectDiskIO() []*pb.DiskIO {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	counters, err := disk.IOCounters()
	if err != nil {
		return nil
	}
	
	result := make([]*pb.DiskIO, 0, len(counters))
	
	for name, curr := range counters {
		prev, exists := c.prevDiskIO[name]
		if !exists {
			c.prevDiskIO[name] = curr
			continue
		}
		
		result = append(result, &pb.DiskIO{
			Name:       name,
			ReadBytes:  curr.ReadBytes - prev.ReadBytes,
			WriteBytes: curr.WriteBytes - prev.WriteBytes,
			ReadCount:  curr.ReadCount - prev.ReadCount,
			WriteCount: curr.WriteCount - prev.WriteCount,
		})
		
		c.prevDiskIO[name] = curr
	}
	
	return result
}

func (c *Collector) collectNet() []*pb.NetIF {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	counters, err := net.IOCounters(true)
	if err != nil {
		return nil
	}
	
	result := make([]*pb.NetIF, 0, len(counters))
	
	for _, curr := range counters {
		prev, exists := c.prevNetIO[curr.Name]
		if !exists {
			c.prevNetIO[curr.Name] = curr
			continue
		}
		
		result = append(result, &pb.NetIF{
			Name:        curr.Name,
			Hwaddr:      "",
			Addrs:       nil,
			BytesSent:   curr.BytesSent - prev.BytesSent,
			BytesRecv:   curr.BytesRecv - prev.BytesRecv,
			PacketsSent: curr.PacketsSent - prev.PacketsSent,
			PacketsRecv: curr.PacketsRecv - prev.PacketsRecv,
			Errin:       curr.Errin - prev.Errin,
			Errout:      curr.Errout - prev.Errout,
			Dropin:      curr.Dropin - prev.Dropin,
			Dropout:     curr.Dropout - prev.Dropout,
		})
		
		c.prevNetIO[curr.Name] = curr
	}
	
	return result
}

// Кэш температур на 10 секунд
func (c *Collector) collectTemperatures() []*pb.Temperature {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	if time.Since(c.tempCacheTime) < 10*time.Second && c.tempCache != nil {
		return c.tempCache
	}
	
	temps, err := sensors.SensorsTemperatures()
	if err != nil {
		return nil
	}
	
	if len(temps) == 0 {
		return nil
	}
	
	result := make([]*pb.Temperature, len(temps))
	for i, t := range temps {
		result[i] = &pb.Temperature{
			SensorKey:   t.SensorKey,
			Temperature: t.Temperature,
			High:        t.High,
			Critical:    t.Critical,
		}
	}
	
	c.tempCache = result
	c.tempCacheTime = time.Now()
	
	return result
}

// ПОЛНОСТЬЮ ПОСЛЕДОВАТЕЛЬНЫЙ сбор процессов - НИ ОДНОЙ goroutine!
func (c *Collector) collectTopProcs() []*pb.Proc {
	// Кэш списка PID на 3 секунды
	c.mu.Lock()
	if time.Since(c.pidCacheTime) > 3*time.Second {
		pids, err := process.Pids()
		if err == nil {
			c.pidCache = pids
			c.pidCacheTime = time.Now()
		}
	}
	pids := c.pidCache
	c.mu.Unlock()
	
	if len(pids) == 0 {
		return nil
	}
	
	type procData struct {
		pid     int32
		name    string
		user    string
		cpu     float64
		mem     float32
		rss     uint64
		threads int32
		nice    int32
		status  string
	}
	
	procs := make([]procData, 0, len(pids))
	
	// ПОСЛЕДОВАТЕЛЬНЫЙ перебор процессов
	// Ограничиваем максимум 200 процессов для сбора
	maxProcs := 200
	if len(pids) > maxProcs {
		pids = pids[:maxProcs]
	}
	
	for _, pid := range pids {
		p, err := process.NewProcess(pid)
		if err != nil {
			continue
		}
		
		name, _ := p.Name()
		user, _ := p.Username()
		cpuPct, _ := p.CPUPercent()
		memPct, _ := p.MemoryPercent()
		memInfo, _ := p.MemoryInfo()
		numThreads, _ := p.NumThreads()
		nice, _ := p.Nice()
		status, _ := p.Status()
		
		var rss uint64
		if memInfo != nil {
			rss = memInfo.RSS
		}
		
		var statusStr string
		if len(status) > 0 {
			statusStr = string(status[0])
		}
		
		procs = append(procs, procData{
			pid:     pid,
			name:    name,
			user:    user,
			cpu:     cpuPct,
			mem:     memPct,
			rss:     rss,
			threads: numThreads,
			nice:    nice,
			status:  statusStr,
		})
	}
	
	// Сортировка по CPU
	sort.Slice(procs, func(i, j int) bool {
		return procs[i].cpu > procs[j].cpu
	})
	
	// Top N
	topN := int(c.cfg.TopN)
	if len(procs) > topN {
		procs = procs[:topN]
	}
	
	result := make([]*pb.Proc, len(procs))
	for i, p := range procs {
		result[i] = &pb.Proc{
			Pid:        p.pid,
			Name:       p.name,
			Username:   p.user,
			CpuPercent: p.cpu,
			MemPercent: p.mem,
			Rss:        p.rss,
			Nice:       p.nice,
			Threads:    p.threads,
			Status:     p.status,
		}
	}
	
	return result
}
