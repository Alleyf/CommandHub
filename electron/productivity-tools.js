const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const util = require("node:util");
const { execFile } = require("node:child_process");
const net = require("node:net");

const execFileAsync = util.promisify(execFile);

// Helper function to sleep for a given number of milliseconds
function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Check if a process is still running
async function isProcessRunning(pid) {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], {
        encoding: "utf8",
        windowsHide: true
      });
      return stdout.includes(String(pid));
    } else {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }
}

// 视频转 GIF 配置
const VIDEO_TO_GIF_DEFAULTS = {
  fps: 10,
  width: 480,
  quality: 5,
  startTime: 0,
  duration: null
};

async function convertVideoToGif(inputPath, outputPath, options = {}) {
  const opts = { ...VIDEO_TO_GIF_DEFAULTS, ...options };
  const { fps, width, quality, startTime, duration } = opts;

  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath)
      .setStartTime(Number(startTime))
      .fps(Number(fps))
      .size(`${Number(width)}x?`)
      .outputOptions([`-loop`, `0`, `-q:v`, `${quality}`]);

    if (duration) {
      command = command.setDuration(Number(duration));
    }

    command
      .output(outputPath)
      .on('end', () => resolve({ success: true, outputPath }))
      .on('error', (err) => reject(err))
      .run();
  });
}

const ACTIVE_WINDOW_POLL_MS = 15000;
const STALE_REMINDER_POLL_MS = 30 * 60 * 1000;
const MAX_SCAN_FILES = 12000;

function nowIso() {
  return new Date().toISOString();
}

function dateKey(value = Date.now()) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeRoots(roots) {
  return [...new Set((Array.isArray(roots) ? roots : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function createDefaultState(app) {
  const downloads = app.getPath("downloads");
  const desktop = app.getPath("desktop");
  const documents = app.getPath("documents");
  return {
    screenUsage: {
      days: {},
      updatedAt: null
    },
    duplicateCleaner: {
      roots: normalizeRoots([desktop, downloads]),
      strategy: "hash",
      lastScanAt: null
    },
    fileExpiry: {
      roots: normalizeRoots([downloads]),
      staleDays: 30,
      archiveDir: path.join(documents, "CommandHub Archive"),
      lastScanAt: null,
      lastReminderAt: null,
      lastReminderCount: 0
    }
  };
}

function mergeState(base, incoming) {
  return {
    ...base,
    ...incoming,
    screenUsage: {
      ...base.screenUsage,
      ...(incoming?.screenUsage || {}),
      days: incoming?.screenUsage?.days || base.screenUsage.days
    },
    duplicateCleaner: {
      ...base.duplicateCleaner,
      ...(incoming?.duplicateCleaner || {}),
      roots: normalizeRoots(incoming?.duplicateCleaner?.roots || base.duplicateCleaner.roots)
    },
    fileExpiry: {
      ...base.fileExpiry,
      ...(incoming?.fileExpiry || {}),
      roots: normalizeRoots(incoming?.fileExpiry?.roots || base.fileExpiry.roots)
    }
  };
}

function clampHistory(days, keep = 14) {
  const sorted = Object.keys(days || {}).sort().reverse();
  const next = {};
  for (const key of sorted.slice(0, keep)) {
    next[key] = days[key];
  }
  return next;
}

function sanitizeFileName(value) {
  return String(value || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 160) || "file";
}

function browserName(appName) {
  return /(chrome|edge|firefox|safari|arc|brave|opera)/i.test(String(appName || ""));
}

function cleanDisplayText(value, fallback = "") {
  const text = String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return String(fallback || "").trim();
  if (text.includes("\uFFFD")) return String(fallback || "").trim();
  const suspicious = (text.match(/[\u00c0-\u024f\u0370-\u03ff\u0590-\u05ff\u0600-\u06ff\u2000-\u206f]/g) || []).length;
  if (suspicious > Math.max(6, Math.floor(text.length * 0.35))) return String(fallback || "").trim();
  return text;
}

function inferWebsiteLabel(snapshot) {
  const title = cleanDisplayText(snapshot?.windowTitle || "", snapshot?.appName || "");
  if (!title) return "";
  if (!browserName(snapshot?.appName)) return "";
  const parts = title.split(/\s[-|]\s/).map((item) => item.trim()).filter(Boolean);
  return cleanDisplayText(parts[0] || title, snapshot?.appName || "");
}

async function getForegroundSnapshot(platform) {
  try {
    if (platform === "win32") {
      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FocusWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$handle = [FocusWindow]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) { return }
$builder = New-Object System.Text.StringBuilder 2048
[void][FocusWindow]::GetWindowText($handle, $builder, $builder.Capacity)
$procId = 0
[void][FocusWindow]::GetWindowThreadProcessId($handle, [ref]$procId)
$process = Get-Process -Id $procId -ErrorAction SilentlyContinue
[PSCustomObject]@{
  appName = if ($process) { $process.ProcessName } else { "" }
  pid = [int]$procId
  windowTitle = $builder.ToString()
} | ConvertTo-Json -Compress
`.trim();
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000
      });
      const parsed = JSON.parse(String(stdout || "{}").trim() || "{}");
      if (!parsed?.appName && !parsed?.windowTitle) return null;
      return {
        appName: parsed.appName || "Unknown App",
        pid: Number(parsed.pid || 0) || null,
        windowTitle: parsed.windowTitle || ""
      };
    }

    if (platform === "darwin") {
      const script = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
end tell
return appName
`.trim();
      const { stdout } = await execFileAsync("osascript", ["-e", script], {
        encoding: "utf8",
        timeout: 10000
      });
      const appName = String(stdout || "").trim();
      if (!appName) return null;
      return {
        appName,
        pid: null,
        windowTitle: ""
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function listFiles(roots) {
  const queue = normalizeRoots(roots);
  const files = [];
  while (queue.length > 0 && files.length < MAX_SCAN_FILES) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      try {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          queue.push(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const stats = fs.statSync(fullPath);
        files.push({
          path: fullPath,
          name: entry.name,
          directory: current,
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
          modifiedAt: stats.mtime.toISOString(),
          accessedAt: stats.atime.toISOString()
        });
      } catch {}
      if (files.length >= MAX_SCAN_FILES) break;
    }
  }
  return {
    files,
    truncated: queue.length > 0
  };
}

function summarizeGroups(groups) {
  const duplicateFileCount = groups.reduce((sum, group) => sum + Math.max(0, group.files.length - 1), 0);
  const wastedBytes = groups.reduce((sum, group) => sum + group.files.slice(1).reduce((groupSum, file) => groupSum + file.size, 0), 0);
  return {
    groupCount: groups.length,
    duplicateFileCount,
    wastedBytes
  };
}

function chooseKeepFile(files, rule = "oldest") {
  const items = [...files];
  items.sort((left, right) => {
    if (rule === "newest") {
      return new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
    }
    return new Date(left.modifiedAt).getTime() - new Date(right.modifiedAt).getTime();
  });
  return items[0] || null;
}

async function scanDuplicateFiles(roots, strategy = "hash") {
  const { files, truncated } = await listFiles(roots);
  const groups = new Map();

  if (strategy === "name") {
    for (const file of files) {
      const key = file.name.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(file);
    }
  } else {
    const sizeBuckets = new Map();
    for (const file of files) {
      const key = `${file.name.toLowerCase()}::${file.size}`;
      if (!sizeBuckets.has(key)) sizeBuckets.set(key, []);
      sizeBuckets.get(key).push(file);
    }

    for (const bucket of sizeBuckets.values()) {
      if (bucket.length < 2 && strategy !== "size") continue;
      if (strategy === "size") {
        const key = `${bucket[0].name.toLowerCase()}::${bucket[0].size}`;
        groups.set(key, bucket);
        continue;
      }
      for (const file of bucket) {
        try {
          const hash = await hashFile(file.path);
          const key = `${file.size}::${hash}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push({ ...file, hash });
        } catch {}
      }
    }
  }

  const normalizedGroups = [...groups.entries()]
    .map(([id, bucket]) => ({ id, files: bucket }))
    .filter((group) => group.files.length > 1)
    .map((group) => {
      const keep = chooseKeepFile(group.files, "oldest");
      return {
        id: group.id,
        key: group.id,
        keepPath: keep?.path || "",
        files: [...group.files].sort((left, right) => new Date(left.modifiedAt).getTime() - new Date(right.modifiedAt).getTime())
      };
    })
    .sort((left, right) => right.files.length - left.files.length);

  return {
    truncated,
    scannedFileCount: files.length,
    strategy,
    groups: normalizedGroups,
    summary: summarizeGroups(normalizedGroups)
  };
}

async function scanStaleFiles(roots, staleDays) {
  const { files, truncated } = await listFiles(roots);
  const cutoff = Date.now() - Math.max(1, Number(staleDays || 30)) * 24 * 60 * 60 * 1000;
  const items = files
    .map((file) => {
      const accessedAt = new Date(file.accessedAt).getTime() || 0;
      const modifiedAt = new Date(file.modifiedAt).getTime() || 0;
      const createdAt = new Date(file.createdAt).getTime() || 0;
      const candidateTimes = [accessedAt, modifiedAt, createdAt].filter(Boolean);
      const lastTouchedAt = candidateTimes.length ? Math.min(...candidateTimes) : Date.now();
      return {
        ...file,
        lastTouchedAt: new Date(lastTouchedAt).toISOString(),
        ageDays: Math.max(0, Math.floor((Date.now() - lastTouchedAt) / (24 * 60 * 60 * 1000)))
      };
    })
    .filter((file) => new Date(file.lastTouchedAt).getTime() <= cutoff)
    .sort((left, right) => right.ageDays - left.ageDays);

  const reclaimableBytes = items.reduce((sum, item) => sum + item.size, 0);
  return {
    truncated,
    scannedFileCount: files.length,
    staleDays: Number(staleDays || 30),
    items,
    summary: {
      staleFileCount: items.length,
      reclaimableBytes
    }
  };
}

function ensureParentDir(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function safeTargetPath(dir, filePath) {
  const base = sanitizeFileName(path.basename(filePath));
  let targetPath = path.join(dir, base);
  let index = 1;
  while (fs.existsSync(targetPath)) {
    const ext = path.extname(base);
    const name = path.basename(base, ext);
    targetPath = path.join(dir, `${name}-${index}${ext}`);
    index += 1;
  }
  return targetPath;
}

async function moveFilesToArchive(paths, archiveDir) {
  const moved = [];
  const targetDir = path.join(archiveDir, dateKey());
  fs.mkdirSync(targetDir, { recursive: true });
  for (const filePath of paths) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const targetPath = safeTargetPath(targetDir, filePath);
      ensureParentDir(targetPath);
      fs.renameSync(filePath, targetPath);
      moved.push({ from: filePath, to: targetPath });
    } catch {}
  }
  return moved;
}

async function deleteFiles(paths) {
  const deleted = [];
  for (const filePath of paths) {
    try {
      if (!fs.existsSync(filePath)) continue;
      fs.unlinkSync(filePath);
      deleted.push(filePath);
    } catch {}
  }
  return deleted;
}

function summarizeUsage(items) {
  return [...items.values()]
    .sort((left, right) => right.durationMs - left.durationMs)
    .map((item) => ({
      ...item,
      durationMs: Number(item.durationMs || 0)
    }));
}

function getOverviewFromState(state, platform) {
  const days = state.screenUsage?.days || {};
  const todayKey = dateKey();
  const today = days[todayKey] || { items: {} };
  const weekKeys = Object.keys(days).sort().slice(-7);
  const weekMap = new Map();
  let weekTotalMs = 0;
  for (const key of weekKeys) {
    const day = days[key] || { items: {} };
    for (const item of Object.values(day.items || {})) {
      weekTotalMs += Number(item.durationMs || 0);
      const current = weekMap.get(item.id) || {
        id: item.id,
        label: cleanDisplayText(item.label, item.appName),
        appName: cleanDisplayText(item.appName, item.label),
        website: cleanDisplayText(item.website || "", ""),
        windowTitle: cleanDisplayText(item.windowTitle || "", item.appName),
        durationMs: 0
      };
      current.durationMs += Number(item.durationMs || 0);
      weekMap.set(item.id, current);
    }
  }

  return {
    screenUsage: {
      supported: platform === "win32" || platform === "darwin",
      today: {
        date: todayKey,
        totalMs: Object.values(today.items || {}).reduce((sum, item) => sum + Number(item.durationMs || 0), 0),
        items: summarizeUsage(new Map(Object.values(today.items || {}).map((item) => [item.id, {
          ...item,
          label: cleanDisplayText(item.label, item.appName),
          appName: cleanDisplayText(item.appName, item.label),
          website: cleanDisplayText(item.website || "", ""),
          windowTitle: cleanDisplayText(item.windowTitle || "", item.appName)
        }]))).slice(0, 12)
      },
      week: {
        days: weekKeys.map((key) => ({
          date: key,
          totalMs: Object.values(days[key]?.items || {}).reduce((sum, item) => sum + Number(item.durationMs || 0), 0)
        })),
        totalMs: weekTotalMs,
        items: summarizeUsage(weekMap).slice(0, 12)
      },
      updatedAt: state.screenUsage?.updatedAt || null
    },
    duplicateCleaner: state.duplicateCleaner,
    fileExpiry: state.fileExpiry
  };
}

const ffmpeg = require('fluent-ffmpeg');

// 端口扫描配置
const PORT_SCAN_DEFAULTS = {
  timeout: 1000,
  concurrentLimit: 50
};

// 常见端口及其服务描述
const COMMON_PORTS = {
  20: "FTP Data",
  21: "FTP Control",
  22: "SSH",
  23: "Telnet",
  25: "SMTP",
  53: "DNS",
  80: "HTTP",
  110: "POP3",
  143: "IMAP",
  443: "HTTPS",
  3306: "MySQL",
  3389: "RDP",
  5432: "PostgreSQL",
  6379: "Redis",
  8080: "HTTP Alt",
  8443: "HTTPS Alt",
  9200: "Elasticsearch",
  27017: "MongoDB"
};

// 扫描单个端口
async function scanPort(host, port, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ port, open: false, service: COMMON_PORTS[port] || "" });
    }, timeout);

    socket.setTimeout(timeout);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ port, open: true, service: COMMON_PORTS[port] || "" });
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ port, open: false, service: COMMON_PORTS[port] || "" });
    });
    socket.once("timeout", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ port, open: false, service: COMMON_PORTS[port] || "" });
    });
    socket.connect(port, host);
  });
}

// 解析端口范围
function parsePortRange(range) {
  const ports = new Set();
  const parts = String(range || "").split(",").map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((p) => parseInt(p.trim(), 10));
      if (start && end && start <= end && start > 0 && end <= 65535) {
        for (let i = start; i <= end; i++) {
          ports.add(i);
        }
      }
    } else {
      const port = parseInt(part, 10);
      if (port > 0 && port <= 65535) {
        ports.add(port);
      }
    }
  }

  return [...ports].sort((a, b) => a - b);
}

// 批量扫描端口
async function scanPortsBatch(host, ports, concurrentLimit = 50, timeout = 1000, onProgress = null) {
  const results = [];
  const total = ports.length;
  let completed = 0;

  // 分批处理
  for (let i = 0; i < ports.length; i += concurrentLimit) {
    const batch = ports.slice(i, i + concurrentLimit);
    const batchPromises = batch.map((port) => scanPort(host, port, timeout));
    const batchResults = await Promise.all(batchPromises);

    results.push(...batchResults);
    completed += batch.length;

    if (onProgress) {
      onProgress({ completed, total, percentage: Math.round((completed / total) * 100) });
    }
  }

  return results;
}

// 获取系统端口占用信息（Windows）
async function getSystemPortUsage() {
  const platform = process.platform;
  const portUsage = [];

  try {
    if (platform === "win32") {
      const { stdout } = await execFileAsync("cmd.exe", ["/d", "/c", "netstat -ano"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000
      });

      const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        const match = line.match(/^(\w+)\s+(\S+):(\d+)\s+(\S+)\s+(\w+)\s+(\d+)$/);
        if (match) {
          const [, protocol, localAddr, port, foreignAddr, state, pid] = match;
          portUsage.push({
            protocol: protocol.toLowerCase(),
            localAddress: `${localAddr}:${port}`,
            port: parseInt(port, 10),
            foreignAddress: foreignAddr,
            state: state,
            pid: parseInt(pid, 10) || null
          });
        }
      }
    } else if (platform === "darwin" || platform === "linux") {
      const { stdout } = await execFileAsync("netstat", ["-tunap"], {
        encoding: "utf8",
        timeout: 30000
      });

      const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 6) {
          const protocol = parts[0].toLowerCase();
          const localAddr = parts[3];
          const state = parts[5];
          const pidMatch = parts[parts.length - 1]?.match(/(\d+)/);
          const pid = pidMatch ? parseInt(pidMatch[1], 10) : null;
          const portMatch = localAddr.match(/:(\d+)$/);
          const port = portMatch ? parseInt(portMatch[1], 10) : null;

          if (port) {
            portUsage.push({
              protocol,
              localAddress: localAddr,
              port,
              foreignAddress: parts[4],
              state,
              pid
            });
          }
        }
      }
    }
  } catch (error) {
    console.warn("Failed to get system port usage:", error.message);
  }

  return portUsage;
}

// 获取进程名称（Windows）
async function getProcessNameByPid(pid) {
  if (!pid) return null;

  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", ["/fi", `pid eq ${pid}`, "/fo", "csv", "/nh"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000
      });
      const line = String(stdout || "").trim();
      if (line) {
        const match = line.match(/^"([^"]+)"/);
        if (match) return match[1];
      }
    } else {
      const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "comm="], {
        encoding: "utf8",
        timeout: 10000
      });
      return String(stdout || "").trim() || null;
    }
  } catch {
    // 忽略错误
  }
  return null;
}

// 根据 PID 结束进程（释放端口）
async function terminateProcessByPid(pid) {
  if (!pid) {
    throw new Error("Invalid PID");
  }

  const numericPid = Number(pid);
  if (!numericPid || Number.isNaN(numericPid)) {
    throw new Error("Invalid PID");
  }

  try {
    if (process.platform === "win32") {
      const processNotFoundPattern = /no running instance|not found|not exist|没有运行的任务|找不到|不存在/i;

      // First try PowerShell's Stop-Process (more reliable)
      try {
        const psScript = `Stop-Process -Id ${numericPid} -Force -ErrorAction SilentlyContinue`;
        await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript], {
          encoding: "utf8",
          windowsHide: true,
          timeout: 10000
        });
        
        // Verify if process has terminated
        await sleepMs(500);
        if (!await isProcessRunning(numericPid)) {
          return { success: true, pid: numericPid };
        }
      } catch (psError) {
        // Fallback to taskkill if PowerShell fails
        console.warn("PowerShell Stop-Process failed, falling back to taskkill:", psError.message);
      }
      
      // Use taskkill as fallback
      try {
        await execFileAsync("taskkill", ["/PID", String(numericPid), "/T", "/F"], {
          encoding: "utf8",
          windowsHide: true,
          timeout: 10000
        });
      } catch (taskkillError) {
        const message = `${taskkillError?.message || ""} ${taskkillError?.stderr || ""}`.trim();
        if (!processNotFoundPattern.test(message)) {
          throw taskkillError;
        }
      }
      
      // Verify if process has terminated
      await sleepMs(500);
      if (await isProcessRunning(numericPid)) {
        throw new Error("Process could not be terminated");
      }
      
      return { success: true, pid: numericPid };
    } else {
      try {
        process.kill(-numericPid, "SIGTERM");
      } catch {
        process.kill(numericPid, "SIGTERM");
      }
      return { success: true, pid: numericPid };
    }
  } catch (error) {
    // Check if it's a permission issue
    const errorMsg = error.message || "";
    if (errorMsg.includes("Access is denied") || errorMsg.includes("拒绝访问") || errorMsg.includes("EPERM")) {
      throw new Error("Permission denied. Please run the application as administrator to terminate this process.");
    }
    throw new Error(`Failed to terminate process: ${error.message}`);
  }
}

function endpointMatchesPort(endpoint, port) {
  const text = String(endpoint || "").trim();
  if (!text) return false;
  const match = text.match(/:(\d+)\]?$/);
  return !!match && Number(match[1]) === Number(port);
}

async function findPidByPort(port) {
  const numericPort = Number(port);
  if (!numericPort) return null;

  if (process.platform === "win32") {
    // Prefer native PowerShell APIs, fallback to netstat parsing.
    try {
      const psScript = `
$pid = (Get-NetTCPConnection -LocalPort ${numericPort} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)
if (-not $pid) {
  $pid = (Get-NetUDPEndpoint -LocalPort ${numericPort} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)
}
if ($pid) { Write-Output $pid }
`.trim();
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", psScript], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000
      });
      const pid = Number(String(stdout || "").trim());
      if (pid && !Number.isNaN(pid)) return pid;
    } catch {
      // Ignore and fallback to netstat parsing.
    }

    const { stdout } = await execFileAsync("cmd.exe", ["/d", "/c", "netstat -ano"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000
    });
    const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (!/^(TCP|UDP)\s+/i.test(line)) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      const localAddress = parts[1] || "";
      const pid = Number(parts[parts.length - 1]);
      if (endpointMatchesPort(localAddress, numericPort) && pid && !Number.isNaN(pid)) {
        return pid;
      }
    }
    return null;
  }

  try {
    const { stdout } = await execFileAsync("lsof", ["-i", `:${numericPort}`, "-t"], {
      encoding: "utf8",
      timeout: 10000
    });
    const pidText = String(stdout || "").split(/\r?\n/).map((v) => v.trim()).find(Boolean);
    const pid = Number(pidText || 0);
    return pid && !Number.isNaN(pid) ? pid : null;
  } catch {
    return null;
  }
}

// 根据端口查找并结束进程
async function releasePort(port, hintPid = null) {
  const numericPort = Number(port);
  if (!numericPort || numericPort < 1 || numericPort > 65535) {
    throw new Error("Invalid port number");
  }

  try {
    // 优先使用前端传回的 PID（来自最新扫描结果），失败后再按端口反查。
    let targetPid = Number(hintPid || 0) || null;
    if (!targetPid) {
      targetPid = await findPidByPort(numericPort);
    }

    if (!targetPid) {
      return { success: false, message: "No process found using this port", port: numericPort };
    }

    // 获取进程名称
    const processName = await getProcessNameByPid(targetPid);

    // 结束进程
    await terminateProcessByPid(targetPid);

    return {
      success: true,
      port: numericPort,
      pid: targetPid,
      processName
    };
  } catch (error) {
    throw new Error(`Failed to release port ${port}: ${error.message}`);
  }
}

// 执行完整端口扫描
async function performPortScan(options = {}) {
  const {
    host = "127.0.0.1",
    portRange = "1-1000",
    scanType = "tcp",
    timeout = 1000,
    concurrentLimit = 50,
    includeSystemInfo = true
  } = options;

  const ports = parsePortRange(portRange);
  if (ports.length === 0) {
    throw new Error("Invalid port range");
  }

  const startTime = Date.now();
  const results = await scanPortsBatch(host, ports, concurrentLimit, timeout);
  const duration = Date.now() - startTime;

  const openPorts = results.filter((r) => r.open);
  const closedPorts = results.filter((r) => !r.open);

  // 获取系统端口占用信息
  let systemPortUsage = [];
  if (includeSystemInfo) {
    systemPortUsage = await getSystemPortUsage();
  }

  // 合并扫描结果和系统信息
  const enhancedResults = results.map((result) => {
    const systemInfo = systemPortUsage.find((s) => s.port === result.port);
    return {
      ...result,
      systemState: systemInfo?.state || null,
      pid: systemInfo?.pid || null
    };
  });

  // 获取进程名称
  const uniquePids = [...new Set(enhancedResults.filter((r) => r.pid).map((r) => r.pid))];
  const processNames = new Map();
  for (const pid of uniquePids.slice(0, 20)) {
    const name = await getProcessNameByPid(pid);
    if (name) processNames.set(pid, name);
  }

  const finalResults = enhancedResults.map((r) => ({
    ...r,
    processName: r.pid ? processNames.get(r.pid) || "Unknown" : null
  }));

  return {
    host,
    portRange,
    scanType,
    totalPorts: ports.length,
    openCount: openPorts.length,
    closedCount: closedPorts.length,
    duration,
    results: finalResults,
    openPorts: finalResults.filter((r) => r.open),
    timestamp: nowIso()
  };
}

function createProductivityTools({ app, store, Notification, logEvent }) {
  let activeWindowTimer = null;
  let staleReminderTimer = null;
  let lastSnapshot = null;

  function loadState() {
    const saved = store.loadProductivityState ? store.loadProductivityState() : {};
    return mergeState(createDefaultState(app), saved || {});
  }

  function saveState(nextState) {
    const merged = mergeState(createDefaultState(app), nextState || {});
    merged.screenUsage.days = clampHistory(merged.screenUsage.days);
    store.saveProductivityState(merged);
    return merged;
  }

  function persistDuration(snapshot, endTime = Date.now()) {
    if (!snapshot?.startedAt || !snapshot?.id) return;
    const delta = Math.max(0, endTime - snapshot.startedAt);
    if (!delta) return;
    const state = loadState();
    const day = state.screenUsage.days[snapshot.dayKey] || { items: {} };
    const current = day.items[snapshot.id] || {
      id: snapshot.id,
      label: snapshot.label,
      appName: snapshot.appName,
      website: snapshot.website || "",
      windowTitle: snapshot.windowTitle || "",
      durationMs: 0
    };
    current.durationMs += delta;
    current.windowTitle = snapshot.windowTitle || current.windowTitle;
    day.items[snapshot.id] = current;
    state.screenUsage.days[snapshot.dayKey] = day;
    state.screenUsage.updatedAt = nowIso();
    saveState(state);
  }

  async function tickActiveWindow() {
    const snapshot = await getForegroundSnapshot(process.platform);
    const currentTime = Date.now();
    if (lastSnapshot) {
      persistDuration(lastSnapshot, currentTime);
    }
    if (!snapshot) {
      lastSnapshot = null;
      return;
    }
    const website = inferWebsiteLabel(snapshot);
    const label = cleanDisplayText(website ? `${website}` : snapshot.appName, snapshot.appName);
    const id = website ? `${snapshot.appName}::${website}` : `${snapshot.appName}::app`;
    lastSnapshot = {
      ...snapshot,
      website,
      label,
      id,
      dayKey: dateKey(currentTime),
      startedAt: currentTime
    };
  }

  async function runStaleReminder() {
    const state = loadState();
    const roots = normalizeRoots(state.fileExpiry.roots);
    if (!roots.length) return;
    const result = await scanStaleFiles(roots, state.fileExpiry.staleDays);
    const count = result.summary.staleFileCount;
    const previousCount = Number(state.fileExpiry.lastReminderCount || 0);
    const lastReminderAt = state.fileExpiry.lastReminderAt ? new Date(state.fileExpiry.lastReminderAt).getTime() : 0;
    const shouldNotify = count > 0 && (Date.now() - lastReminderAt > 12 * 60 * 60 * 1000 || count !== previousCount);

    state.fileExpiry.lastScanAt = nowIso();
    if (shouldNotify && Notification?.isSupported?.()) {
      const reminder = new Notification({
        title: "Command Hub · 文件过期提醒",
        body: `发现 ${count} 个超过 ${state.fileExpiry.staleDays} 天未访问的文件，建议归档或清理。`,
        silent: true
      });
      reminder.show();
      state.fileExpiry.lastReminderAt = nowIso();
      state.fileExpiry.lastReminderCount = count;
      logEvent?.({
        category: "productivity",
        level: "info",
        title: "Stale files detected",
        summary: `Detected ${count} stale files in monitored folders.`,
        details: { count, staleDays: state.fileExpiry.staleDays, roots }
      });
    }
    saveState(state);
  }

  return {
    start() {
      const supported = process.platform === "win32" || process.platform === "darwin";
      if (supported && !activeWindowTimer) {
        activeWindowTimer = setInterval(() => {
          tickActiveWindow().catch(() => {});
        }, ACTIVE_WINDOW_POLL_MS);
        tickActiveWindow().catch(() => {});
      }
      if (!staleReminderTimer) {
        staleReminderTimer = setInterval(() => {
          runStaleReminder().catch(() => {});
        }, STALE_REMINDER_POLL_MS);
        runStaleReminder().catch(() => {});
      }
    },
    stop() {
      if (activeWindowTimer) clearInterval(activeWindowTimer);
      if (staleReminderTimer) clearInterval(staleReminderTimer);
      activeWindowTimer = null;
      staleReminderTimer = null;
      if (lastSnapshot) {
        persistDuration(lastSnapshot, Date.now());
        lastSnapshot = null;
      }
    },
    getOverview() {
      return getOverviewFromState(loadState(), process.platform);
    },
    saveSettings(payload) {
      const state = loadState();
      const next = mergeState(state, payload || {});
      return saveState(next);
    },
    async scanDuplicateFiles(payload) {
      const roots = normalizeRoots(payload?.roots);
      const strategy = String(payload?.strategy || "hash");
      const result = await scanDuplicateFiles(roots, strategy);
      const state = loadState();
      state.duplicateCleaner.roots = roots;
      state.duplicateCleaner.strategy = strategy;
      state.duplicateCleaner.lastScanAt = nowIso();
      saveState(state);
      return result;
    },
    async deleteFiles(payload) {
      const deleted = await deleteFiles(payload?.paths || []);
      return { ok: true, deleted };
    },
    async archiveFiles(payload) {
      const moved = await moveFilesToArchive(payload?.paths || [], String(payload?.archiveDir || ""));
      return { ok: true, moved };
    },
    async scanStaleFiles(payload) {
      const roots = normalizeRoots(payload?.roots);
      const staleDays = Number(payload?.staleDays || 30);
      const result = await scanStaleFiles(roots, staleDays);
      const state = loadState();
      state.fileExpiry.roots = roots;
      state.fileExpiry.staleDays = staleDays;
      if (payload?.archiveDir) {
        state.fileExpiry.archiveDir = String(payload.archiveDir);
      }
      state.fileExpiry.lastScanAt = nowIso();
      saveState(state);
      return result;
    },
    async convertVideoToGif(payload) {
      const { inputPath, outputPath, fps, width, startTime, duration, quality } = payload;
      const result = await convertVideoToGif(inputPath, outputPath, {
        fps: Number(fps || 10),
        width: Number(width || 480),
        startTime: Number(startTime || 0),
        duration: duration ? Number(duration) : null,
        quality: Number(quality || 5)
      });
      return result;
    },
    async scanPorts(payload) {
      const result = await performPortScan(payload || {});
      logEvent?.({
        category: "productivity",
        level: "info",
        title: "Port scan completed",
        summary: `Scanned ${result.totalPorts} ports on ${result.host}, found ${result.openCount} open ports.`,
        details: { host: result.host, portRange: result.portRange, openCount: result.openCount, duration: result.duration }
      });
      return result;
    },
    async releasePort(payload) {
      const { port, pid } = payload || {};
      const result = await releasePort(port, pid);
      logEvent?.({
        category: "productivity",
        level: result.success ? "success" : "warning",
        title: result.success ? "Port released" : "Port release failed",
        summary: result.success
          ? `Released port ${result.port} by terminating process ${result.processName} (PID: ${result.pid})`
          : result.message,
        details: result
      });
      return result;
    }
  };
}

module.exports = {
  createProductivityTools
};
