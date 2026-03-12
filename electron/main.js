const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, nativeTheme, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync, spawn } = require("node:child_process");

const isDev = !app.isPackaged;
const processes = new Map();
const DEFAULT_SETTINGS = {
  closeToTray: true,
  launchAtLogin: false,
  language: "zh-CN",
  logMode: "overwrite",
  themeMode: "system"
};

let mainWindow = null;
let tray = null;
let pollTimer = null;
let forceQuit = false;

function getAssetPath(...parts) {
  return path.join(__dirname, "assets", ...parts);
}

function getWindowIconPath() {
  return process.platform === "win32"
    ? getAssetPath("icon.ico")
    : getAssetPath("icon-256.png");
}

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

function getStoreDir() {
  const dir = path.join(app.getPath("userData"), "command-hub");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  return dir;
}

function getCommandsFile() {
  return path.join(getStoreDir(), "commands.json");
}

function getRuntimeFile() {
  return path.join(getStoreDir(), "runtime.json");
}

function getSettingsFile() {
  return path.join(getStoreDir(), "settings.json");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function loadCommands() {
  const data = readJson(getCommandsFile(), { commands: [] });
  return Array.isArray(data.commands) ? data.commands : [];
}

function saveCommands(commands) {
  writeJson(getCommandsFile(), { commands });
}

function updateCommand(commandId, updater) {
  const commands = loadCommands();
  const index = commands.findIndex((item) => item.id === commandId);
  if (index < 0) return null;
  commands[index] = { ...commands[index], ...updater(commands[index]) };
  saveCommands(commands);
  return commands[index];
}

function loadRuntime() {
  return readJson(getRuntimeFile(), { runtime: {} }).runtime || {};
}

function saveRuntime(runtime) {
  writeJson(getRuntimeFile(), { runtime });
}

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(getSettingsFile(), DEFAULT_SETTINGS) };
}

function saveSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
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

function getLogPath(id) {
  return path.join(getStoreDir(), "logs", `${id}.log`);
}

function clearLogFile(logPath) {
  fs.writeFileSync(logPath, "", "utf8");
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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
    .map(([key, value]) => `$psi.Environment['${escapePowerShellString(key)}'] = '${escapePowerShellString(value)}'`)
    .join("\n");
  const redirect = logMode === "append" ? ">>" : ">";

  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = '/d /s /c "chcp 65001>nul & ${escapePowerShellString(commandLine)} 1${redirect}\\"${escapePowerShellString(logPath)}\\" 2>&1"'
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
${command.cwd ? `$psi.WorkingDirectory = '${escapePowerShellString(command.cwd)}'` : ""}
${envScript}
$process = [System.Diagnostics.Process]::Start($psi)
$process.Id
`.trim();
}

function getShellCommand(command, args) {
  const joined = [command, args].filter(Boolean).join(" ").trim();
  if (process.platform === "win32") {
    return { file: "cmd.exe", args: ["/d", "/s", "/c", `chcp 65001>nul & ${joined}`] };
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
    ...base
  };
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
  mainWindow.webContents.send("runtime-updated");
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

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForPidExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidExists(pid)) return true;
    sleepMs(100);
  }
  return !pidExists(pid);
}

function terminateProcess(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
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
  pollTimer = setInterval(() => {
    let changed = false;
    const runtime = loadRuntime();
    const commandsById = new Map(loadCommands().map((command) => [command.id, command]));

    for (const [id, info] of Object.entries(runtime)) {
      const managed = processes.get(id);
      const command = managed?.command || commandsById.get(id);
      const childRunning = managed?.child ? managed.child.exitCode === null : false;
      if (info?.pid && pidExists(info.pid) && childRunning) continue;
      if (info?.pid && pidExists(info.pid) && !managed) continue;

      const exitCode = managed?.child?.exitCode;

      try {
        managed?.stream?.end();
      } catch {}

      delete runtime[id];
      processes.delete(id);
      saveRuntime(runtime);
      updateCommand(id, (command) => ({
        lastExitCode: exitCode,
        lastStoppedAt: nowIso(),
        updatedAt: nowIso(),
        lastState: exitCode === 0 ? "stopped" : "error"
      }));
      changed = true;

      if (command?.autoRestart) {
        setTimeout(() => {
          startCommand(command);
          updateRenderer();
        }, 1200);
      }
    }

    if (changed) {
      refreshTrayMenu();
      updateRenderer();
    }
  }, 1000);
}

function startCommand(command) {
  const currentRuntime = loadRuntime();
  const settings = loadSettings();
  const existingRuntime = currentRuntime[command.id];
  if (existingRuntime?.pid && pidExists(existingRuntime.pid)) {
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
    clearLogFile(logPath);
  }
  let child = null;
  let stream = null;
  let runtimePid = null;

  if (process.platform === "win32") {
    const script = getWindowsHiddenLaunchScript(command, logPath, logMode);
    const output = execFileSync(getWindowsPowerShellPath(), ["-NoProfile", "-EncodedCommand", encodePowerShellCommand(script)], {
      encoding: "utf8",
      windowsHide: true
    });
    runtimePid = Number(String(output).trim().split(/\r?\n/).filter(Boolean).at(-1));
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
    logPath
  });

  if (child) {
    processes.set(command.id, { child, stream, command });
  }
  currentRuntime[command.id] = {
    pid: runtimePid,
    startedAt: status.startedAt,
    logPath
  };
  saveRuntime(currentRuntime);
  updateCommand(command.id, () => ({
    lastStartedAt: status.startedAt,
    lastExitCode: null,
    updatedAt: nowIso(),
    lastState: "running"
  }));
  refreshTrayMenu();
  return status;
}

function stopCommand(id) {
  const runtime = loadRuntime();
  const data = runtime[id];
  if (!data?.pid) {
    return createStatus({ state: "stopped", message: "Not running" });
  }

  terminateProcess(data.pid);
  waitForPidExit(data.pid);
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
    lastState: "stopped"
  }));

  refreshTrayMenu();
  return createStatus({
    state: "stopped",
    stoppedAt: nowIso(),
    message: "Stopped",
    logPath: data.logPath || ""
  });
}

function getStatuses() {
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
        logPath: info.logPath
      });
    } else {
      statuses[command.id] = createStatus({
        state: command.lastState === "error" ? "error" : "stopped",
        message: "Idle",
        stoppedAt: command.lastStoppedAt || null,
        lastExitCode: command.lastExitCode ?? null,
        logPath: info?.logPath || getLogPath(command.id)
      });
    }
  }
  return statuses;
}

function readLogTail(logPath) {
  try {
    const content = fs.readFileSync(logPath);
    const text = content.toString("utf8");
    return stripAnsiSequences(text).slice(-12000);
  } catch {
    return "";
  }
}

function stripAnsiSequences(text) {
  return String(text || "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\u0000/g, "");
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

function formatProcessMemory(megabytes) {
  if (!Number.isFinite(megabytes)) return "--";
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(2)} GB`;
  return `${megabytes.toFixed(1)} MB`;
}

function parseJsonArray(text) {
  const value = String(text || "").trim();
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const firstBracket = value.search(/[\[{]/);
    const lastSquare = value.lastIndexOf("]");
    const lastCurly = value.lastIndexOf("}");
    const lastBracket = Math.max(lastSquare, lastCurly);
    if (firstBracket < 0 || lastBracket < firstBracket) return [];

    try {
      const parsed = JSON.parse(value.slice(firstBracket, lastBracket + 1));
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }
}

function getWindowsPowerShellPath() {
  const root = process.env.SystemRoot || "C:\\Windows";
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function normalizeProcessLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^"+|"+$/g, "")
    .replace(/\.(exe|cmd|bat|ps1|sh)$/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function getCommandAliases(command) {
  const aliases = new Set();
  const rawName = String(command.name || "").trim();
  const commandPath = String(command.command || "").trim().replace(/^"+|"+$/g, "");
  const executableName = path.basename(commandPath || "");

  for (const value of [rawName, executableName, executableName.replace(/\.[^.]+$/, "")]) {
    const normalized = normalizeProcessLabel(value);
    if (normalized) aliases.add(normalized);
  }

  for (const token of rawName.split(/[\s_\-]+/)) {
    const normalized = normalizeProcessLabel(token);
    if (normalized.length >= 3) aliases.add(normalized);
  }

  return {
    aliases: [...aliases]
  };
}

function matchProcessToCommand(processItem, commandMatchers, runtimePidMap) {
  const runtimeMatch = runtimePidMap.get(processItem.pid);
  if (runtimeMatch) {
    return {
      matchedCommandId: runtimeMatch.id,
      matchedCommandName: runtimeMatch.name,
      matchedGroup: runtimeMatch.group || "",
      matchedState: runtimeMatch.state || "stopped",
      matchType: "pid",
      isManaged: true
    };
  }

  const processName = normalizeProcessLabel(processItem.name);
  if (!processName) return null;

  for (const matcher of commandMatchers) {
    if (matcher.aliases.some((alias) => alias === processName || alias.startsWith(processName) || processName.startsWith(alias))) {
      return {
        matchedCommandId: matcher.id,
        matchedCommandName: matcher.name,
        matchedGroup: matcher.group || "",
        matchedState: matcher.state || "stopped",
        matchType: "name",
        isManaged: true
      };
    }
    if (matcher.aliases.some((alias) => {
      if (!alias || alias.length < 2) return false;
      return processName.includes(alias) || alias.includes(processName);
    })) {
      return {
        matchedCommandId: matcher.id,
        matchedCommandName: matcher.name,
        matchedGroup: matcher.group || "",
        matchedState: matcher.state || "stopped",
        matchType: "fuzzy",
        isManaged: true
      };
    }
  }

  return null;
}

function listMatchedSystemProcesses() {
  const systemProcesses = listSystemProcesses();
  const commands = loadCommands();
  const statuses = getStatuses();
  const runtimePidMap = new Map();
  const commandMatchers = commands.map((command) => ({
    id: command.id,
    name: command.name,
    group: command.group || "",
    state: statuses[command.id]?.state || command.lastState || "stopped",
    ...getCommandAliases(command)
  }));

  for (const command of commands) {
    const pid = statuses[command.id]?.pid;
    if (pid) {
      runtimePidMap.set(pid, {
        id: command.id,
        name: command.name,
        group: command.group || "",
        state: statuses[command.id]?.state || "running"
      });
    }
  }

  return systemProcesses
    .map((processItem) => {
      const matched = matchProcessToCommand(processItem, commandMatchers, runtimePidMap);
      return {
        ...processItem,
        matchedCommandId: matched?.matchedCommandId || "",
        matchedCommandName: matched?.matchedCommandName || "",
        matchedGroup: matched?.matchedGroup || "",
        matchedState: matched?.matchedState || "",
        matchType: matched?.matchType || "",
        isManaged: Boolean(matched?.isManaged),
        path: processItem.path || ""
      };
    })
    .sort((left, right) => {
      if (left.isManaged !== right.isManaged) return left.isManaged ? -1 : 1;
      if (left.matchType !== right.matchType) return left.matchType === "pid" ? -1 : 1;
      return String(left.name || "").localeCompare(String(right.name || ""));
    });
}

function mapWindowsProcessItems(processes) {
  return processes
    .map((item) => {
      const pid = Number(item.Id ?? item.ProcessId);
      const rawName = item.ProcessName || item.Name || "";
      const normalizedName = rawName && !/\.[a-z0-9]+$/i.test(rawName) ? `${rawName}.exe` : rawName;
      const workingSetBytes = Number(item.WS ?? item.WorkingSetSize);
      const memoryValue = workingSetBytes / (1024 * 1024);
      const cpuValue = Number(item.CPU);

      return {
        pid,
        name: normalizedName,
        path: item.Path || item.ExecutablePath || "",
        memory: formatProcessMemory(memoryValue),
        memoryValue: Number.isFinite(memoryValue) ? memoryValue : null,
        cpu: Number.isFinite(cpuValue) ? `${cpuValue.toFixed(1)} s` : "--",
        cpuValue: Number.isFinite(cpuValue) ? cpuValue : null
      };
    })
    .filter((item) => Number.isFinite(item.pid));
}

function listWindowsProcessesViaPowerShell() {
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$items = Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  $proc = $_
  $path = ""
  try { $path = $proc.Path } catch {}
  [PSCustomObject]@{
    Id = $proc.Id
    ProcessName = $proc.ProcessName
    CPU = $proc.CPU
    Path = $path
    WS = $proc.WS
  }
}
$items | ConvertTo-Json -Compress
`.trim();
  const output = execFileSync(getWindowsPowerShellPath(), ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true
  });
  return mapWindowsProcessItems(parseJsonArray(output));
}

function listWindowsProcessesViaCim() {
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$items = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  [PSCustomObject]@{
    ProcessId = $_.ProcessId
    Name = $_.Name
    ExecutablePath = $_.ExecutablePath
    WorkingSetSize = $_.WorkingSetSize
  }
}
$items | ConvertTo-Json -Compress
`.trim();
  const output = execFileSync(getWindowsPowerShellPath(), ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true
  });
  return mapWindowsProcessItems(parseJsonArray(output));
}

function listSystemProcesses() {
  try {
    if (process.platform === "win32") {
      try {
        const processes = listWindowsProcessesViaPowerShell();
        if (processes.length > 0) return processes;
      } catch {
        // Fall through to more compatible Windows collectors.
      }

      try {
        const processes = listWindowsProcessesViaCim();
        if (processes.length > 0) return processes;
      } catch {
        // Fall through to tasklist as the last resort.
      }

      const output = execFileSync("tasklist", ["/FO", "CSV", "/NH"], {
        encoding: "utf8",
        windowsHide: true
      });
      return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [imageName, pid, sessionName, sessionNumber, memUsage] = parseCsvLine(line);
          return {
            pid: Number(pid),
            name: imageName,
            path: "",
            sessionName,
            sessionNumber,
            memory: memUsage,
            memoryValue: null,
            cpu: "--",
            cpuValue: null
          };
        })
        .filter((item) => Number.isFinite(item.pid));
    }

    const output = execFileSync("ps", ["-axo", "pid=,comm=,%cpu=,%mem=,etime="], {
      encoding: "utf8"
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/, 5);
        return {
          pid: Number(parts[0]),
          name: parts[1] || "",
          path: parts[1] || "",
          cpu: parts[2] || "--",
          cpuValue: Number(parts[2]) || null,
          memory: parts[3] || "--",
          memoryValue: Number(parts[3]) || null,
          elapsed: parts[4] || "--"
        };
      })
      .filter((item) => Number.isFinite(item.pid));
  } catch {
    return [];
  }
}

function killSystemProcess(pid) {
  if (!pid) return { ok: false };
  terminateProcess(pid);
  return { ok: true };
}

function startAllCommands(group) {
  const commands = loadCommands().filter((item) => !group || item.group === group);
  const statuses = {};
  for (const command of commands) {
    statuses[command.id] = startCommand(command);
  }
  updateRenderer();
  return statuses;
}

function stopAllCommands(group) {
  const commands = loadCommands().filter((item) => !group || item.group === group);
  const statuses = {};
  for (const command of commands) {
    statuses[command.id] = stopCommand(command.id);
  }
  updateRenderer();
  return statuses;
}

async function createWindow() {
  applyThemeMode(loadSettings().themeMode);
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 920,
    minWidth: 1220,
    minHeight: 760,
    icon: getWindowIconPath(),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#071118",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
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
  return { commands, statuses, settings };
});
safeHandle("app:save-command", async (_event, payload) => {
  const commands = loadCommands();
  const index = commands.findIndex((item) => item.id === payload.id);
  if (index >= 0) commands[index] = payload;
  else commands.push(payload);
  saveCommands(commands);
  refreshTrayMenu();
  updateRenderer();
  return { ok: true };
});
safeHandle("app:delete-command", async (_event, id) => {
  stopCommand(id);
  const commands = loadCommands().filter((item) => item.id !== id);
  saveCommands(commands);
  refreshTrayMenu();
  updateRenderer();
  return { ok: true };
});
safeHandle("app:start-command", async (_event, command) => {
  const status = startCommand(command);
  updateRenderer();
  return status;
});
safeHandle("app:stop-command", async (_event, id) => {
  const status = stopCommand(id);
  updateRenderer();
  return status;
});
safeHandle("app:restart-command", async (_event, command) => {
  stopCommand(command.id);
  const status = startCommand(command);
  updateRenderer();
  return status;
});
safeHandle("app:start-all", async (_event, group) => startAllCommands(group));
safeHandle("app:stop-all", async (_event, group) => stopAllCommands(group));
safeHandle("app:get-log-tail", async (_event, logPath) => readLogTail(logPath));
safeHandle("app:clear-log", async (_event, logPath) => {
  clearLogFile(logPath);
  return { ok: true };
});

safeHandle("app:open-log-folder", async () => {
  await shell.openPath(path.join(getStoreDir(), "logs"));
  return { ok: true };
});
safeHandle("app:save-settings", async (_event, payload) => {
  const settings = saveSettings(payload);
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
safeHandle("app:list-system-processes", async () => listMatchedSystemProcesses());
safeHandle("app:kill-system-process", async (_event, pid) => killSystemProcess(pid));

app.whenReady().then(async () => {
  hydrateRuntime();
  saveSettings(loadSettings());
  ensureTray();
  watchProcesses();
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
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Keep tray-based behavior consistent across platforms.
  }
});
