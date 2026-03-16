const { contextBridge, ipcRenderer, webUtils, clipboard } = require("electron");

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
  scanTemplateLibraries: (templates) => ipcRenderer.invoke("app:scan-template-libraries", templates),
  getGlobalLogs: (options) => ipcRenderer.invoke("app:get-global-logs", options),
  exportGlobalLogs: (options) => ipcRenderer.invoke("app:export-global-logs", options),
  clearOperationLogs: () => ipcRenderer.invoke("app:clear-operation-logs"),
  listSystemProcesses: () => ipcRenderer.invoke("app:list-system-processes"),
  killSystemProcess: (pid) => ipcRenderer.invoke("app:kill-system-process", pid),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  getProductivityOverview: () => ipcRenderer.invoke("app:get-productivity-overview"),
  saveProductivitySettings: (payload) => ipcRenderer.invoke("app:save-productivity-settings", payload),
  scanDuplicateFiles: (payload) => ipcRenderer.invoke("app:scan-duplicate-files", payload),
  scanStaleFiles: (payload) => ipcRenderer.invoke("app:scan-stale-files", payload),
  deleteFiles: (payload) => ipcRenderer.invoke("app:delete-files", payload),
  archiveFiles: (payload) => ipcRenderer.invoke("app:archive-files", payload),
  convertVideoToGif: (payload) => ipcRenderer.invoke("app:convert-video-to-gif", payload),
  scanPorts: (payload) => ipcRenderer.invoke("app:scan-ports", payload),
  releasePort: (payload) => ipcRenderer.invoke("app:release-port", payload),
  pickVideoFile: () => ipcRenderer.invoke("app:pick-video-file"),
  pickGifSavePath: () => ipcRenderer.invoke("app:pick-gif-save-path"),
  openPath: (path) => ipcRenderer.invoke("app:open-path", path),
  copyToClipboard: (text) => ipcRenderer.invoke("app:copy-to-clipboard", text),
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
  },
  onUpdateProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on("update:progress", handler);
    return () => ipcRenderer.removeListener("update:progress", handler);
  },
  onUpdateDownloaded: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("update:downloaded", handler);
    return () => ipcRenderer.removeListener("update:downloaded", handler);
  }
});
