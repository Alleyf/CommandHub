const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const util = require("node:util");
const { execFile } = require("node:child_process");

const execFileAsync = util.promisify(execFile);

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
    }
  };
}

module.exports = {
  createProductivityTools
};
