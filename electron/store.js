const fs = require("node:fs");
const path = require("node:path");

function stripAnsiSequences(text) {
  return String(text || "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\u0000/g, "");
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

function createStore(getUserDataPath) {
  function getStoreDir() {
    const dir = path.join(getUserDataPath(), "command-hub");
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

  function getUsageStatsFile() {
    return path.join(getStoreDir(), "usage-stats.json");
  }

  function getSettingsFile() {
    return path.join(getStoreDir(), "settings.json");
  }

  function getOperationLogFile() {
    return path.join(getStoreDir(), "operation-log.json");
  }

  function getProductivityFile() {
    return path.join(getStoreDir(), "productivity.json");
  }

  function getLogsDir() {
    return path.join(getStoreDir(), "logs");
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

  function loadUsageStats() {
    return readJson(getUsageStatsFile(), { counts: {}, lastUsed: {} });
  }

  function saveUsageStats(value) {
    writeJson(getUsageStatsFile(), value);
  }

  function recordUsage(commandId) {
    if (!commandId) return;
    const usage = loadUsageStats();
    usage.counts[commandId] = (usage.counts[commandId] || 0) + 1;
    usage.lastUsed[commandId] = new Date().toISOString();
    saveUsageStats(usage);
  }

  function getTopCommands(limit = 5) {
    const usage = loadUsageStats();
    return Object.entries(usage.counts || {})
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([id, count]) => ({ id, count, lastUsedAt: usage.lastUsed?.[id] || null }));
  }

  function loadRuntime() {
    return readJson(getRuntimeFile(), { runtime: {} }).runtime || {};
  }

  function saveRuntime(runtime) {
    writeJson(getRuntimeFile(), { runtime });
  }

  function getLogPath(id) {
    return path.join(getLogsDir(), `${id}.log`);
  }

  function clearLogFile(logPath) {
    try {
      fs.writeFileSync(logPath, "", "utf8");
      return true;
    } catch (error) {
      if (error.code === "EBUSY") {
        console.warn(`Could not clear log file (busy): ${logPath}`);
        return false;
      }
      throw error;
    }
  }

  function readLogTail(logPath, maxChars = 12000) {
    try {
      const content = fs.readFileSync(logPath, "utf8");
      return stripAnsiSequences(content).slice(-maxChars);
    } catch {
      return "";
    }
  }

  function loadOperationLog() {
    const data = readJson(getOperationLogFile(), { entries: [] });
    return Array.isArray(data.entries) ? data.entries : [];
  }

  function saveOperationLog(entries) {
    writeJson(getOperationLogFile(), { entries });
  }

  function appendOperationLog(entry) {
    const entries = loadOperationLog();
    entries.unshift(entry);
    saveOperationLog(entries.slice(0, 1000));
  }

  function clearOperationLog() {
    saveOperationLog([]);
  }

  function loadProductivityState() {
    return readJson(getProductivityFile(), {});
  }

  function saveProductivityState(value) {
    writeJson(getProductivityFile(), value || {});
  }

  function buildGlobalLogEntries(commands, runtime, options = {}) {
    const { category = "", commandId = "", query = "", limit = 200 } = options;
    const normalizedQuery = String(query || "").trim().toLowerCase();
    const operationEntries = loadOperationLog().map((entry) => ({
      ...entry,
      kind: "operation"
    }));
    const commandEntries = commands.map((command) => {
      const info = runtime[command.id];
      const logPath = info?.logPath || getLogPath(command.id);
      return {
        id: `command:${command.id}`,
        kind: "command",
        category: "command",
        level: command.lastState === "error" ? "error" : command.lastState === "running" ? "success" : "info",
        createdAt: command.updatedAt || command.lastStoppedAt || command.lastStartedAt || command.createdAt || new Date().toISOString(),
        commandId: command.id,
        commandName: command.name,
        title: command.name,
        summary: [command.command, command.args].filter(Boolean).join(" "),
        state: command.lastState || "stopped",
        lastStartedAt: command.lastStartedAt || null,
        lastStoppedAt: command.lastStoppedAt || null,
        lastExitCode: command.lastExitCode ?? null,
        logPath,
        tail: readLogTail(logPath, 4000)
      };
    });

    return [...operationEntries, ...commandEntries]
      .filter((entry) => {
        const categoryMatch = !category || entry.category === category || entry.kind === category;
        const commandMatch = !commandId || entry.commandId === commandId;
        const text = [
          entry.title,
          entry.summary,
          entry.commandName,
          entry.commandId,
          entry.level,
          entry.category,
          entry.state,
          entry.tail
        ].join(" ").toLowerCase();
        const queryMatch = !normalizedQuery || text.includes(normalizedQuery);
        return categoryMatch && commandMatch && queryMatch;
      })
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, limit);
  }

  return {
    getStoreDir,
    getCommandsFile,
    getRuntimeFile,
    getSettingsFile,
    getLogsDir,
    getOperationLogFile,
    getProductivityFile,
    readJson,
    writeJson,
    loadCommands,
    saveCommands,
    updateCommand,
    loadUsageStats,
    saveUsageStats,
    recordUsage,
    getTopCommands,
    loadRuntime,
    saveRuntime,
    getLogPath,
    clearLogFile,
    readLogTail,
    loadOperationLog,
    saveOperationLog,
    appendOperationLog,
    clearOperationLog,
    loadProductivityState,
    saveProductivityState,
    buildGlobalLogEntries
  };
}

module.exports = {
  createStore
};
