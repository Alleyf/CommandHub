const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, nativeTheme, shell, session } = require("electron");
const { Notification } = require("electron");
const path = require("node:path");

// 设置摄像头和麦克风权限
app.on("browser-window-created", (event, window) => {
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaDevices', 'camera', 'microphone', 'geolocation', 'notifications'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });
});

Menu.setApplicationMenu(null);
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const { execFile, execFileSync, spawn, fork } = require("node:child_process");
const util = require("node:util");
const execFileAsync = util.promisify(execFile);

const { createStore } = require("./store");
const { killSystemProcess, getWindowsPowerShellPath } = require("./system-processes");
const { createProductivityTools } = require("./productivity-tools");

const isDev = !app.isPackaged;
const processes = new Map();
const DEFAULT_SETTINGS = {
  closeToTray: false,
  launchAtLogin: false,
  language: "zh-CN",
  logMode: "overwrite",
  quietMode: false,
  errorReminder: true,
  themeMode: "system",
  particleMode: false,
  gestureMode: false,
  onboardingCompleted: false
};

let mainWindow = null;
let tray = null;
let pollTimer = null;
let forceQuit = false;
let processScannerWorker = null;
let processScannerRequestId = 0;
const processScannerPending = new Map();
let rendererUpdateTimer = null;
const PROCESS_SCAN_CACHE_TTL_MS = 3500;
const SPECIAL_STATUS_CACHE_TTL_MS = 8000;
let matchedProcessCache = [];
let matchedProcessCacheAt = 0;
let matchedProcessRefreshPromise = null;
let watchProcessesTicking = false;
const specialCommandStatusCache = new Map();
const specialCommandStatusPending = new Map();

const store = createStore(() => app.getPath("userData"));
const {
  getStoreDir,
  getCommandsFile,
  getSettingsFile,
  readJson,
  writeJson,
  loadCommands,
  saveCommands,
  updateCommand,
  loadUsageStats,
  loadRuntime,
  saveRuntime,
  getTopCommands,
  recordUsage,
  getLogPath,
  clearLogFile,
  readLogTail,
  appendOperationLog,
  clearOperationLog,
  buildGlobalLogEntries
} = store;

function sanitizeImportedCommands(value) {
  const items = Array.isArray(value?.commands) ? value.commands : Array.isArray(value) ? value : [];
  return items
    .filter((item) => item && typeof item === "object" && item.id && item.name && item.command)
    .map((item) => ({
      id: String(item.id),
      name: String(item.name),
      command: String(item.command),
      args: String(item.args || ""),
      cwd: String(item.cwd || ""),
      group: String(item.group || ""),
      accentTone: String(item.accentTone || "teal"),
      isFavorite: Boolean(item.isFavorite),
      env: typeof item.env === "object" && item.env ? item.env : {},
      autoRestart: Boolean(item.autoRestart),
      createdAt: item.createdAt || nowIso(),
      updatedAt: nowIso(),
      lastStartedAt: item.lastStartedAt || null,
      lastExitCode: item.lastExitCode ?? null,
      lastStoppedAt: item.lastStoppedAt || null,
      lastState: item.lastState || "stopped",
      lastHint: String(item.lastHint || "")
    }));
}

function getAssetPath(...parts) {
  return path.join(__dirname, "assets", ...parts);
}

function getWindowIconPath() {
  return process.platform === "win32"
    ? getAssetPath("icon.ico")
    : getAssetPath("icon-256.png");
}

function ensureProcessScannerWorker() {
  if (processScannerWorker && !processScannerWorker.killed) return processScannerWorker;

  processScannerWorker = fork(path.join(__dirname, "process-scanner-worker.js"), [], {
    stdio: ["ignore", "ignore", "ignore", "ipc"]
  });

  processScannerWorker.on("message", (message) => {
    if (!message?.requestId) return;
    const pending = processScannerPending.get(message.requestId);
    if (!pending) return;
    processScannerPending.delete(message.requestId);
    if (message.type === "scan-error") {
      pending.reject(new Error(message.error || "Process scan failed"));
      return;
    }
    pending.resolve(message.items || []);
  });

  processScannerWorker.on("exit", () => {
    processScannerWorker = null;
    for (const pending of processScannerPending.values()) {
      pending.reject(new Error("Process scanner worker exited"));
    }
    processScannerPending.clear();
  });

  return processScannerWorker;
}

function requestSystemProcessScan(commands, statuses) {
  return new Promise((resolve, reject) => {
    const worker = ensureProcessScannerWorker();
    const requestId = `scan-${Date.now().toString(36)}-${++processScannerRequestId}`;
    processScannerPending.set(requestId, { resolve, reject });
    worker.send({
      type: "scan",
      requestId,
      commands,
      statuses
    });
  });
}

function commandExists(command) {
  try {
    if (process.platform === "win32") {
      const output = execFileSync("where", [command], {
        encoding: "utf8",
        windowsHide: true
      }).trim();
      return output.split(/\r?\n/).find(Boolean) || "";
    }
    const output = execFileSync("which", [command], {
      encoding: "utf8"
    }).trim();
    return output.split(/\r?\n/).find(Boolean) || "";
  } catch {
    return "";
  }
}

function isMatchedProcessCacheFresh() {
  return matchedProcessCacheAt > 0 && (Date.now() - matchedProcessCacheAt) < PROCESS_SCAN_CACHE_TTL_MS;
}

function normalizeCommandExecutable(commandValue) {
  return path.basename(normalizeExecutable(commandValue || "")).toLowerCase();
}

function isOpenClawGatewayServiceCommand(command) {
  const executable = normalizeCommandExecutable(command?.command);
  const args = String(command?.args || "").trim().toLowerCase();
  return executable === "openclaw" && /^gateway\s+(start|restart)\b/.test(args);
}

function parseOpenClawGatewayPort(text) {
  const source = String(text || "");
  const patterns = [
    /OPENCLAW_GATEWAY_PORT=(\d+)/i,
    /port=(\d+)/i,
    /gateway --port (\d+)/i,
    /Dashboard:\s+https?:\/\/[^:\s]+:(\d+)/i,
    /Probe target:\s+\w+:\/\/[^:\s]+:(\d+)/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

async function getPidListeningOnPort(port) {
  const numericPort = Number(port);
  if (!numericPort) return null;
  try {
    const { stdout } = await execFileAsync("cmd.exe", ["/d", "/c", `netstat -ano | findstr LISTENING | findstr :${numericPort}`], {
      encoding: "utf8",
      windowsHide: true
    });
    const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/LISTENING\s+(\d+)$/i);
      if (match) return Number(match[1]);
    }
  } catch {}
  return null;
}

async function resolveOpenClawGatewayRuntime(command) {
  if (!isOpenClawGatewayServiceCommand(command)) return null;
  try {
    const commandPath = commandExists("openclaw") || "openclaw";
    const { stdout, stderr } = await execFileAsync(commandPath, ["gateway", "status", "--no-color"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20000
    });
    const output = [stdout, stderr].filter(Boolean).join("\n");
    const port = parseOpenClawGatewayPort(output);
    const pid = await getPidListeningOnPort(port);
    if (!pid || !pidExists(pid)) {
      return {
        state: "stopped",
        pid: null,
        port,
        message: "Idle",
        rawOutput: output
      };
    }
    return {
      state: "running",
      pid,
      port,
      message: `Running (gateway:${port || "--"})`,
      rawOutput: output
    };
  } catch (error) {
    return {
      state: "stopped",
      pid: null,
      port: null,
      message: String(error.message || error),
      rawOutput: ""
    };
  }
}

function getCachedSpecialCommandStatus(commandId) {
  const entry = specialCommandStatusCache.get(commandId);
  if (!entry) return null;
  if ((Date.now() - entry.updatedAt) > SPECIAL_STATUS_CACHE_TTL_MS) return null;
  return entry.status || null;
}

async function refreshSpecialCommandStatus(command, force = false) {
  if (!command?.id || !isOpenClawGatewayServiceCommand(command)) return null;
  if (!force) {
    const cached = getCachedSpecialCommandStatus(command.id);
    if (cached) return cached;
  }
  const pending = specialCommandStatusPending.get(command.id);
  if (pending) return pending;

  const task = resolveOpenClawGatewayRuntime(command)
    .then((status) => {
      specialCommandStatusCache.set(command.id, {
        updatedAt: Date.now(),
        status
      });
      return status;
    })
    .finally(() => {
      specialCommandStatusPending.delete(command.id);
    });

  specialCommandStatusPending.set(command.id, task);
  return task;
}

function getCachedMatchedProcess(commandId) {
  return matchedProcessCache.find((item) => item.isManaged && item.matchedCommandId === commandId) || null;
}

function getCachedMatchedProcessMap() {
  const map = new Map();
  for (const item of matchedProcessCache) {
    if (!item.isManaged || !item.matchedCommandId || map.has(item.matchedCommandId)) continue;
    map.set(item.matchedCommandId, item);
  }
  return map;
}

async function refreshMatchedProcessCache(force = false) {
  if (!force && isMatchedProcessCacheFresh()) return matchedProcessCache;
  if (matchedProcessRefreshPromise) return matchedProcessRefreshPromise;

  matchedProcessRefreshPromise = requestSystemProcessScan(loadCommands(), getStatusesBase())
    .then((items) => {
      matchedProcessCache = Array.isArray(items) ? items : [];
      matchedProcessCacheAt = Date.now();
      return matchedProcessCache;
    })
    .catch((error) => {
      console.warn("Failed to refresh matched process cache:", error);
      return matchedProcessCache;
    })
    .finally(() => {
      matchedProcessRefreshPromise = null;
    });

  return matchedProcessRefreshPromise;
}

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(getSettingsFile(), DEFAULT_SETTINGS) };
}

function saveSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  if (!merged.particleMode) {
    merged.gestureMode = false;
  }
  writeJson(getSettingsFile(), merged);
  app.setLoginItemSettings({ openAtLogin: Boolean(merged.launchAtLogin) });
  applyThemeMode(merged.themeMode);
  return merged;
}

function applyThemeMode(themeMode) {
  if (themeMode === "light" || themeMode === "dark") {
    nativeTheme.themeSource = themeMode;
    return;
  }
  nativeTheme.themeSource = "system";
}

function nowIso() {
  return new Date().toISOString();
}

function logEvent(entry) {
  appendOperationLog({
    id: `op:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    createdAt: nowIso(),
    category: entry.category || "operation",
    level: entry.level || "info",
    title: entry.title || "Event",
    summary: entry.summary || "",
    commandId: entry.commandId || "",
    commandName: entry.commandName || "",
    details: entry.details || null
  });
}

function pidExists(pid) {
  const numericPid = Number(pid);
  if (!numericPid || Number.isNaN(numericPid)) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function splitEnv(text) {
  const env = {};
  for (const [key, value] of Object.entries(text || {})) {
    env[key] = String(value);
  }
  return env;
}

function escapePowerShellString(value) {
  return String(value || "").replace(/'/g, "''");
}

function encodePowerShellCommand(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function quoteWindowsCommand(value) {
  const text = String(value || "").trim();
  if (!text) return '""';
  if (/^".*"$/.test(text)) return text;
  return /[\s"]/g.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function getWindowsHiddenLaunchScript(command, logPath, logMode) {
  const commandLine = [quoteWindowsCommand(command.command), command.args || ""].filter(Boolean).join(" ").trim();
  const envScript = Object.entries(splitEnv(command.env))
    .map(([key, value]) => `$env:${escapePowerShellString(key)} = '${escapePowerShellString(value)}'`)
    .join("\n");
  const redirect = logMode === "append" ? ">>" : ">";

  const innerCmd = `chcp 65001>nul & ${commandLine} 1${redirect}"${logPath}" 2>&1`;

  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
${envScript}
function Get-ChildProcessChain {
  param([int]$RootPid)
  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $children = @()
  $queue = New-Object System.Collections.Generic.Queue[object]
  foreach ($item in $all | Where-Object { $_.ParentProcessId -eq $RootPid }) {
    $queue.Enqueue($item)
  }
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    $children += $current
    foreach ($item in $all | Where-Object { $_.ParentProcessId -eq $current.ProcessId }) {
      $queue.Enqueue($item)
    }
  }
  return $children
}
$process = Start-Process -FilePath "cmd.exe" -ArgumentList @('/d', '/c', '${escapePowerShellString(innerCmd)}') -WorkingDirectory '${escapePowerShellString(command.cwd || ".")}' -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 900
$descendants = @(Get-ChildProcessChain -RootPid $process.Id)
$preferred = $descendants | Where-Object {
  $_.ProcessId -ne $process.Id -and
  $_.Name -notmatch '^(cmd|conhost|powershell|pwsh)(\\.exe)?$'
} | Sort-Object CreationDate -Descending | Select-Object -First 1
$selectedPid = if ($preferred) { $preferred.ProcessId } else { $process.Id }
[PSCustomObject]@{
  pid = $selectedPid
  shellPid = $process.Id
} | ConvertTo-Json -Compress
`.trim();
}

function getShellCommand(command, args) {
  const joined = [command, args].filter(Boolean).join(" ").trim();
  if (process.platform === "win32") {
    return { file: "cmd.exe", args: ["/d", "/c", `chcp 65001>nul & ${joined}`] };
  }
  return { file: "/bin/sh", args: ["-lc", joined] };
}

function createStatus(base = {}) {
  return {
    state: "stopped",
    pid: null,
    startedAt: null,
    stoppedAt: null,
    lastExitCode: null,
    message: "",
    logPath: "",
    hint: "",
    ...base
  };
}

function normalizeExecutable(commandValue) {
  const raw = String(commandValue || "").trim();
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function inferCommandHint(command, error, logTail = "") {
  const executable = normalizeExecutable(command?.command);
  const cwd = String(command?.cwd || "").trim();
  const sourceText = [String(error?.message || error || ""), String(logTail || "")].join("\n").toLowerCase();

  if (cwd && !fs.existsSync(cwd)) {
    return "工作目录不存在，请检查路径是否还有效。";
  }
  if (executable && path.isAbsolute(executable) && !fs.existsSync(executable)) {
    return "可执行文件不存在，请确认文件路径没有变动。";
  }
  if (executable && !path.isAbsolute(executable) && !commandExists(executable)) {
    return "命令不在 PATH 中，请改用绝对路径或先配置环境变量。";
  }
  if (sourceText.includes("eaddrinuse") || sourceText.includes("address already in use") || sourceText.includes("port is already allocated")) {
    return "端口已被占用，换一个端口或先停止冲突进程。";
  }
  if (sourceText.includes("module not found") || sourceText.includes("cannot find module")) {
    return "依赖缺失，先安装项目依赖再启动。";
  }
  if (sourceText.includes("enoent") || sourceText.includes("no such file or directory")) {
    return "命令或工作目录不存在，请检查路径和文件名。";
  }
  if (sourceText.includes("eacces") || sourceText.includes("permission denied")) {
    return "权限不足，请尝试提升权限或更换可执行文件位置。";
  }
  if (sourceText.includes("is not recognized as an internal or external command")) {
    return "系统无法识别这条命令，请确认命令名是否正确。";
  }
  return "";
}

const productivityTools = createProductivityTools({
  app,
  store,
  Notification,
  logEvent: (entry) => logEvent(entry)
});

function showErrorReminder(command, summary) {
  const settings = loadSettings();
  if (!settings.errorReminder || !Notification.isSupported()) {
    return;
  }

  const reminder = new Notification({
    title: `Command Hub · ${command?.name || "Command"}`,
    body: summary,
    silent: true
  });
  reminder.show();
}

function createTrayIcon() {
  const trayIconPath = getAssetPath("tray-icon.png");
  if (fs.existsSync(trayIconPath)) {
    return nativeImage.createFromPath(trayIconPath);
  }
  const fallbackPath = getAssetPath("icon-32.png");
  return nativeImage.createFromPath(fallbackPath);
}

function updateRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (rendererUpdateTimer) return;
  rendererUpdateTimer = setTimeout(() => {
    rendererUpdateTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("runtime-updated");
  }, 80);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function refreshTrayMenu() {
  if (!tray) return;
  const commands = loadCommands();
  const statuses = getStatuses();
  const runningCount = Object.values(statuses).filter((item) => item.state === "running").length;

  const menu = Menu.buildFromTemplate([
    { label: `Command Hub (${runningCount}/${commands.length} running)`, enabled: false },
    { type: "separator" },
    { label: "Show Dashboard", click: () => showWindow() },
    { label: "Start All", click: () => startAllCommands() },
    { label: "Stop All", click: () => stopAllCommands() },
    { type: "separator" },
    { label: "Quit", click: () => { forceQuit = true; app.quit(); } }
  ]);

  tray.setToolTip(`Command Hub - ${runningCount} running`);
  tray.setContextMenu(menu);
}

function ensureTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.on("double-click", () => showWindow());
  refreshTrayMenu();
}

async function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPidExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidExists(pid)) return true;
    await sleepMs(100);
  }
  return !pidExists(pid);
}

async function terminateProcess(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true
      });
    } catch {}
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
}

function hydrateRuntime() {
  const runtime = loadRuntime();
  let dirty = false;
  for (const [id, data] of Object.entries(runtime)) {
    if (!data.pid || !pidExists(data.pid)) {
      delete runtime[id];
      dirty = true;
    }
  }
  if (dirty) saveRuntime(runtime);
}

function watchProcesses() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (watchProcessesTicking) return;
    watchProcessesTicking = true;
    let changed = false;
    try {
      const runtime = loadRuntime();
      const commandsById = new Map(loadCommands().map((command) => [command.id, command]));
      const exitedEntries = [];

      for (const [id, info] of Object.entries(runtime)) {
        const managed = processes.get(id);
        const command = managed?.command || commandsById.get(id);
        const isAlive = info?.pid && pidExists(info.pid);
        const isChildAlive = managed?.child ? managed.child.exitCode === null : true;

        if (isAlive && isChildAlive) continue;
        exitedEntries.push({ id, info, managed, command });
      }

      let matchedByCommandId = new Map();
      if (exitedEntries.length > 0) {
        const refreshed = await refreshMatchedProcessCache(true);
        matchedByCommandId = new Map();
        for (const item of refreshed) {
          if (!item.isManaged || !item.matchedCommandId || matchedByCommandId.has(item.matchedCommandId)) continue;
          matchedByCommandId.set(item.matchedCommandId, item);
        }
      }

      for (const { id, info, managed, command } of exitedEntries) {
        if (isOpenClawGatewayServiceCommand(command)) {
          const specialStatus = await refreshSpecialCommandStatus(command, true);
          if (specialStatus?.state === "running" && specialStatus.pid && pidExists(specialStatus.pid)) {
            runtime[id] = {
              pid: specialStatus.pid,
              shellPid: info?.shellPid || null,
              startedAt: info?.startedAt || command?.lastStartedAt || nowIso(),
              logPath: info?.logPath || getLogPath(id)
            };
            saveRuntime(runtime);
            changed = true;
            continue;
          }
        }

        const matchedProcess = matchedByCommandId.get(id);
        if (matchedProcess?.pid && pidExists(matchedProcess.pid)) {
          runtime[id] = {
            pid: matchedProcess.pid,
            startedAt: info?.startedAt || command?.lastStartedAt || nowIso(),
            logPath: info?.logPath || getLogPath(id)
          };
          saveRuntime(runtime);
          changed = true;
          continue;
        }

        const exitCode = managed?.child?.exitCode ?? null;
        const logPath = info?.logPath || getLogPath(id);
        const logTail = readLogTail(logPath, 4000);
        const inferredHint = command ? inferCommandHint(command, null, logTail) : "";
        const inferredExitCode = exitCode ?? (inferredHint ? 1 : null);
        const isErrorExit = inferredExitCode !== null && inferredExitCode !== undefined && inferredExitCode !== 0;

        try {
          managed?.stream?.end();
        } catch {}

        delete runtime[id];
        processes.delete(id);
        saveRuntime(runtime);
      updateCommand(id, () => ({
        lastExitCode: inferredExitCode,
        lastStoppedAt: nowIso(),
        updatedAt: nowIso(),
        lastState: isErrorExit ? "error" : "stopped",
        lastHint: isErrorExit ? inferredHint : ""
      }));
      logEvent({
        category: "command",
        level: isErrorExit ? "error" : "info",
        title: isErrorExit ? "Command exited with error" : "Command exited",
        summary: `${command?.name || id} exited${inferredExitCode === null || inferredExitCode === undefined ? "" : ` with code ${inferredExitCode}`}.`,
          commandId: id,
          commandName: command?.name || "",
        details: { exitCode: inferredExitCode, logPath }
      });
      if (isErrorExit) {
        showErrorReminder(command, `${command?.name || id} 已退出，退出码 ${inferredExitCode}。`);
      }
        changed = true;
        refreshTrayMenu();
        updateRenderer();

        if (command?.autoRestart) {
          setTimeout(async () => {
            await startCommand(command);
            updateRenderer();
          }, 1200);
        }
      }

      if (changed) {
        refreshTrayMenu();
        updateRenderer();
      }
    } finally {
      watchProcessesTicking = false;
    }
  }, 1000);
}

function extractLaunchResult(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { pid: NaN, shellPid: NaN };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      pid: Number(parsed?.pid),
      shellPid: Number(parsed?.shellPid)
    };
  } catch {}

  const match = raw.match(/PID:(\d+)/);
  if (match) {
    return { pid: Number(match[1]), shellPid: Number(match[1]) };
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (/^\d+$/.test(line)) {
      const pid = Number(line);
      return { pid, shellPid: pid };
    }
  }

  return { pid: NaN, shellPid: NaN };
}

async function startCommand(command) {
  const currentRuntime = loadRuntime();
  const settings = loadSettings();
  const existingRuntime = currentRuntime[command.id];
  if (existingRuntime?.pid && pidExists(existingRuntime.pid)) {
    logEvent({
      category: "operation",
      level: "info",
      title: "Command already running",
      summary: `${command.name} is already running.`,
      commandId: command.id,
      commandName: command.name
    });
    return createStatus({
      state: "running",
      pid: existingRuntime.pid,
      startedAt: existingRuntime.startedAt,
      message: "Already running",
      logPath: existingRuntime.logPath
    });
  }

  const logPath = getLogPath(command.id);
  const logMode = settings.logMode === "append" ? "append" : "overwrite";
  if (logMode === "overwrite") {
    let cleared = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (clearLogFile(logPath)) {
        cleared = true;
        break;
      }
      await sleepMs(300);
    }
    if (!cleared) {
      const hint = "日志文件正被占用，请稍等几秒后重试。";
      console.warn(`Giving up on clearing log file for ${command.id} after 5 attempts.`);
      updateCommand(command.id, () => ({
        lastExitCode: null,
        lastStoppedAt: nowIso(),
        updatedAt: nowIso(),
        lastState: "error",
        lastHint: hint
      }));
      logEvent({
        category: "command",
        level: "error",
        title: "Command start blocked",
        summary: `${command.name} could not clear its log file before launch.`,
        commandId: command.id,
        commandName: command.name,
        details: { logPath }
      });
      return createStatus({
        state: "error",
        message: "Log file is busy and could not be cleared. Please try again in a few seconds.",
        logPath,
        hint
      });
    }
  }
  let child = null;
  let stream = null;
  let runtimePid = null;
  let shellPid = null;

  if (process.platform === "win32") {
    try {
      const script = getWindowsHiddenLaunchScript(command, logPath, logMode);
      const { stdout } = await execFileAsync(getWindowsPowerShellPath(), ["-NoProfile", "-EncodedCommand", encodePowerShellCommand(script)], {
        encoding: "utf8",
        windowsHide: true
      });
      const launchResult = extractLaunchResult(stdout);
      runtimePid = launchResult.pid;
      shellPid = launchResult.shellPid;
      if (Number.isNaN(runtimePid)) {
        throw new Error(`Could not determine process PID from PowerShell output: ${stdout}`);
      }
      await sleepMs(250);
      if (!pidExists(runtimePid)) {
        const logTail = readLogTail(logPath, 4000);
        const launchError = new Error(logTail || "Command exited immediately after launch.");
        const hint = inferCommandHint(command, launchError, logTail) || "命令启动后立即退出，请检查命令与工作目录。";
        updateCommand(command.id, () => ({
          lastExitCode: 1,
          lastStoppedAt: nowIso(),
          updatedAt: nowIso(),
          lastState: "error",
          lastHint: hint
        }));
        logEvent({
          category: "command",
          level: "error",
          title: "Command start failed",
          summary: `${command.name} exited immediately after launch.`,
          commandId: command.id,
          commandName: command.name,
          details: { logPath, pid: runtimePid }
        });
        showErrorReminder(command, hint);
        return createStatus({
          state: "error",
          message: hint,
          logPath,
          hint,
          lastExitCode: 1,
          stoppedAt: nowIso()
        });
      }
    } catch (error) {
      const hint = inferCommandHint(command, error);
      console.error(`Failed to start command ${command.id}:`, error);
      updateCommand(command.id, () => ({
        lastExitCode: null,
        lastStoppedAt: nowIso(),
        updatedAt: nowIso(),
        lastState: "error",
        lastHint: hint
      }));
      logEvent({
        category: "command",
        level: "error",
        title: "Command start failed",
        summary: `${command.name} failed to start: ${String(error.message || error)}`,
        commandId: command.id,
        commandName: command.name,
        details: { logPath }
      });
      showErrorReminder(command, hint || String(error.message || error));
      return createStatus({
        state: "error",
        message: String(error.message || error),
        logPath,
        hint
      });
    }
  } else {
    stream = fs.createWriteStream(logPath, { flags: logMode === "append" ? "a" : "w" });
    const shellCommand = getShellCommand(command.command, command.args);
    child = spawn(shellCommand.file, shellCommand.args, {
      cwd: command.cwd || undefined,
      env: { ...process.env, ...splitEnv(command.env) },
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.pipe(stream);
    child.stderr.pipe(stream);
    child.unref();
    runtimePid = child.pid;
  }

  const status = createStatus({
    state: "running",
    pid: runtimePid,
    startedAt: nowIso(),
    message: "Running",
    logPath,
    hint: ""
  });

  if (child) {
    processes.set(command.id, { child, stream, command });
  }
  currentRuntime[command.id] = {
    pid: runtimePid,
    shellPid,
    startedAt: status.startedAt,
    logPath
  };
  saveRuntime(currentRuntime);
  updateCommand(command.id, () => ({
    lastStartedAt: status.startedAt,
    lastExitCode: null,
    updatedAt: nowIso(),
    lastState: "running",
    lastHint: ""
  }));
  recordUsage(command.id);
  logEvent({
    category: "command",
    level: "success",
    title: "Command started",
    summary: `${command.name} started successfully.`,
    commandId: command.id,
    commandName: command.name,
    details: { pid: runtimePid, logPath }
  });
  refreshTrayMenu();
  if (isOpenClawGatewayServiceCommand(command)) {
    const specialStatus = await refreshSpecialCommandStatus(command, true);
    if (specialStatus?.state === "running" && specialStatus.pid) {
      currentRuntime[command.id] = {
        pid: specialStatus.pid,
        shellPid,
        startedAt: status.startedAt,
        logPath
      };
      saveRuntime(currentRuntime);
      refreshMatchedProcessCache(true).then(() => updateRenderer()).catch(() => {});
      return createStatus({
        ...status,
        pid: specialStatus.pid,
        message: specialStatus.message || "Running"
      });
    }
  }
  refreshMatchedProcessCache(true).then(() => updateRenderer()).catch(() => {});
  return status;
}

async function stopCommand(id) {
  const runtime = loadRuntime();
  const command = loadCommands().find((item) => item.id === id);
  let data = runtime[id];
  if (command && isOpenClawGatewayServiceCommand(command)) {
    try {
      const commandPath = commandExists("openclaw") || "openclaw";
      await execFileAsync(commandPath, ["gateway", "stop"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 20000
      });
      await sleepMs(600);
    } catch {}
    const specialStatus = await refreshSpecialCommandStatus(command, true);
    if (specialStatus?.state === "running" && specialStatus.pid) {
      data = {
        ...(data || {}),
        pid: specialStatus.pid,
        logPath: data?.logPath || getLogPath(id)
      };
    }
  }
  if (!data?.pid) {
    if (command && isOpenClawGatewayServiceCommand(command)) {
      delete runtime[id];
      saveRuntime(runtime);
      updateCommand(id, () => ({
        lastStoppedAt: nowIso(),
        updatedAt: nowIso(),
        lastState: "stopped",
        lastHint: ""
      }));
      logEvent({
        category: "command",
        level: "info",
        title: "Command stopped",
        summary: `${command?.name || id} stopped.`,
        commandId: id,
        commandName: command?.name || "",
        details: { pid: null, logPath: getLogPath(id) }
      });
      refreshTrayMenu();
      return createStatus({
        state: "stopped",
        stoppedAt: nowIso(),
        message: "Stopped",
        logPath: getLogPath(id)
      });
    }
    logEvent({
      category: "operation",
      level: "info",
      title: "Command already stopped",
      summary: `${command?.name || id} is not running.`,
      commandId: id,
      commandName: command?.name || ""
    });
    return createStatus({ state: "stopped", message: "Not running" });
  }

  await terminateProcess(data.pid);
  await waitForPidExit(data.pid);

  if (process.platform === "win32") {
    await sleepMs(400);
  }

  delete runtime[id];
  saveRuntime(runtime);

  const managed = processes.get(id);
  if (managed) {
    processes.delete(id);
    try {
      managed.stream.end();
    } catch {}
  }

  updateCommand(id, () => ({
    lastStoppedAt: nowIso(),
    updatedAt: nowIso(),
    lastState: "stopped",
    lastHint: ""
  }));
  logEvent({
    category: "command",
    level: "info",
    title: "Command stopped",
    summary: `${command?.name || id} stopped.`,
    commandId: id,
    commandName: command?.name || "",
    details: { pid: data.pid, logPath: data.logPath || "" }
  });

  refreshTrayMenu();
  refreshMatchedProcessCache(true).then(() => updateRenderer()).catch(() => {});
  return createStatus({
    state: "stopped",
    stoppedAt: nowIso(),
    message: "Stopped",
    logPath: data.logPath || ""
  });
}

function getStatusesBase() {
  const runtime = loadRuntime();
  const statuses = {};
  const commands = loadCommands();
  for (const command of commands) {
    const info = runtime[command.id];
    if (info?.pid && pidExists(info.pid)) {
      statuses[command.id] = createStatus({
        state: "running",
        pid: info.pid,
        startedAt: info.startedAt,
        message: "Running",
        logPath: info.logPath,
        hint: command.lastHint || ""
      });
    } else {
      const state = command.lastState === "running" ? "stopped" : (command.lastState || "stopped");
      statuses[command.id] = createStatus({
        state: state === "error" ? "error" : "stopped",
        message: "Idle",
        stoppedAt: command.lastStoppedAt || null,
        lastExitCode: command.lastExitCode ?? null,
        logPath: info?.logPath || getLogPath(command.id),
        hint: command.lastHint || ""
      });
    }
  }
  return statuses;
}

function getStatuses() {
  const commands = loadCommands();
  const statuses = getStatusesBase();
  const canUseCache = isMatchedProcessCacheFresh();
  const matchedByCommandId = canUseCache ? getCachedMatchedProcessMap() : new Map();

  for (const command of commands) {
    const currentStatus = statuses[command.id];
    if (currentStatus?.state === "running") continue;
    if (command.lastState !== "running") continue;

    const matchedProcess = matchedByCommandId.get(command.id);
    if (!matchedProcess?.pid || !pidExists(matchedProcess.pid)) continue;

    statuses[command.id] = createStatus({
      state: "running",
      pid: matchedProcess.pid,
      startedAt: command.lastStartedAt || null,
      message: matchedProcess.matchType === "pid" ? "Running" : "Running (detected)",
      logPath: currentStatus?.logPath || getLogPath(command.id),
      hint: command.lastHint || ""
    });
  }

  for (const command of commands) {
    const currentStatus = statuses[command.id];
    if (currentStatus?.state === "running") continue;
    const specialStatus = getCachedSpecialCommandStatus(command.id);
    if (!specialStatus || specialStatus.state !== "running" || !specialStatus.pid || !pidExists(specialStatus.pid)) continue;

    statuses[command.id] = createStatus({
      state: "running",
      pid: specialStatus.pid,
      startedAt: command.lastStartedAt || null,
      message: specialStatus.message || "Running",
      logPath: currentStatus?.logPath || getLogPath(command.id),
      hint: command.lastHint || ""
    });
  }

  return statuses;
}

async function startAllCommands(group) {
  const commands = loadCommands().filter((item) => !group || item.group === group);
  const statuses = {};
  for (const command of commands) {
    statuses[command.id] = await startCommand(command);
  }
  updateRenderer();
  return statuses;
}

async function stopAllCommands(group) {
  const commands = loadCommands().filter((item) => !group || item.group === group);
  const statuses = {};
  for (const command of commands) {
    statuses[command.id] = await stopCommand(command.id);
  }
  updateRenderer();
  return statuses;
}

async function createWindow() {
  applyThemeMode(loadSettings().themeMode);
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 920,
    minWidth: 880,
    minHeight: 640,
    icon: getWindowIconPath(),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#071118",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // 允许访问摄像头和麦克风
      mediaDevices: true,
      sandbox: false
    }
  });

  mainWindow.on("close", (event) => {
    const settings = loadSettings();
    if (forceQuit || !settings.closeToTray) return;
    event.preventDefault();
    mainWindow.hide();
  });

  if (isDev) {
    await loadRendererWithRetry(mainWindow, "http://127.0.0.1:5173");
    return;
  }
  await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

async function loadRendererWithRetry(window, url, attempts = 12) {
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      await window.loadURL(url);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

function safeHandle(channel, handler) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
}
safeHandle("app:get-state", async () => {
  const commands = loadCommands();
  const statuses = getStatuses();
  const settings = loadSettings();
  const usageStats = loadUsageStats();
  return { commands, statuses, settings, usageStats };
});
safeHandle("app:save-command", async (_event, payload) => {
  const commands = loadCommands();
  const index = commands.findIndex((item) => item.id === payload.id);
  const mode = index >= 0 ? "updated" : "created";
  if (index >= 0) commands[index] = payload;
  else commands.push(payload);
  saveCommands(commands);
  logEvent({
    category: "operation",
    level: "success",
    title: index >= 0 ? "Command updated" : "Command created",
    summary: `${payload.name} was ${mode}.`,
    commandId: payload.id,
    commandName: payload.name
  });
  refreshTrayMenu();
  updateRenderer();
  return { ok: true };
});
safeHandle("app:delete-command", async (_event, id) => {
  const command = loadCommands().find((item) => item.id === id);
  await stopCommand(id);
  const commands = loadCommands().filter((item) => item.id !== id);
  saveCommands(commands);
  logEvent({
    category: "operation",
    level: "info",
    title: "Command deleted",
    summary: `${command?.name || id} was removed from the hub.`,
    commandId: id,
    commandName: command?.name || ""
  });
  refreshTrayMenu();
  updateRenderer();
  return { ok: true };
});
safeHandle("app:start-command", async (_event, command) => {
  const status = await startCommand(command);
  updateRenderer();
  return status;
});
safeHandle("app:stop-command", async (_event, id) => {
  const status = await stopCommand(id);
  updateRenderer();
  return status;
});
safeHandle("app:restart-command", async (_event, command) => {
  await stopCommand(command.id);
  const status = await startCommand(command);
  updateRenderer();
  return status;
});
safeHandle("app:start-all", async (_event, group) => await startAllCommands(group));
safeHandle("app:stop-all", async (_event, group) => await stopAllCommands(group));
safeHandle("app:get-log-tail", async (_event, logPath) => readLogTail(logPath));
safeHandle("app:clear-log", async (_event, logPath) => {
  clearLogFile(logPath);
  logEvent({
    category: "operation",
    level: "info",
    title: "Command log cleared",
    summary: `Cleared command output log at ${logPath}.`,
    details: { logPath }
  });
  return { ok: true };
});

safeHandle("app:open-log-folder", async () => {
  await shell.openPath(path.join(getStoreDir(), "logs"));
  return { ok: true };
});
safeHandle("app:save-settings", async (_event, payload) => {
  const settings = saveSettings(payload);
  logEvent({
    category: "operation",
    level: "info",
    title: "Settings updated",
    summary: "Application preferences were updated.",
    details: {
      particleMode: settings.particleMode,
      gestureMode: settings.gestureMode,
      themeMode: settings.themeMode,
      language: settings.language
    }
  });
  updateRenderer();
  return settings;
});
safeHandle("app:show-window", async () => {
  showWindow();
  return { ok: true };
});
safeHandle("app:pick-command-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    title: "Select command file"
  });
  return result.canceled ? "" : result.filePaths[0];
});
safeHandle("app:pick-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select working directory"
  });
  return result.canceled ? "" : result.filePaths[0];
});
safeHandle("app:pick-video-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    title: "Select video file",
    filters: [
      { name: "Video Files", extensions: ["mp4", "avi", "mov", "mkv", "webm", "wmv", "flv"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });
  return result.canceled ? "" : result.filePaths[0];
});
safeHandle("app:pick-gif-save-path", async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save GIF file",
    defaultPath: "output.gif",
    filters: [
      { name: "GIF Image", extensions: ["gif"] }
    ]
  });
  return result.canceled ? "" : result.filePath;
});
safeHandle("app:open-path", async (_event, targetPath) => {
  if (targetPath) {
    await shell.openPath(targetPath);
  }
});
safeHandle("app:export-commands", async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export command list",
    defaultPath: path.join(app.getPath("documents"), "command-hub-commands.json"),
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  fs.writeFileSync(result.filePath, JSON.stringify({ commands: loadCommands() }, null, 2), "utf8");
  logEvent({
    category: "operation",
    level: "success",
    title: "Commands exported",
    summary: `Exported ${loadCommands().length} commands.`,
    details: { filePath: result.filePath }
  });
  return { ok: true, filePath: result.filePath, count: loadCommands().length };
});
safeHandle("app:import-commands", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import command list",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };

  const imported = sanitizeImportedCommands(JSON.parse(fs.readFileSync(result.filePaths[0], "utf8")));
  const merged = new Map(loadCommands().map((item) => [item.id, item]));
  for (const item of imported) {
    merged.set(item.id, { ...merged.get(item.id), ...item, updatedAt: nowIso() });
  }
  saveCommands([...merged.values()]);
  logEvent({
    category: "operation",
    level: "success",
    title: "Commands imported",
    summary: `Imported ${imported.length} commands from ${path.basename(result.filePaths[0])}.`,
    details: { filePath: result.filePaths[0], count: imported.length, total: merged.size }
  });
  refreshTrayMenu();
  updateRenderer();
  return { ok: true, filePath: result.filePaths[0], count: imported.length, total: merged.size };
});
safeHandle("app:scan-template-libraries", async (_event, templates) => {
  const matches = (Array.isArray(templates) ? templates : [])
    .map((template) => {
      const detectors = Array.isArray(template.detect) && template.detect.length > 0 ? template.detect : [template.command];
      const found = detectors
        .map((command) => ({ command, path: commandExists(command) }))
        .find((item) => item.path);
      return found ? { ...template, detectedCommand: found.command, detectedPath: found.path } : null;
    })
    .filter(Boolean);
  return { ok: true, matches };
});
safeHandle("app:list-system-processes", async () => {
  return await refreshMatchedProcessCache(true);
});
safeHandle("app:kill-system-process", async (_event, pid) => await killSystemProcess(pid, terminateProcess));
safeHandle("app:get-global-logs", async (_event, options) => {
  return buildGlobalLogEntries(loadCommands(), loadRuntime(), options || {});
});
safeHandle("app:clear-operation-logs", async () => {
  clearOperationLog();
  return { ok: true };
});
safeHandle("app:export-global-logs", async (_event, options) => {
  const entries = buildGlobalLogEntries(loadCommands(), loadRuntime(), options || {});
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export global logs",
    defaultPath: path.join(app.getPath("documents"), `command-hub-logs-${Date.now()}.json`),
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(result.filePath, JSON.stringify({ exportedAt: nowIso(), entries }, null, 2), "utf8");
  logEvent({
    category: "operation",
    level: "success",
    title: "Global logs exported",
    summary: `Exported ${entries.length} log entries.`,
    details: { filePath: result.filePath }
  });
  return { ok: true, filePath: result.filePath, count: entries.length };
});
safeHandle("app:check-for-updates", async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result?.updateInfo || null;
    return {
      ok: true,
      updateInfo: info ? {
        version: String(info.version || ""),
        releaseDate: info.releaseDate || null,
        files: Array.isArray(info.files)
          ? info.files.map((file) => ({
            url: String(file?.url || ""),
            sha512: String(file?.sha512 || ""),
            size: Number(file?.size || 0)
          }))
          : []
      } : null
    };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});
safeHandle("app:get-productivity-overview", async () => productivityTools.getOverview());
safeHandle("app:save-productivity-settings", async (_event, payload) => productivityTools.saveSettings(payload));
safeHandle("app:scan-duplicate-files", async (_event, payload) => await productivityTools.scanDuplicateFiles(payload || {}));
safeHandle("app:scan-stale-files", async (_event, payload) => await productivityTools.scanStaleFiles(payload || {}));
safeHandle("app:delete-files", async (_event, payload) => await productivityTools.deleteFiles(payload || {}));
safeHandle("app:archive-files", async (_event, payload) => await productivityTools.archiveFiles(payload || {}));
safeHandle("app:convert-video-to-gif", async (_event, payload) => await productivityTools.convertVideoToGif(payload || {}));
safeHandle("app:scan-ports", async (_event, payload) => await productivityTools.scanPorts(payload || {}));
safeHandle("app:release-port", async (_event, payload) => await productivityTools.releasePort(payload || {}));

function setupAutoUpdater() {
  if (isDev) {
    console.log("[AutoUpdate] Skipped in dev");
    return;
  }

  // 不自动下载，等待用户确认
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[AutoUpdate] Checking for updates...");
  });

  autoUpdater.on("update-available", async (info) => {
    console.log("[AutoUpdate] Update available:", info.version);

    // 等待窗口创建完成
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.log("[AutoUpdate] Window not ready, skipping prompt");
      return;
    }

    // 询问用户是否要下载更新
    const choice = dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "发现新版本",
      message: `发现新版本 v${info.version}，是否下载更新？`,
      detail: `当前版本: ${app.getVersion()}\n新版本: ${info.version}`,
      buttons: ["下载更新", "稍后再说"],
      defaultId: 0,
      cancelId: 1
    });

    const { response } = choice;

    if (response === 0) {
      // 用户选择下载更新
      console.log("[AutoUpdate] User confirmed, starting download...");
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update:downloading", info);
      }
      autoUpdater.downloadUpdate();
    } else {
      console.log("[AutoUpdate] User declined update");
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    const pct = Math.round(progress.percent);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:progress", { percent: pct, transferred: progress.transferred, total: progress.total });
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[AutoUpdate] Update downloaded:", info.version);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:downloaded", info);
    }

    const choice = dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "更新已下载",
      message: "新版本已下载完成，是否立即重启应用？",
      detail: "重启后将自动应用更新",
      buttons: ["立即重启", "稍后重启"],
      defaultId: 0,
      cancelId: 1
    });

    const { response } = choice;

    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log("[AutoUpdate] Already up-to-date:", info.version);
  });

  autoUpdater.on("error", (err) => {
    console.error("[AutoUpdate] Error:", err);
  });

  autoUpdater.checkForUpdates();
}

app.whenReady().then(async () => {
  // 设置权限检查
  session.defaultSession.setPermissionCheckHandler(() => true);

  setupAutoUpdater();
  hydrateRuntime();
  saveSettings(loadSettings());
  ensureTray();
  watchProcesses();
  productivityTools.start();
  refreshMatchedProcessCache(true).catch(() => {});
  await createWindow();
  nativeTheme.on("updated", () => updateRenderer());

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    } else {
      showWindow();
    }
  });
});

app.on("before-quit", () => {
  forceQuit = true;
  productivityTools.stop();
  if (processScannerWorker && !processScannerWorker.killed) {
    processScannerWorker.kill();
  }
});

app.on("window-all-closed", () => {
  const settings = loadSettings();
  if (process.platform !== "darwin" && !settings.closeToTray) {
    forceQuit = true;
    app.quit();
  }
});

safeHandle("app:get-usage-stats",async()=>loadUsageStats());
safeHandle("app:get-recommended",async()=>{const top=getTopCommands(5);const cmds=loadCommands();const map=new Map(cmds.map(c=>[c.id,c]));return top.map(t=>map.get(t.id)).filter(Boolean);});
