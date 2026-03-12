const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("commandHub", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  saveCommand: (payload) => ipcRenderer.invoke("app:save-command", payload),
  deleteCommand: (id) => ipcRenderer.invoke("app:delete-command", id),
  startCommand: (command) => ipcRenderer.invoke("app:start-command", command),
  stopCommand: (id) => ipcRenderer.invoke("app:stop-command", id),
  restartCommand: (command) => ipcRenderer.invoke("app:restart-command", command),
  startAll: (group) => ipcRenderer.invoke("app:start-all", group),
  stopAll: (group) => ipcRenderer.invoke("app:stop-all", group),
  getLogTail: (logPath) => ipcRenderer.invoke("app:get-log-tail", logPath),
  clearLog: (logPath) => ipcRenderer.invoke("app:clear-log", logPath),
  openLogFolder: () => ipcRenderer.invoke("app:open-log-folder"),
  saveSettings: (payload) => ipcRenderer.invoke("app:save-settings", payload),
  showWindow: () => ipcRenderer.invoke("app:show-window"),
  pickCommandFile: () => ipcRenderer.invoke("app:pick-command-file"),
  pickDirectory: () => ipcRenderer.invoke("app:pick-directory"),
  exportCommands: () => ipcRenderer.invoke("app:export-commands"),
  importCommands: () => ipcRenderer.invoke("app:import-commands"),
  listSystemProcesses: () => ipcRenderer.invoke("app:list-system-processes"),
  killSystemProcess: (pid) => ipcRenderer.invoke("app:kill-system-process", pid),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  onRuntimeUpdated: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("runtime-updated", handler);
    return () => ipcRenderer.removeListener("runtime-updated", handler);
  }
});
