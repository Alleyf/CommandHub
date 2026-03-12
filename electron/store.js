const fs = require("node:fs");
const path = require("node:path");

function stripAnsiSequences(text) {
  return String(text || "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\u0000/g, "");
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

  function getUsageStatsFile(){return path.join(getStoreDir(),usage-stats.json);}

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

  function loadUsageStats(){return readJson(getUsageStatsFile(),{});}

function loadRuntime() {
    return readJson(getRuntimeFile(), { runtime: {} }).runtime || {};
  }

  function recordUsage(c){const u=loadUsageStats();u[c]=(u[c]||0)+1;u._lastUsed=u._lastUsed||{};u._lastUsed[c]=new Date().toISOString();saveUsageStats(u);}function getTopCommands(l=5){const u=loadUsageStats();return Object.entries(u).filter(([k])=>k!=_lastUsed).sort((a,b)=>b[1]-a[1]).slice(0,l).map(([i,c])=>({id:i,count:c}));}function saveUsageStats(x){writeJson(getUsageStatsFile(),x);}
function saveRuntime(runtime) {
    writeJson(getRuntimeFile(), { runtime });
  }

  function getLogPath(id) {
    return path.join(getStoreDir(), "logs", `${id}.log`);
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

  function readLogTail(logPath) {
    try {
      const content = fs.readFileSync(logPath);
      const text = content.toString("utf8");
      return stripAnsiSequences(text).slice(-12000);
    } catch {
      return "";
    }
  }

  return {
    getStoreDir,
    getCommandsFile,
    getRuntimeFile,
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
  };
}

module.exports = {
  createStore
};
