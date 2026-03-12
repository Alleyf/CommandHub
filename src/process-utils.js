export const PROCESS_PAGE_SIZE = 200;
const PROCESS_SECTION_HEIGHT = 52;
const PROCESS_GROUP_HEIGHT = 74;
const PROCESS_CHILD_HEIGHT = 66;

function normalizeProcessAlias(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1|sh)$/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function getManagedCommandAliases(command) {
  const aliases = new Set();
  const rawName = String(command?.name || "").trim();
  const rawCommand = String(command?.command || "").trim();
  const executable = rawCommand.split(/[/\\]/).pop() || rawCommand;

  for (const value of [rawName, rawCommand, executable, executable.replace(/\.[^.]+$/, "")]) {
    const normalized = normalizeProcessAlias(value);
    if (normalized) aliases.add(normalized);
  }

  for (const token of rawName.split(/[\s_-]+/)) {
    const normalized = normalizeProcessAlias(token);
    if (normalized.length >= 3) aliases.add(normalized);
  }

  return [...aliases];
}

function normalizeProcessGroupKey(item) {
  const name = String(item?.name || "").toLowerCase();
  const processPath = String(item?.path || "").toLowerCase();
  return `${name}::${processPath}`;
}

function getProcessBaseName(name) {
  const value = String(name || "").trim();
  return value.replace(/\.[^.]+$/, "") || value;
}

function classifyProcess(item) {
  const name = String(item?.name || "").toLowerCase();
  const processPath = String(item?.path || "").toLowerCase();
  const windowsRoots = ["c:\\windows\\", "c:\\program files\\windowsapps\\", "\\system32\\", "\\syswow64\\"];
  const windowsNames = new Set([
    "system",
    "registry",
    "memory compression",
    "idle",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "services.exe",
    "lsass.exe",
    "winlogon.exe",
    "fontdrvhost.exe",
    "dwm.exe",
    "svchost.exe",
    "sihost.exe",
    "taskhostw.exe",
    "startmenuexperiencehost.exe",
    "shellexperiencehost.exe",
    "ctfmon.exe"
  ]);

  if (windowsNames.has(name) || windowsRoots.some((root) => processPath.includes(root))) {
    return "windows";
  }
  if (processPath.includes("program files") || processPath.includes("appdata") || processPath.includes("desktop") || processPath.includes("documents")) {
    return "application";
  }
  return "background";
}

export function annotateMatchedProcesses(processes, commands, statuses) {
  const runtimePidMap = new Map();
  const matchers = commands.map((command) => ({
    id: command.id,
    name: command.name,
    group: command.group || "",
    state: statuses[command.id]?.state || command.lastState || "stopped",
    aliases: getManagedCommandAliases(command)
  }));

  for (const command of commands) {
    const pid = statuses[command.id]?.pid;
    if (pid) {
      runtimePidMap.set(pid, {
        matchedCommandId: command.id,
        matchedCommandName: command.name,
        matchedGroup: command.group || "",
        matchedState: statuses[command.id]?.state || "running",
        matchType: "pid",
        isManaged: true
      });
    }
  }

  return (processes || []).map((item) => {
    const runtimeMatch = runtimePidMap.get(item.pid);
    if (runtimeMatch) {
      return { ...item, ...runtimeMatch };
    }

    const processName = normalizeProcessAlias(item.name);
    const processPath = normalizeProcessAlias(item.path);
    const matched = matchers.find((matcher) =>
      matcher.aliases.some((alias) => alias && (
        processName.includes(alias) ||
        alias.includes(processName) ||
        (processPath && processPath.includes(alias))
      ))
    );

    if (!matched) {
      return {
        ...item,
        matchedCommandId: "",
        matchedCommandName: "",
        matchedGroup: "",
        matchedState: "",
        matchType: "",
        isManaged: false
      };
    }

    return {
      ...item,
      matchedCommandId: matched.id,
      matchedCommandName: matched.name,
      matchedGroup: matched.group,
      matchedState: matched.state,
      matchType: "name",
      isManaged: true
    };
  });
}

export function buildProcessGroups(processes) {
  const groups = new Map();

  for (const item of processes || []) {
    const key = normalizeProcessGroupKey(item);
    const existing = groups.get(key) || {
      key,
      name: getProcessBaseName(item.name),
      displayName: item.name,
      path: item.path || "",
      memoryValue: 0,
      cpuValue: 0,
      category: classifyProcess(item),
      items: [],
      pids: [],
      isManaged: false,
      matchedCommandNames: [],
      matchTypes: []
    };

    existing.items.push(item);
    existing.pids.push(item.pid);
    existing.memoryValue += Number(item.memoryValue) || 0;
    existing.cpuValue += Number(item.cpuValue) || 0;
    existing.isManaged = existing.isManaged || Boolean(item.isManaged);
    if (item.matchedCommandName) existing.matchedCommandNames.push(item.matchedCommandName);
    if (item.matchType) existing.matchTypes.push(item.matchType);
    groups.set(key, existing);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    count: group.items.length,
    primaryPid: Math.min(...group.pids),
    memory: group.memoryValue > 0 ? (group.memoryValue >= 1024 ? `${(group.memoryValue / 1024).toFixed(2)} GB` : `${group.memoryValue.toFixed(1)} MB`) : group.items[0]?.memory || "--",
    cpu: group.cpuValue > 0 ? `${group.cpuValue.toFixed(1)} s` : group.items[0]?.cpu || "--",
    matchedCommandNames: [...new Set(group.matchedCommandNames)],
    matchTypes: [...new Set(group.matchTypes)],
    items: [...group.items].sort((a, b) => a.pid - b.pid)
  }));
}

export function buildVirtualProcessRows(sections, expandedProcessGroups) {
  const rows = [];

  for (const section of sections || []) {
    rows.push({
      key: `section:${section.key}`,
      type: "section",
      height: PROCESS_SECTION_HEIGHT,
      section
    });

    for (const group of section.items || []) {
      const expanded = Boolean(expandedProcessGroups?.[group.key]);
      rows.push({
        key: `group:${group.key}`,
        type: "group",
        height: PROCESS_GROUP_HEIGHT,
        expanded,
        group
      });

      if (expanded && group.count > 1) {
        for (const item of group.items || []) {
          rows.push({
            key: `item:${group.key}:${item.pid}`,
            type: "item",
            height: PROCESS_CHILD_HEIGHT,
            item,
            parentKey: group.key
          });
        }
      }
    }
  }

  return rows;
}

export function getVirtualSlice(rows, scrollTop, viewportHeight) {
  const safeRows = rows || [];
  const totalHeight = safeRows.reduce((sum, row) => sum + (row.height || PROCESS_GROUP_HEIGHT), 0);

  if (safeRows.length === 0) {
    return {
      items: [],
      totalHeight: 0,
      topSpacer: 0
    };
  }

  const startEdge = Math.max(0, Number(scrollTop) || 0);
  const endEdge = startEdge + Math.max(Number(viewportHeight) || 0, 640);
  const overscan = 240;

  let cursor = 0;
  let startIndex = 0;
  let endIndex = safeRows.length - 1;

  for (let index = 0; index < safeRows.length; index += 1) {
    const nextCursor = cursor + (safeRows[index].height || PROCESS_GROUP_HEIGHT);
    if (nextCursor >= Math.max(0, startEdge - overscan)) {
      startIndex = index;
      break;
    }
    cursor = nextCursor;
  }

  cursor = 0;
  for (let index = 0; index < safeRows.length; index += 1) {
    cursor += safeRows[index].height || PROCESS_GROUP_HEIGHT;
    if (cursor >= endEdge + overscan) {
      endIndex = index;
      break;
    }
  }

  const topSpacer = safeRows
    .slice(0, startIndex)
    .reduce((sum, row) => sum + (row.height || PROCESS_GROUP_HEIGHT), 0);

  return {
    items: safeRows.slice(startIndex, endIndex + 1),
    totalHeight,
    topSpacer
  };
}
