const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, nativeTheme, shell } = require("electron");
const path = require("node:path");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const { execFile, execFileSync, spawn } = require("node:child_process");
const util = require("node:util");
const execFileAsync = util.promisify(execFile);

const { createStore } = require("./store");
const { killSystemProcess, listMatchedSystemProcesses, getWindowsPowerShellPath } = require("./system-processes");

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
  recordUsage,
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
$process = Start-Process -FilePath "cmd.exe" -ArgumentList @('/d', '/c', '${escapePowerShellString(innerCmd)}') -WorkingDirectory '${escapePowerShellString(command.cwd || ".")}' -WindowStyle Hidden -PassThru
"PID:$($process.Id)"
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
  pollTimer = setInterval(() => {
    let changed = false;
    const runtime = loadRuntime();
    const commandsById = new Map(loadCommands().map((command) => [command.id, command]));

    for (const [id, info] of Object.entries(runtime)) {
      const managed = processes.get(id);
      const command = managed?.command || commandsById.get(id);
      
      const isAlive = info?.pid && pidExists(info.pid);
      const isChildAlive = managed?.child ? managed.child.exitCode === null : true;
      
      if (isAlive && isChildAlive) continue;

      const exitCode = managed?.child?.exitCode ?? null;

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
        lastState: (exitCode === 0 || exitCode === null || exitCode === undefined) ? "stopped" : "error"
      }));
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
  }, 1000);
}

function extractPid(text) {
  const match = String(text || "").match(/PID:(\d+)/);
  if (match) {
    return Number(match[1]);
  }
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (/^\d+$/.test(line)) {
      return Number(line);
    }
  }
  return NaN;
}

async function startCommand(command) {
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
    let cleared = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (clearLogFile(logPath)) {
        cleared = true;
        break;
      }
      await sleepMs(300);
    }
    if (!cleared) {
      console.warn(`Giving up on clearing log file for ${command.id} after 5 attempts.`);
      return createStatus({
        state: "error",
        message: "Log file is busy and could not be cleared. Please try again in a few seconds.",
        logPath
      });
    }
  }
  let child = null;
  let stream = null;
  let runtimePid = null;

  if (process.platform === "win32") {
    try {
      const script = getWindowsHiddenLaunchScript(command, logPath, logMode);
      const { stdout } = await execFileAsync(getWindowsPowerShellPath(), ["-NoProfile", "-EncodedCommand", encodePowerShellCommand(script)], {
        encoding: "utf8",
        windowsHide: true
      });
      runtimePid = extractPid(stdout);
      if (Number.isNaN(runtimePid)) {
        throw new Error(`Could not determine process PID from PowerShell output: ${stdout}`);
      }
    } catch (error) {
      console.error(`Failed to start command ${command.id}:`, error);
      return createStatus({
        state: "error",
        message: String(error.message || error),
        logPath
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

async function stopCommand(id) {
  const runtime = loadRuntime();
  const data = runtime[id];
  if (!data?.pid) {
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
      const state = command.lastState === "running" ? "stopped" : (command.lastState || "stopped");
      statuses[command.id] = createStatus({
        state: state === "error" ? "error" : "stopped",
        message: "Idle",
        stoppedAt: command.lastStoppedAt || null,
        lastExitCode: command.lastExitCode ?? null,
        logPath: info?.logPath || getLogPath(command.id)
      });
    }
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
  await stopCommand(id);
  const commands = loadCommands().filter((item) => item.id !== id);
  saveCommands(commands);
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
safeHandle("app:kill-system-process", async (_event, pid) => await killSystemProcess(pid, terminateProcess));
safeHandle("app:check-for-updates", async () => {
  if (isDev) {
    console.log("[AutoUpdate] Manual check skipped in dev");
    return { ok: false, error: "Manual updates disabled in development mode" };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

function setupAutoUpdater() {
  if (isDev) {
    console.log("[AutoUpdate] Skipped in dev");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[AutoUpdate] Checking for updates...");
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[AutoUpdate] Update available:", info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:available", info);
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
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "info",
      title: "Update Ready",
      message: "A new version has been downloaded. Restart now to apply?",
      buttons: ["Restart Now", "Later"]
    });
    if (choice === 0) {
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
  setupAutoUpdater();
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

safeHandle("app:get-usage-stats",async()=>loadUsageStats());
safeHandle("app:get-recommended",async()=>{const top=getTopCommands(5);const cmds=loadCommands();const map=new Map(cmds.map(c=>[c.id,c]));return top.map(t=>map.get(t.id)).filter(Boolean);});