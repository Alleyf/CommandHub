const path = require("node:path");
const { execFileSync } = require("node:child_process");

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

function listMatchedSystemProcesses(commands, statuses) {
  const systemProcesses = listSystemProcesses();
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

async function killSystemProcess(pid, terminateProcess) {
  if (!pid) return { ok: false };
  await terminateProcess(pid);
  return { ok: true };
}

module.exports = {
  listMatchedSystemProcesses,
  killSystemProcess,
  getWindowsPowerShellPath
};
