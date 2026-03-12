const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, nativeTheme, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync, spawn } = require("node:child_process");

const { createStore } = require("./store");
const { killSystemProcess, listMatchedSystemProcesses } = require("./system-processes");

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
  loadRuntime,
  saveRuntime,
  getLogPath,
  clearLogFile,
  readLogTail
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
      env: typeof item.env === "object" && item.env ? item.env : {},
      autoRestart: Boolean(item.autoRestart),
      createdAt: item.createdAt || nowIso(),
      updatedAt: nowIso(),
      lastStartedAt: item.lastStartedAt || null,
      lastExitCode: item.lastExitCode ?? null,
      lastStoppedAt: item.lastStoppedAt || null,
      lastState: item.lastState || "stopped"
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

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

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
safeHandle("app:export-commands", async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export command list",
    defaultPath: path.join(app.getPath("documents"), "command-hub-commands.json"),
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  fs.writeFileSync(result.filePath, JSON.stringify({ commands: loadCommands() }, null, 2), "utf8");
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
  refreshTrayMenu();
  updateRenderer();
  return { ok: true, filePath: result.filePaths[0], count: imported.length, total: merged.size };
});
safeHandle("app:list-system-processes", async () => listMatchedSystemProcesses(loadCommands(), getStatuses()));
safeHandle("app:kill-system-process", async (_event, pid) => killSystemProcess(pid, terminateProcess));

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
  const settings = loadSettings();
  if (process.platform !== "darwin" && !settings.closeToTray) {
    forceQuit = true;
    app.quit();
  }
});
