const messages = require("./telemetry_pb.js");
const services = require("./telemetry_grpc_web_pb.js");

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
  return `[${seg("|", g, "bar-g")}${seg("|", y, "bar-y")}${seg(
    "|",
    r,
    "bar-r"
  )}${seg(" ", d, "bar-d")}]`;
}

function renderCpuAscii(cpu) {
  const lines = [];
  const total = cpu ? cpu.getTotalPercent() : 0;
  lines.push(`CPU  ${asciiBar(total)} ${total.toFixed(1).padStart(6, " ")}%`);
  if (cpu) {
    const cores = cpu.getCoresList();
    const perRow = 5;
    for (let row = 0; row < Math.ceil(cores.length / perRow); row++) {
      const rowCores = cores.slice(row * perRow, (row + 1) * perRow);
      const rowLines = rowCores.map((c) => {
        const id = typeof c.getId === "function" ? c.getId() : "";
        const p = c.getPercent();
        const label = String(id).padStart(2, " ");
        return `${label} ${asciiBar(p, 20)} ${p.toFixed(1).padStart(6, " ")}%`;
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
  return `Mem ${asciiBar(pct)} ${pct
    .toFixed(1)
    .padStart(6, " ")}% (${used} / ${total})`;
}

function renderSwapAscii(swap) {
  if (!swap) return "";
  const used = fmtBytes(swap.getUsed());
  const total = fmtBytes(swap.getTotal());
  const pct = swap.getUsedPercent();
  return `Swp ${asciiBar(pct)} ${pct
    .toFixed(1)
    .padStart(6, " ")}% (${used} / ${total})`;
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
      `${name} ${asciiBar(p, 22)} ${p
        .toFixed(1)
        .padStart(6, " ")}% (${used} / ${total})`
    );
  });
  return lines.join("\n");
}

function updateUI(snap) {
  const tsEl = document.getElementById("timestamp");
  const collected =
    typeof snap.getCollectedUnixMs === "function"
      ? snap.getCollectedUnixMs()
      : Date.now();
  if (tsEl) tsEl.textContent = new Date(collected).toLocaleTimeString();

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

  const load = snap.getLoad && snap.getLoad();
  if (load) {
    const el = document.getElementById("load");
    if (el)
      el.textContent = `${load.getLoad1().toFixed(2)} ${load
        .getLoad5()
        .toFixed(2)} ${load.getLoad15().toFixed(2)}`;
  }

  const cpu = snap.getCpu && snap.getCpu();
  if (cpu) {
    const totalEl = document.getElementById("cpu-total");
    if (totalEl) totalEl.textContent = cpu.getTotalPercent().toFixed(1) + "%";
    const mdl = document.getElementById("cpu-model");
    if (mdl)
      mdl.textContent = `${cpu.getModelName()} (${cpu.getLogical()} cores, ${cpu.getPhysical()} phys)`;
    const elCpu = document.getElementById("cpu-ascii");
    if (elCpu) elCpu.innerHTML = renderCpuAscii(cpu);
  }

  const mem = snap.getMem && snap.getMem();
  const elMem = document.getElementById("mem-ascii");
  if (elMem) elMem.innerHTML = renderMemAscii(mem);

  const swap = snap.getSwap && snap.getSwap();
  const elSwp = document.getElementById("swap-ascii");
  if (elSwp) elSwp.innerHTML = renderSwapAscii(swap);

  const fsList = snap.getFilesystemsList ? snap.getFilesystemsList() : [];
  const fsAscii = document.getElementById("fs-ascii");
  if (fsAscii) fsAscii.innerHTML = renderFsAscii(fsList);

  const diskList = snap.getDiskIoList ? snap.getDiskIoList() : [];
  const diskTbody = document.getElementById("disk-io");
  if (diskTbody) {
    diskTbody.innerHTML = "";
    diskList.forEach((d) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="col-disk">${d.getName()}</td><td class="col-disk-read">${fmtBytes(
        d.getReadBytes()
      )}</td><td class="col-disk-write" style="color: #ef4444">${fmtBytes(
        d.getWriteBytes()
      )}</td>`;
      diskTbody.appendChild(tr);
    });
  }

  const netList = snap.getNetList ? snap.getNetList() : [];
  const netTbody = document.getElementById("net-io");
  if (netTbody) {
    netTbody.innerHTML = "";
    netList.forEach((n) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="col-iface">${n.getName()}</td><td class="col-rx" style="color: #60a5fa">${fmtBytes(
        n.getBytesRecv()
      )}</td><td class="col-tx" style="color: #eab308">${fmtBytes(
        n.getBytesSent()
      )}</td><td class="col-pkts-rx">${n.getPacketsRecv()}</td><td class="col-pkts-tx">${n.getPacketsSent()}</td><td class="col-errs" style="color: #ef4444">${
        n.getErrin() + n.getErrout()
      }</td><td class="col-drop" style="color: #fb923c">${
        n.getDropin() + n.getDropout()
      }</td>`;
      netTbody.appendChild(tr);
    });
  }

  const tempList = snap.getTemperaturesList ? snap.getTemperaturesList() : [];
  const tempTbody = document.getElementById("temps");
  const tempsSec = document.getElementById("temps-section");
  if (tempTbody && tempsSec) {
    tempTbody.innerHTML = "";
    if (!tempList || tempList.length === 0) {
      tempsSec.style.display = "none";
    } else {
      tempsSec.style.display = "";
      tempList.forEach((t) => {
        const temp = t.getTemperature();
        const colorClass =
          temp > t.getCritical() && t.getCritical() > 0
            ? 'style="color: #ef4444"'
            : temp > t.getHigh() && t.getHigh() > 0
            ? 'style="color: #eab308"'
            : "";
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="col-sensor">${t.getSensorKey()}</td><td class="col-temp" ${colorClass}>${temp.toFixed(
          1
        )}</td><td class="col-high" style="color: #94a3b8">${t
          .getHigh()
          .toFixed(1)}</td><td class="col-crit" style="color: #94a3b8">${t
          .getCritical()
          .toFixed(1)}</td>`;
        tempTbody.appendChild(tr);
      });
    }
  }

  const procList = snap.getTopProcsList ? snap.getTopProcsList() : [];
  const procTbody = document.getElementById("procs");
  if (procTbody) {
    procTbody.innerHTML = "";
    procList.forEach((p) => {
      const cpuClass =
        p.getCpuPercent() > 50
          ? 'style="color: #ef4444"'
          : p.getCpuPercent() > 20
          ? 'style="color: #eab308"'
          : "";
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="col-pid">${p.getPid()}</td><td class="col-user">${p.getUsername()}</td><td class="col-cpu" ${cpuClass}>${p
        .getCpuPercent()
        .toFixed(1)}</td><td class="col-mem" style="color: #60a5fa">${p
        .getMemPercent()
        .toFixed(1)}</td><td class="col-rss">${fmtBytes(
        p.getRss()
      )}</td><td class="col-thr">${p.getThreads()}</td><td class="col-ni">${p.getNice()}</td><td class="col-status">${p.getStatus()}</td><td class="col-name">${p.getName()}</td>`;
      procTbody.appendChild(tr);
    });
  }
}

let stream;
let client;
let updateInterval;
let lastUpdateTime = Date.now();
const SLEEP_THRESHOLD = 5000;

function detectSleepAndReconnect() {
  const now = Date.now();
  const timeSinceLastUpdate = now - lastUpdateTime;
  if (timeSinceLastUpdate > SLEEP_THRESHOLD) {
    console.log("🔔 Sleep detected. Reconnecting...");
    reconnectStream();
  }
  lastUpdateTime = now;
}

function stopUpdates() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

function startStream() {
  client = new services.TelemetryClient(window.location.origin, null, null);
  const req = new messages.SubscribeRequest();
  req.setIntervalMs(1000);
  req.setTopN(50);

  stream = client.subscribeMetrics(req, {});
  stream.on("data", (snap) => {
    updateUI(snap);
    lastUpdateTime = Date.now();
  });
  stream.on("error", (e) => {
    console.error("Stream error:", e);
    reconnectStream();
  });
  stream.on("end", () => {
    console.log("Stream ended");
    reconnectStream();
  });
}

function reconnectStream() {
  try {
    if (stream) stream.cancel();
  } catch (e) {
    console.log("Cancel error:", e);
  }
  setTimeout(startStream, 2000);
}

document.addEventListener("DOMContentLoaded", () => {
  startStream();
  updateInterval = setInterval(detectSleepAndReconnect, 5000);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    console.log("👀 Tab visible");
    detectSleepAndReconnect();
  }
});

window.addEventListener("focus", () => {
  console.log("🎯 Focused");
  detectSleepAndReconnect();
});

window.addEventListener("beforeunload", stopUpdates);
