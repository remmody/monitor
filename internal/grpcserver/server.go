// internal/grpcserver/server.go

package grpcserver

import (
	"net"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"

	"monitor/internal/collector"
	telemetry "monitor/internal/telemetry"
)

type Server struct {
	telemetry.UnimplementedTelemetryServer
	collector *collector.Collector
	srv       *grpc.Server
	lis       net.Listener
}

func New(addr string, coll *collector.Collector) *Server {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		panic(err)
	}

	grpcSrv := grpc.NewServer(
		grpc.MaxConcurrentStreams(100),
		grpc.KeepaliveParams(keepalive.ServerParameters{
			MaxConnectionIdle: 5 * time.Minute,
			Time:              2 * time.Hour,
			Timeout:           20 * time.Second,
		}),
		grpc.MaxRecvMsgSize(1<<20),  // 1MB
		grpc.MaxSendMsgSize(4<<20),  // 4MB
		grpc.NumStreamWorkers(2),
		grpc.ReadBufferSize(32<<10),  // 32KB
		grpc.WriteBufferSize(32<<10),
	)

	s := &Server{
		collector: coll,
		srv:       grpcSrv,
		lis:       lis,
	}

	telemetry.RegisterTelemetryServer(grpcSrv, s)
	return s
}

func (s *Server) Server() *grpc.Server {
	return s.srv
}

func (s *Server) Serve() error {
	return s.srv.Serve(s.lis)
}

func (s *Server) GracefulStop() {
	s.srv.GracefulStop()
}

func (s *Server) Stop() {
	s.srv.Stop()
}

func (s *Server) SubscribeMetrics(
	req *telemetry.SubscribeRequest,
	stream telemetry.Telemetry_SubscribeMetricsServer,
) error {
	interval := time.Duration(req.IntervalMs) * time.Millisecond
	if interval < 100*time.Millisecond {
		interval = 100 * time.Millisecond
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case <-ticker.C:
			snap := s.collector.GetSnapshot()
			if err := stream.Send(snap); err != nil {
				return err
			}
		}
	}
}
