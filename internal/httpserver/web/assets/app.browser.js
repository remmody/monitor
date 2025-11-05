// internal/httpserver/web/assets/app.browser.js
const messages = require("./telemetry_pb.js");
const services = require("./telemetry_grpc_web_pb.js");

const client = new services.TelemetryClient(window.location.origin, null, null);

// ---------- Formatters ----------
function fmtBytes(x) {
  if (!x) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0,
    n = x;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(1) + " " + u[i];
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

// ---------- ASCII bars (htop-like) ----------
const BAR_W = 28;

function asciiBar(p, w = BAR_W) {
  const pct = Math.max(0, Math.min(100, p || 0));
  const filled = Math.round((pct / 100) * w);

  const gEnd = Math.round(0.6 * w);
  const yEnd = Math.round(0.85 * w);

  const g = Math.max(0, Math.min(filled, gEnd));
  const y = Math.max(0, Math.min(filled - gEnd, yEnd - gEnd));
  const r = Math.max(0, filled - yEnd);
  const d = Math.max(0, w - filled);

  const seg = (ch, n, cls) =>
    n > 0 ? `<span class="${cls}">${ch.repeat(n)}</span>` : "";
  return `[${seg("|", g, "ascii-g")}${seg("|", y, "ascii-y")}${seg(
    "|",
    r,
    "ascii-r"
  )}${seg(".", d, "ascii-d")}]`;
}

// Рендерим CPU: 5 ядер в строчку (как htop)
function renderCpuAscii(cpu) {
  const lines = [];
  const total = cpu ? cpu.getTotalPercent() : 0;

  // Суммарный CPU
  lines.push(`CPU  ${asciiBar(total)} ${total.toFixed(1)}%`);

  if (cpu) {
    const cores = cpu.getCoresList();
    const perRow = 5;
    for (let row = 0; row < Math.ceil(cores.length / perRow); row++) {
      const rowCores = cores.slice(row * perRow, (row + 1) * perRow);
      const rowLines = rowCores.map((c) => {
        const id = typeof c.getId === "function" ? c.getId() : "";
        const p = c.getPercent();
        const label = String(id).padStart(2, " ");
        return `${label} ${asciiBar(p, 20)} ${p.toFixed(1)}%`;
      });
      lines.push(rowLines.join("  "));
    }
  }

  return lines.join("\n");
}

function renderMemAscii(mem) {
  if (!mem) return "";
  const used = fmtBytes(mem.getUsed());
  const total = fmtBytes(mem.getTotal());
  const pct = mem.getUsedPercent();
  return `Mem ${asciiBar(pct)} ${pct.toFixed(1)}% (${used} / ${total})`;
}

function renderSwapAscii(swap) {
  if (!swap) return "";
  const used = fmtBytes(swap.getUsed());
  const total = fmtBytes(swap.getTotal());
  const pct = swap.getUsedPercent();
  return `Swp ${asciiBar(pct)} ${pct.toFixed(1)}% (${used} / ${total})`;
}

function renderFsAscii(fsList) {
  if (!fsList || fsList.length === 0) return "";
  const lines = [];
  fsList.forEach((fs) => {
    const mp = fs.getMountpoint();
    const p = fs.getUsedPercent();
    const used = fmtBytes(fs.getUsed());
    const total = fmtBytes(fs.getTotal());
    const name = (mp || "").slice(0, 14).padEnd(14, " ");
    lines.push(
      `${name} ${asciiBar(p, 22)} ${p.toFixed(1)}% (${used} / ${total})`
    );
  });
  return lines.join("\n");
}

// ---------- UI update ----------
let lastSnapshot = null;

function updateUI(snap) {
  lastSnapshot = snap;

  // Timestamp
  const tsEl = document.getElementById("timestamp");
  const collected =
    typeof snap.getCollectedUnixMs === "function"
      ? snap.getCollectedUnixMs()
      : Date.now();
  if (tsEl) tsEl.textContent = new Date(collected).toLocaleTimeString();

  // Host
  const host = snap.getHost && snap.getHost();
  if (host) {
    const hn = document.getElementById("hostname");
    if (hn) hn.textContent = host.getHostname() || "—";
    const os = document.getElementById("os");
    if (os)
      os.textContent =
        `${host.getOs() || ""} ${host.getPlatform() || ""}`.trim() || "—";
    const up = document.getElementById("uptime");
    if (up) up.textContent = fmtUptime(host.getUptimeSec());
  }

  // Load
  const load = snap.getLoad && snap.getLoad();
  if (load) {
    const el = document.getElementById("load");
    if (el)
      el.textContent = `${load.getLoad1().toFixed(2)} ${load
        .getLoad5()
        .toFixed(2)} ${load.getLoad15().toFixed(2)}`;
  }

  // CPU
  const cpu = snap.getCpu && snap.getCpu();
  if (cpu) {
    const totalEl = document.getElementById("cpu-total");
    if (totalEl) totalEl.textContent = cpu.getTotalPercent().toFixed(1) + "%";

    const mdl = document.getElementById("cpu-model");
    if (mdl)
      mdl.textContent = `${cpu.getModelName()} (${cpu.getLogical()} cores, ${cpu.getPhysical()} phys)`;

    // ASCII CPU
    const elCpu = document.getElementById("cpu-ascii");
    if (elCpu) elCpu.innerHTML = renderCpuAscii(cpu);
  }

  // Memory
  const mem = snap.getMem && snap.getMem();
  const elMem = document.getElementById("mem-ascii");
  if (elMem) elMem.innerHTML = renderMemAscii(mem);

  // Swap
  const swap = snap.getSwap && snap.getSwap();
  const elSwp = document.getElementById("swap-ascii");
  if (elSwp) elSwp.innerHTML = renderSwapAscii(swap);

  // Filesystems
  const fsList = snap.getFilesystemsList ? snap.getFilesystemsList() : [];
  const fsAscii = document.getElementById("fs-ascii");
  if (fsAscii) fsAscii.innerHTML = renderFsAscii(fsList);

  // Disk I/O
  const diskList = snap.getDiskIoList ? snap.getDiskIoList() : [];
  const diskTbody = document.getElementById("disk-io");
  if (diskTbody) {
    diskTbody.innerHTML = "";
    diskList.forEach((d) => {
      const tr = document.createElement("tr");
      tr.className = "border-b border-slate-800";
      tr.innerHTML = `<td class="py-1">${d.getName()}</td>
                      <td class="text-right text-green-400">${fmtBytes(
                        d.getReadBytes()
                      )}</td>
                      <td class="text-right text-red-400">${fmtBytes(
                        d.getWriteBytes()
                      )}</td>`;
      diskTbody.appendChild(tr);
    });
  }

  // Network I/O
  const netList = snap.getNetList ? snap.getNetList() : [];
  const netTbody = document.getElementById("net-io");
  if (netTbody) {
    netTbody.innerHTML = "";
    netList.forEach((n) => {
      const tr = document.createElement("tr");
      tr.className = "border-b border-slate-800";
      tr.innerHTML = `<td class="py-1">${n.getName()}</td>
                      <td class="text-right text-blue-400">${fmtBytes(
                        n.getBytesRecv()
                      )}</td>
                      <td class="text-right text-yellow-400">${fmtBytes(
                        n.getBytesSent()
                      )}</td>
                      <td class="text-right">${n.getPacketsRecv()}</td>
                      <td class="text-right">${n.getPacketsSent()}</td>
                      <td class="text-right text-red-400">${
                        n.getErrin() + n.getErrout()
                      }</td>
                      <td class="text-right text-orange-400">${
                        n.getDropin() + n.getDropout()
                      }</td>`;
      netTbody.appendChild(tr);
    });
  }

  // Temperatures
  const tempList = snap.getTemperaturesList ? snap.getTemperaturesList() : [];
  const tempTbody = document.getElementById("temps");
  const tempsSec = document.getElementById("temps-section");
  if (tempTbody && tempsSec) {
    tempTbody.innerHTML = "";
    if (!tempList || tempList.length === 0) {
      tempsSec.classList.add("hidden");
    } else {
      tempsSec.classList.remove("hidden");
      tempList.forEach((t) => {
        const temp = t.getTemperature();
        const colorClass =
          temp > t.getCritical() && t.getCritical() > 0
            ? "text-red-400"
            : temp > t.getHigh() && t.getHigh() > 0
            ? "text-yellow-400"
            : "text-slate-300";
        const tr = document.createElement("tr");
        tr.className = "border-b border-slate-800";
        tr.innerHTML = `<td class="py-1">${t.getSensorKey()}</td>
                        <td class="text-right ${colorClass}">${temp.toFixed(
          1
        )}</td>
                        <td class="text-right text-slate-500">${t
                          .getHigh()
                          .toFixed(1)}</td>
                        <td class="text-right text-slate-500">${t
                          .getCritical()
                          .toFixed(1)}</td>`;
        tempTbody.appendChild(tr);
      });
    }
  }

  // Top processes
  const procList = snap.getTopProcsList ? snap.getTopProcsList() : [];
  const procTbody = document.getElementById("procs");
  if (procTbody) {
    procTbody.innerHTML = "";
    procList.forEach((p) => {
      const cpuClass =
        p.getCpuPercent() > 50
          ? "text-red-400"
          : p.getCpuPercent() > 20
          ? "text-yellow-400"
          : "text-slate-300";
      const tr = document.createElement("tr");
      tr.className = "border-b border-slate-800 hover:bg-slate-800";
      tr.innerHTML = `<td class="py-1">${p.getPid()}</td>
                      <td class="truncate max-w-[80px]" title="${p.getUsername()}">${p.getUsername()}</td>
                      <td class="text-right ${cpuClass}">${p
        .getCpuPercent()
        .toFixed(1)}</td>
                      <td class="text-right text-blue-400">${p
                        .getMemPercent()
                        .toFixed(1)}</td>
                      <td class="text-right">${fmtBytes(p.getRss())}</td>
                      <td class="text-center text-slate-500">${p.getThreads()}</td>
                      <td class="text-center text-slate-500">${p.getNice()}</td>
                      <td class="text-center text-slate-400">${p.getStatus()}</td>
                      <td class="truncate max-w-[200px]" title="${p.getName()}">${p.getName()}</td>`;
      procTbody.appendChild(tr);
    });
  }
}

// ---------- Stream subscribe ----------
const req = new messages.SubscribeRequest();
req.setIntervalMs(1000);
req.setTopN(50);

const stream = client.subscribeMetrics(req, {});
stream.on("data", (snap) => updateUI(snap));
stream.on("status", (s) => console.log("grpc-web status:", s));
stream.on("error", (e) => console.error("grpc-web error:", e));
stream.on("end", () => console.log("grpc-web end"));
