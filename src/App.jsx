import { useEffect, useMemo, useRef, useState } from "react";

const EMPTY_FORM = {
  id: "",
  name: "",
  command: "",
  args: "",
  cwd: "",
  envText: "",
  group: ""
};
const NEW_GROUP_VALUE = "__new_group__";

const MESSAGES = {
  "zh-CN": {
    brandTag: "后台服务管理器",
    appTitle: "Command Hub",
    lede: "把常驻 CLI、网关、开发服务和本地守护进程收进一个更清爽的控制台。",
    navCommands: "命令",
    navSettings: "设置",
    managedCommands: "管理中的命令",
    configuredInventory: "已配置条目",
    currentlyRunning: "当前运行中",
    activeInBackground: "后台活跃中",
    stoppedOrIdle: "已停止或空闲",
    readyToLaunch: "随时可启动",
    newCommand: "新建命令",
    editSelected: "编辑选中项",
    deleteSelected: "删除选中项",
    silentMode: "静默模式",
    silentModeDesc: "Windows 会隐藏终端窗口，macOS 和 Linux 会以独立会话运行。",
    settings: "设置",
    closeToTray: "关闭窗口时最小化到托盘",
    launchAtLogin: "开机自动启动应用",
    language: "语言",
    themeMode: "主题模式",
    themeSystem: "跟随系统",
    themeDark: "黑夜",
    themeLight: "白天",
    themeModeHelp: "支持白天、黑夜和跟随系统三种主题，整个应用会一起切换。",
    operationsDeck: "运行面板",
    heroTitle: "用一个桌面控制台统一编排命令行服务",
    heroDesc: "集中管理任何由命令行拉起的常驻进程，统一启动、停止、重启、状态监控和日志查看。",
    searchPlaceholder: "搜索命令、参数、工作目录或分组...",
    openLogs: "打开日志目录",
    clearLog: "清空日志",
    startAll: "全部启动",
    stopAll: "全部停止",
    refresh: "刷新",
    managedInventory: "命令清单",
    processInventory: "进程清单",
    commandTab: "命令清单",
    processTab: "进程清单",
    visibleTotal: "{visible} 个可见 / 共 {total} 个",
    emptyCommands: "还没有命令，先创建第一个后台任务。",
    commandDetail: "命令详情",
    pickCommand: "选择一个命令后，这里会显示运行详情。",
    runtimeControls: "运行控制",
    start: "启动",
    stop: "停止",
    restart: "重启",
    liveLogTail: "实时日志",
    openLogPanel: "查看日志",
    hideLogPanel: "收起日志",
    infoTab: "信息",
    logTab: "日志",
    autoScroll: "自动滚动",
    pauseFollow: "暂停跟随",
    logWillCreate: "首次启动后会自动生成日志文件。",
    noLogs: "暂无日志。",
    commandStudio: "命令工作台",
    editCommand: "编辑命令",
    createCommand: "创建命令",
    close: "关闭",
    displayName: "显示名称",
    executable: "可执行命令",
    arguments: "参数",
    workingDirectory: "工作目录",
    environmentVariables: "环境变量",
    cancel: "取消",
    saveCommand: "保存命令",
    command: "命令",
    workingDir: "工作目录",
    pid: "进程 ID",
    uptime: "运行时长",
    stateNote: "状态备注",
    enabled: "已启用",
    disabled: "未启用",
    projectCwd: "（项目当前目录）",
    group: "分组",
    allGroups: "全部分组",
    noGroup: "未分组",
    groupPlaceholder: "例如 gateway / dev / services",
    chooseGroup: "选择已有分组",
    createGroup: "新建分组",
    newGroupName: "新分组名称",
    newGroupPlaceholder: "输入新的分组名称",
    statusReady: "就绪",
    commandFieldHint: "可手动输入命令，也可选择具体的可执行文件或脚本",
    cwdFieldHint: "可手动输入，也可浏览选择工作目录",
    browseFile: "选择文件",
    browseFolder: "选择目录",
    compactList: "紧凑列表",
    compactListDesc: "缩小命令行高，更适合大量服务一起查看。",
    settingsDesc: "把应用层设置独立出来，避免和运行清单、日志阅读混在一起。",
    logMode: "日志模式",
    logModeOverwrite: "每次启动覆盖旧日志",
    logModeAppend: "持续追加日志",
    logModeHelp: "覆盖模式适合你现在的需求；追加模式适合排查长时间运行问题。",
    logsEmptySelect: "选择一个命令后，这里显示它的日志文件尾部。",
    selectedCommand: "当前命令",
    groupFilter: "分组筛选",
    stateFilter: "状态筛选",
    allStates: "全部状态",
    stateRunning: "运行中",
    stateStopped: "已停止",
    stateError: "异常",
    listSummary: "表格布局支持排序、状态过滤、分组过滤和最近运行信息。",
    sortBy: "排序",
    name: "名称",
    status: "状态",
    lastStarted: "最近启动",
    exitCode: "退出码",
    commandPath: "命令路径",
    processName: "进程名",
    processPath: "进程路径",
    confirmEndProcess: "确定结束进程 {name} (PID {pid}) 吗？",
    processToolbarTitle: "进程巡视",
    processToolbarDesc: "直接查看系统当前运行的全部进程，并支持搜索、排序和结束进程。",
    matchedOnly: "仅看匹配命令",
    allProcesses: "全部进程",
    matchedProcessHint: "已匹配命令",
    matchedByPid: "运行实例匹配",
    matchedByName: "名称匹配",
    matchedByFuzzy: "模糊匹配",
    memory: "内存",
    cpu: "CPU",
    action: "操作",
    endProcess: "结束进程",
    processSummary: "显示系统当前正在运行的进程，类似任务管理器。",
    processGroupedSummary: "按应用、后台进程和 Windows 进程分类显示，并把同程序实例合并到一起。",
    emptyProcesses: "当前没有匹配的系统进程。",
    showCount: "已显示 {visible} 组 / 共 {total} 个进程",
    loadProcesses: "加载系统进程中...",
    loadMoreGroups: "再加载 {count} 个分组",
    renderLimitHint: "仅渲染前 {count} 个进程对应的分组，避免界面卡顿。",
    processInstances: "{count} 个实例",
    selectFileFixHint: "如果刚更新代码后文件选择仍无响应，请完全关闭 Electron 再重新执行 npm run start。"
  },
  "en-US": {
    brandTag: "Background Service Manager",
    appTitle: "Command Hub",
    lede: "A cleaner deck for long-running CLI apps, gateways, dev servers and local services.",
    navCommands: "Commands",
    navSettings: "Settings",
    managedCommands: "Managed Commands",
    configuredInventory: "configured inventory",
    currentlyRunning: "Currently Running",
    activeInBackground: "active in background",
    stoppedOrIdle: "Stopped Or Idle",
    readyToLaunch: "ready to launch",
    newCommand: "New Command",
    editSelected: "Edit Selected",
    deleteSelected: "Delete Selected",
    silentMode: "Silent Mode",
    silentModeDesc: "Windows hides the shell window. macOS and Linux commands run in their own session.",
    settings: "Settings",
    closeToTray: "Close window to tray",
    launchAtLogin: "Launch app at login",
    language: "Language",
    themeMode: "Theme Mode",
    themeSystem: "System",
    themeDark: "Dark",
    themeLight: "Light",
    themeModeHelp: "Switch the whole app between light, dark, or follow-system themes.",
    operationsDeck: "Operations Deck",
    heroTitle: "Modern command orchestration for desktop workflows",
    heroDesc: "Centralize start, stop, restart, status checks and log inspection for any CLI-launched process.",
    searchPlaceholder: "Search commands, args, working dir or group...",
    openLogs: "Open Logs",
    clearLog: "Clear Log",
    startAll: "Start All",
    stopAll: "Stop All",
    refresh: "Refresh",
    managedInventory: "Managed Inventory",
    processInventory: "Process Inventory",
    commandTab: "Command List",
    processTab: "Process List",
    visibleTotal: "{visible} visible / {total} total",
    emptyCommands: "No commands yet. Create your first managed background task.",
    commandDetail: "Command Detail",
    pickCommand: "Pick a command to inspect runtime details.",
    runtimeControls: "Runtime Controls",
    start: "Start",
    stop: "Stop",
    restart: "Restart",
    liveLogTail: "Live Log",
    openLogPanel: "View Logs",
    hideLogPanel: "Hide Logs",
    infoTab: "Info",
    logTab: "Logs",
    autoScroll: "Auto Scroll",
    pauseFollow: "Pause Follow",
    logWillCreate: "Log file will be created on first start.",
    noLogs: "No logs yet.",
    commandStudio: "Command Studio",
    editCommand: "Edit command",
    createCommand: "Create command",
    close: "Close",
    displayName: "Display Name",
    executable: "Executable",
    arguments: "Arguments",
    workingDirectory: "Working Directory",
    environmentVariables: "Environment Variables",
    cancel: "Cancel",
    saveCommand: "Save Command",
    command: "Command",
    workingDir: "Working Dir",
    pid: "PID",
    uptime: "Uptime",
    stateNote: "State Note",
    enabled: "Enabled",
    disabled: "Disabled",
    projectCwd: "(project cwd)",
    group: "Group",
    allGroups: "All Groups",
    noGroup: "Ungrouped",
    groupPlaceholder: "For example gateway / dev / services",
    chooseGroup: "Choose an existing group",
    createGroup: "Create new group",
    newGroupName: "New group name",
    newGroupPlaceholder: "Enter a new group name",
    statusReady: "Ready",
    commandFieldHint: "Type a command manually or pick a concrete executable/script file",
    cwdFieldHint: "Type manually or browse for a working directory",
    browseFile: "Browse File",
    browseFolder: "Browse Folder",
    compactList: "Compact List",
    compactListDesc: "Reduce row height and fit more services on screen.",
    settingsDesc: "Keep app-level preferences separate from runtime inventory and logs.",
    logMode: "Log Mode",
    logModeOverwrite: "Overwrite on every start",
    logModeAppend: "Append continuously",
    logModeHelp: "Overwrite keeps each run clean. Append is better for long-running investigations.",
    logsEmptySelect: "Select a command to inspect its latest log output here.",
    selectedCommand: "Selected Command",
    groupFilter: "Group Filter",
    stateFilter: "State Filter",
    allStates: "All States",
    stateRunning: "Running",
    stateStopped: "Stopped",
    stateError: "Error",
    listSummary: "Tabular layout with sorting, state filters, group filters and recent runtime fields.",
    sortBy: "Sort",
    name: "Name",
    status: "Status",
    lastStarted: "Last Started",
    exitCode: "Exit Code",
    commandPath: "Command Path",
    processName: "Process Name",
    processPath: "Process Path",
    confirmEndProcess: "End process {name} (PID {pid})?",
    processToolbarTitle: "Process Monitor",
    processToolbarDesc: "Inspect all running system processes directly, with search, sorting, and termination controls.",
    matchedOnly: "Matched Only",
    allProcesses: "All Processes",
    matchedProcessHint: "Matched command",
    matchedByPid: "Runtime PID match",
    matchedByName: "Name match",
    matchedByFuzzy: "Fuzzy match",
    memory: "Memory",
    cpu: "CPU",
    action: "Action",
    endProcess: "End Process",
    processSummary: "Shows currently running system processes, similar to Task Manager.",
    processGroupedSummary: "Grouped into apps, background processes, and Windows processes, with same-program instances merged together.",
    emptyProcesses: "No matching system processes right now.",
    showCount: "{visible} groups shown / {total} total processes",
    loadProcesses: "Loading system processes...",
    loadMoreGroups: "Load {count} more groups",
    renderLimitHint: "Only the groups derived from the first {count} processes are rendered to keep the UI responsive.",
    processInstances: "{count} instances",
    selectFileFixHint: "If file picking still fails right after updating code, fully close Electron and run npm run start again."
  }
};

function nowIso() {
  return new Date().toISOString();
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function format(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

function stripAnsiSequences(text) {
  return String(text || "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\u0000/g, "");
}

function filePathFromHandle(file) {
  if (!file) return "";
  return window.commandHub?.getPathForFile?.(file) || file.path || "";
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function uptime(startedAt) {
  if (!startedAt) return "--";
  const delta = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(delta / 3600);
  const minutes = Math.floor((delta % 3600) / 60);
  const seconds = delta % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function toEnvMap(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((acc, line) => {
      const splitAt = line.indexOf("=");
      if (splitAt > 0) acc[line.slice(0, splitAt).trim()] = line.slice(splitAt + 1).trim();
      return acc;
    }, {});
}

function fromCommand(command) {
  return {
    id: command?.id || "",
    name: command?.name || "",
    command: command?.command || "",
    args: command?.args || "",
    cwd: command?.cwd || "",
    group: command?.group || "",
    envText: Object.entries(command?.env || {})
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")
  };
}

function Metric({ label, value, hint, tone }) {
  return (
    <div className={`metric metric-${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-hint">{hint}</div>
    </div>
  );
}

function SelectField({ value, options, onChange, placeholder, className = "", disabled = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <div ref={rootRef} className={`select-shell ${open ? "open" : ""} ${className}`.trim()}>
      <button
        type="button"
        className="select-trigger"
        disabled={disabled}
        onClick={() => !disabled && setOpen((current) => !current)}
      >
        <span className={`select-value ${selected ? "" : "placeholder"}`}>{selected?.label || placeholder}</span>
        <span className="select-chevron">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="select-menu">
          {options.map((option) => (
            <button
              key={`${option.value}`}
              type="button"
              className={`select-option ${option.value === value ? "selected" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LogoMark() {
  return (
    <svg className="brand-logo" viewBox="0 0 96 96" aria-hidden="true">
      <defs>
        <linearGradient id="hubShell" x1="8%" y1="10%" x2="88%" y2="90%">
          <stop offset="0%" stopColor="#f4c95d" />
          <stop offset="52%" stopColor="#66d9e8" />
          <stop offset="100%" stopColor="#52d6a2" />
        </linearGradient>
        <linearGradient id="hubBeam" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fef1bf" />
          <stop offset="100%" stopColor="#66d9e8" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="80" height="80" rx="24" fill="rgba(5,11,16,0.72)" stroke="url(#hubShell)" strokeWidth="3" />
      <path d="M28 64V32l20 18 20-18v32" fill="none" stroke="url(#hubShell)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="48" cy="48" r="8" fill="url(#hubBeam)" />
      <path d="M48 24v16M24 48h16M56 48h16M48 56v16" fill="none" stroke="url(#hubBeam)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

const PROCESS_PAGE_SIZE = 200;

function normalizeProcessGroupKey(item) {
  const name = String(item?.name || "").toLowerCase();
  const path = String(item?.path || "").toLowerCase();
  return `${name}::${path}`;
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
    "ctfmon.exe",
    "explorer.exe",
    "searchhost.exe",
    "runtimebroker.exe"
  ]);

  if (windowsNames.has(name) || windowsRoots.some((root) => processPath.includes(root))) {
    return "windows";
  }

  if (!processPath) return "background";

  return "application";
}

function buildProcessGroups(processes) {
  const grouped = new Map();

  for (const item of processes) {
    const groupKey = normalizeProcessGroupKey(item);
    const category = classifyProcess(item);
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.items.push(item);
      existing.memoryValue += item.memoryValue ?? 0;
      existing.cpuValue += item.cpuValue ?? 0;
      existing.pids.push(item.pid);
      existing.isManaged = existing.isManaged || Boolean(item.isManaged);
      if (item.matchedCommandName) existing.matchedCommandNames.push(item.matchedCommandName);
      if (item.matchType) existing.matchTypes.push(item.matchType);
      continue;
    }

    grouped.set(groupKey, {
      key: groupKey,
      category,
      name: getProcessBaseName(item.name),
      displayName: item.name || "--",
      path: item.path || "",
      items: [item],
      memoryValue: item.memoryValue ?? 0,
      cpuValue: item.cpuValue ?? 0,
      pids: [item.pid],
      isManaged: Boolean(item.isManaged),
      matchedCommandNames: item.matchedCommandName ? [item.matchedCommandName] : [],
      matchTypes: item.matchType ? [item.matchType] : []
    });
  }

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      count: group.items.length,
      primaryPid: Math.min(...group.pids),
      memory: group.memoryValue > 0 ? formatBytes(group.memoryValue) : group.items[0]?.memory || "--",
      cpu: group.cpuValue > 0 ? `${group.cpuValue.toFixed(1)} s` : group.items[0]?.cpu || "--",
      isManaged: group.isManaged || group.items.some((item) => item.isManaged),
      matchedCommandNames: [...new Set(group.items.map((item) => item.matchedCommandName).filter(Boolean))],
      matchTypes: [...new Set(group.items.map((item) => item.matchType).filter(Boolean))],
      items: [...group.items].sort((a, b) => a.pid - b.pid)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatBytes(megabytes) {
  if (!Number.isFinite(megabytes)) return "--";
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(2)} GB`;
  return `${megabytes.toFixed(1)} MB`;
}

function normalizeProcessAlias(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^"+|"+$/g, "")
    .replace(/\.(exe|cmd|bat|ps1|sh)$/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function getManagedCommandAliases(command) {
  const aliases = new Set();
  const rawName = String(command?.name || "").trim();
  const rawCommand = String(command?.command || "").trim().replace(/^"+|"+$/g, "");
  const commandTail = rawCommand.split(/[/\\]/).pop() || "";

  for (const value of [rawName, rawCommand, commandTail, commandTail.replace(/\.[^.]+$/, "")]) {
    const normalized = normalizeProcessAlias(value);
    if (normalized) aliases.add(normalized);
  }

  for (const token of [rawName, rawCommand, commandTail].join(" ").split(/[\s_\-/\\]+/)) {
    const normalized = normalizeProcessAlias(token);
    if (normalized.length >= 2) aliases.add(normalized);
  }

  return [...aliases];
}

function annotateMatchedProcesses(processes, commands, statuses) {
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

  return processes.map((item) => {
    if (item.isManaged || item.matchedCommandId) return item;

    const runtimeMatch = runtimePidMap.get(item.pid);
    if (runtimeMatch) {
      return { ...item, ...runtimeMatch };
    }

    const processName = normalizeProcessAlias(item.name);
    const processPath = normalizeProcessAlias(item.path);
    const matched = matchers.find((matcher) => matcher.aliases.some((alias) => {
      if (!alias) return false;
      return processName.includes(alias)
        || alias.includes(processName)
        || (processPath && processPath.includes(alias));
    }));

    if (!matched) return item;

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

function App() {
  const [commands, setCommands] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [systemProcesses, setSystemProcesses] = useState([]);
  const [settings, setSettings] = useState({ closeToTray: true, launchAtLogin: false, language: "zh-CN", compactList: true, themeMode: "system" });
  const [systemTheme, setSystemTheme] = useState("dark");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const [commandsTab, setCommandsTab] = useState("commands");
  const [processesLoaded, setProcessesLoaded] = useState(false);
  const [processRenderCount, setProcessRenderCount] = useState(PROCESS_PAGE_SIZE);
  const [expandedProcessGroups, setExpandedProcessGroups] = useState({});
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [processSortKey, setProcessSortKey] = useState("name");
  const [processSortDirection, setProcessSortDirection] = useState("asc");
  const [sortKey, setSortKey] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [activeView, setActiveView] = useState("commands");
  const [logTail, setLogTail] = useState("");
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const [detailTab, setDetailTab] = useState("info");
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [groupSelectValue, setGroupSelectValue] = useState("");
  const [logDrawerWidth, setLogDrawerWidth] = useState(540);
  const [columnWidths, setColumnWidths] = useState({
    name: 2.2,
    status: 1,
    group: 1.1,
    pid: 0.9,
    lastStarted: 1.4,
    exitCode: 0.9
  });
  const fileInputRef = useRef(null);
  const directoryInputRef = useRef(null);
  const resizeStateRef = useRef(null);
  const logViewRef = useRef(null);

  const language = settings.language || "zh-CN";
  const copy = MESSAGES[language] || MESSAGES["zh-CN"];

  function t(key, values) {
    const template = copy[key] || key;
    return values ? format(template, values) : template;
  }

  async function refreshState() {
    const state = await window.commandHub.getState();
    setCommands(state.commands);
    setStatuses(state.statuses);
    setSettings((current) => ({ compactList: true, themeMode: "system", ...current, ...state.settings }));
    setSelectedId((current) => current || state.commands[0]?.id || "");
  }

  useEffect(() => {
    refreshState();
    const dispose = window.commandHub.onRuntimeUpdated(refreshState);
    const timer = window.setInterval(refreshState, 1500);
    return () => {
      dispose?.();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => setSystemTheme(media.matches ? "dark" : "light");
    syncTheme();
    media.addEventListener?.("change", syncTheme);
    return () => media.removeEventListener?.("change", syncTheme);
  }, []);

  useEffect(() => {
    const themeMode = settings.themeMode || "system";
    const resolvedTheme = themeMode === "system" ? systemTheme : themeMode;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [settings.themeMode, systemTheme]);

  const groups = useMemo(() => [...new Set(commands.map((item) => item.group || "").sort((a, b) => a.localeCompare(b)))], [commands]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return commands.filter((item) => {
      const status = statuses[item.id]?.state || "stopped";
      const groupMatch = !selectedGroup || (item.group || "") === selectedGroup;
      const stateMatch = !selectedState || status === selectedState;
      const textMatch = !query || [item.name, item.command, item.args, item.cwd, item.group || ""].join(" ").toLowerCase().includes(query);
      return groupMatch && stateMatch && textMatch;
    });
  }, [commands, search, selectedGroup, selectedState, statuses]);

  const sortedCommands = useMemo(() => {
    const items = [...filtered];
    items.sort((a, b) => {
      const aStatus = statuses[a.id] || {};
      const bStatus = statuses[b.id] || {};
      let result = 0;
      if (sortKey === "name") result = a.name.localeCompare(b.name);
      if (sortKey === "status") result = String(aStatus.state || "").localeCompare(String(bStatus.state || ""));
      if (sortKey === "group") result = String(a.group || "").localeCompare(String(b.group || ""));
      if (sortKey === "lastStarted") result = new Date(a.lastStartedAt || 0).getTime() - new Date(b.lastStartedAt || 0).getTime();
      if (sortKey === "exitCode") result = Number(a.lastExitCode ?? -9999) - Number(b.lastExitCode ?? -9999);
      return sortDirection === "asc" ? result : -result;
    });
    return items;
  }, [filtered, sortDirection, sortKey, statuses]);

  const matchedSystemProcesses = useMemo(
    () => annotateMatchedProcesses(systemProcesses, commands, statuses),
    [commands, statuses, systemProcesses]
  );

  const filteredProcesses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return matchedSystemProcesses
      .filter((item) => {
        const matchedFilter = !matchedOnly || item.isManaged;
        const textMatch = !query || [
          item.name,
          item.path || "",
          String(item.pid),
          item.memory || "",
          item.cpu || ""
        ].join(" ").toLowerCase().includes(query);
        return matchedFilter && textMatch;
      })
      .sort((a, b) => {
        const direction = processSortDirection === "asc" ? 1 : -1;
        if (processSortKey === "name") return a.name.localeCompare(b.name) * direction;
        if (processSortKey === "cpu") return ((a.cpuValue ?? -1) - (b.cpuValue ?? -1)) * direction;
        if (processSortKey === "memory") return ((a.memoryValue ?? -1) - (b.memoryValue ?? -1)) * direction;
        if (processSortKey === "pid") return (a.pid - b.pid) * direction;
        return 0;
      });
  }, [matchedOnly, matchedSystemProcesses, processSortDirection, processSortKey, search]);

  const visibleProcesses = useMemo(
    () => filteredProcesses.slice(0, processRenderCount),
    [filteredProcesses, processRenderCount]
  );

  const processGroups = useMemo(() => {
    const direction = processSortDirection === "asc" ? 1 : -1;
    const groups = buildProcessGroups(visibleProcesses).sort((a, b) => {
      if (processSortKey === "name") return a.name.localeCompare(b.name) * direction;
      if (processSortKey === "cpu") return (a.cpuValue - b.cpuValue) * direction;
      if (processSortKey === "memory") return (a.memoryValue - b.memoryValue) * direction;
      if (processSortKey === "pid") return (a.primaryPid - b.primaryPid) * direction;
      return 0;
    });

    const categoryOrder = ["application", "background", "windows"];
    const categoryLabels = {
      application: { "zh-CN": "应用", "en-US": "Apps" },
      background: { "zh-CN": "后台进程", "en-US": "Background Processes" },
      windows: { "zh-CN": "Windows 进程", "en-US": "Windows Processes" }
    };

    return categoryOrder
      .map((category) => {
        const items = groups.filter((group) => group.category === category);
        return {
          key: category,
          label: categoryLabels[category][language] || categoryLabels[category]["zh-CN"],
          items
        };
      })
      .filter((section) => section.items.length > 0);
  }, [language, processSortDirection, processSortKey, visibleProcesses]);

  useEffect(() => {
    if (!sortedCommands.some((item) => item.id === selectedId)) {
      setSelectedId(sortedCommands[0]?.id || "");
    }
  }, [sortedCommands, selectedId]);

  useEffect(() => {
    if (selectedId) {
      setDetailTab("info");
    }
  }, [selectedId]);

  const selected = commands.find((item) => item.id === selectedId) || null;
  const selectedStatus = selected ? statuses[selected.id] || {} : null;

  useEffect(() => {
    async function loadLog() {
      if (!selectedStatus?.logPath) {
        setLogTail("");
        return;
      }
      const text = await window.commandHub.getLogTail(selectedStatus.logPath);
      setLogTail(stripAnsiSequences(text));
    }
    loadLog();
  }, [selectedStatus?.logPath, statuses, selectedId]);

  useEffect(() => {
    if (!autoScrollLogs || !logViewRef.current) return;
    const node = logViewRef.current;
    node.scrollTop = node.scrollHeight;
  }, [logTail, autoScrollLogs, activeView]);

  const metrics = useMemo(() => {
    const running = Object.values(statuses).filter((item) => item.state === "running").length;
    return { total: commands.length, running, idle: Math.max(0, commands.length - running) };
  }, [commands, statuses]);

  function openCreate() {
    const initialGroup = selectedGroup || "";
    setForm({ ...EMPTY_FORM, group: initialGroup });
    setGroupSelectValue(initialGroup ? (groups.includes(initialGroup) ? initialGroup : NEW_GROUP_VALUE) : "");
    setDrawerOpen(true);
  }

  function openEdit() {
    if (!selected) return;
    setForm(fromCommand(selected));
    setGroupSelectValue(selected.group && groups.includes(selected.group) ? selected.group : selected.group ? NEW_GROUP_VALUE : "");
    setDrawerOpen(true);
  }

  async function saveForm(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.command.trim()) return;
    const existing = commands.find((item) => item.id === form.id);
    const payload = {
      id: form.id || uid(),
      name: form.name.trim(),
      command: form.command.trim(),
      args: form.args.trim(),
      cwd: form.cwd.trim(),
      group: form.group.trim(),
      env: toEnvMap(form.envText),
      autoRestart: false,
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
      lastStartedAt: existing?.lastStartedAt || null,
      lastExitCode: existing?.lastExitCode ?? null,
      lastStoppedAt: existing?.lastStoppedAt || null,
      lastState: existing?.lastState || "stopped"
    };
    await window.commandHub.saveCommand(payload);
    setSelectedId(payload.id);
    setDrawerOpen(false);
    await refreshState();
  }

  async function removeSelected() {
    if (!selected) return;
    await window.commandHub.deleteCommand(selected.id);
    await refreshState();
  }

  async function startSelected() {
    if (!selected) return;
    await window.commandHub.startCommand(selected);
    await refreshState();
  }

  async function stopSelected() {
    if (!selected) return;
    await window.commandHub.stopCommand(selected.id);
    await refreshState();
  }

  async function restartSelected() {
    if (!selected) return;
    await window.commandHub.restartCommand(selected);
    await refreshState();
  }

  async function toggleSelectedRuntime() {
    if (!selected) return;
    const state = statuses[selected.id]?.state || "stopped";
    if (state === "running") {
      await stopSelected();
      return;
    }
    await startSelected();
  }

  async function startVisibleGroup() {
    await window.commandHub.startAll(selectedGroup || undefined);
    await refreshState();
  }

  async function stopVisibleGroup() {
    await window.commandHub.stopAll(selectedGroup || undefined);
    await refreshState();
  }

  async function browseCommandFile() {
    try {
      const file = await window.commandHub.pickCommandFile();
      if (file) {
        const fileName = String(file).split(/[/\\]/).pop() || "";
        setForm((current) => ({
          ...current,
          command: file,
          name: current.name || fileName.replace(/\.[^.]+$/, "") || current.name
        }));
        return;
      }
    } catch {}
    fileInputRef.current?.click();
  }

  async function browseDirectory() {
    try {
      const dir = await window.commandHub.pickDirectory();
      if (dir) {
        setForm((current) => ({ ...current, cwd: dir }));
        return;
      }
    } catch {}
    directoryInputRef.current?.click();
  }

  async function saveSetting(key, value) {
    const next = { ...settings, [key]: value };
    const persisted = key === "compactList" ? next : await window.commandHub.saveSettings(next);
    setSettings(persisted);
  }

  async function clearSelectedLog() {
    if (!selectedStatus?.logPath) return;
    await window.commandHub.clearLog(selectedStatus.logPath);
    setLogTail("");
  }

  function toggleSort(nextKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  }

  async function refreshSystemProcesses() {
    const list = await window.commandHub.listSystemProcesses();
    setSystemProcesses(list || []);
    setProcessesLoaded(true);
    setProcessRenderCount(PROCESS_PAGE_SIZE);
  }

  async function endSystemProcess(pid) {
    const current = systemProcesses.find((item) => item.pid === pid);
    if (!window.confirm(t("confirmEndProcess", { name: current?.name || "--", pid }))) return;
    await window.commandHub.killSystemProcess(pid);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    await refreshState();
    await refreshSystemProcesses();
  }

  function toggleProcessSort(nextKey) {
    if (processSortKey === nextKey) {
      setProcessSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setProcessSortKey(nextKey);
    setProcessSortDirection(nextKey === "name" ? "asc" : "desc");
  }

  function toggleProcessGroup(groupKey) {
    setExpandedProcessGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey]
    }));
  }

  useEffect(() => {
    setProcessRenderCount(PROCESS_PAGE_SIZE);
  }, [matchedOnly, search, processSortDirection, processSortKey]);

  useEffect(() => {
    if (commandsTab === "processes" && !processesLoaded) {
      refreshSystemProcesses();
    }
  }, [commandsTab, processesLoaded]);

  useEffect(() => {
    function onMove(event) {
      const state = resizeStateRef.current;
      if (!state) return;
      if (state.type === "log-drawer") {
        const delta = state.startX - event.clientX;
        setLogDrawerWidth(Math.max(420, Math.min(window.innerWidth - 60, state.startWidth + delta)));
        return;
      }
      const delta = (event.clientX - state.startX) / 180;
      setColumnWidths((current) => ({
        ...current,
        [state.key]: Math.max(0.8, Number((state.startWidth + delta).toFixed(2)))
      }));
    }

    function onUp() {
      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startResize(key, event) {
    event.preventDefault();
    resizeStateRef.current = {
      type: "column",
      key,
      startX: event.clientX,
      startWidth: columnWidths[key]
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function startLogDrawerResize(event) {
    event.preventDefault();
    resizeStateRef.current = {
      type: "log-drawer",
      startX: event.clientX,
      startWidth: logDrawerWidth
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  const detailRows = selected
    ? [
        [t("command"), [selected.command, selected.args].filter(Boolean).join(" ")],
        [t("group"), selected.group || t("noGroup")],
        [t("workingDir"), selected.cwd || t("projectCwd")],
        [t("pid"), selectedStatus?.pid || "--"],
        [t("uptime"), uptime(selectedStatus?.startedAt)],
        [t("lastStarted"), formatDate(selected.lastStartedAt)],
        [t("exitCode"), selected.lastExitCode ?? "--"],
        [t("stateNote"), selectedStatus?.message || t("statusReady")]
      ]
    : [];

  const navItems = [["commands", t("navCommands")], ["settings", t("navSettings")]];
  const stateOptions = [["", t("allStates")], ["running", t("stateRunning")], ["stopped", t("stateStopped")], ["error", t("stateError")]];
  const stateSelectOptions = stateOptions.map(([value, label]) => ({ value, label }));
  const groupFilterOptions = [{ value: "", label: t("allGroups") }, ...groups.map((group) => ({ value: group, label: group || t("noGroup") }))];
  const groupFormOptions = [{ value: "", label: t("chooseGroup") }, ...groups.map((group) => ({ value: group, label: group })), { value: NEW_GROUP_VALUE, label: t("createGroup") }];
  const themeModeOptions = [
    { value: "system", label: t("themeSystem") },
    { value: "dark", label: t("themeDark") },
    { value: "light", label: t("themeLight") }
  ];
  const languageOptions = [
    { value: "zh-CN", label: "简体中文" },
    { value: "en-US", label: "English" }
  ];
  const logModeOptions = [
    { value: "overwrite", label: t("logModeOverwrite") },
    { value: "append", label: t("logModeAppend") }
  ];
  const columns = [
    ["name", t("name")],
    ["status", t("status")],
    ["group", t("group")],
    ["pid", t("pid")],
    ["lastStarted", t("lastStarted")],
    ["exitCode", t("exitCode")]
  ];
  const tableTemplate = `${columnWidths.name}fr ${columnWidths.status}fr ${columnWidths.group}fr ${columnWidths.pid}fr ${columnWidths.lastStarted}fr ${columnWidths.exitCode}fr`;

  return (
    <div className="app-shell">
      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const path = filePathFromHandle(file) || file?.name || "";
          if (path) {
            setForm((current) => ({
              ...current,
              command: path,
              name: current.name || file?.name?.replace(/\.[^.]+$/, "") || current.name
            }));
          }
          event.target.value = "";
        }}
      />
      <input
        ref={directoryInputRef}
        className="hidden-input"
        type="file"
        webkitdirectory="true"
        directory=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          const absolute = filePathFromHandle(file);
          if (!absolute) return;
          const relative = (file.webkitRelativePath || "").replaceAll("/", "\\");
          const root = relative && absolute.endsWith(relative) ? absolute.slice(0, absolute.length - relative.length).replace(/[\\\/]+$/, "") : absolute;
          const fallbackDir = relative ? relative.split("\\")[0] : file.name;
          setForm((current) => ({ ...current, cwd: root || fallbackDir || absolute }));
          event.target.value = "";
        }}
      />
      <aside className="sidebar">
        <div className="brand-header">
          <div className="brand-badge">
            <LogoMark />
          </div>
          <div className="brand-copy">
            <div className="brand-tag">{t("brandTag")}</div>
            <h1>{t("appTitle")}</h1>
          </div>
        </div>
        <p className="lede">{t("lede")}</p>

        <div className="nav-stack">
          {navItems.map(([id, label]) => (
            <button key={id} className={`btn btn-md nav-button ${activeView === id ? "active" : ""}`} onClick={() => setActiveView(id)}>
              {label}
            </button>
          ))}
        </div>

        <div className="metrics">
          <Metric label={t("managedCommands")} value={metrics.total} hint={t("configuredInventory")} tone="gold" />
          <Metric label={t("currentlyRunning")} value={metrics.running} hint={t("activeInBackground")} tone="green" />
          <Metric label={t("stoppedOrIdle")} value={metrics.idle} hint={t("readyToLaunch")} tone="red" />
        </div>

        <div className="sidebar-actions">
          <button className="btn btn-md primary" onClick={openCreate}>{t("newCommand")}</button>
          <button className="btn btn-md secondary" onClick={openEdit} disabled={!selected}>{t("editSelected")}</button>
          <button className="btn btn-md danger" onClick={removeSelected} disabled={!selected}>{t("deleteSelected")}</button>
        </div>

        <div className="sidebar-note">
          <span>{t("silentMode")}</span>
          <p>{t("silentModeDesc")}</p>
        </div>
      </aside>

      <main className="main-stage">
        {activeView === "commands" && (
          <>
            {commandsTab === "commands" ? (
              <section className="hero">
                <div>
                  <div className="eyebrow">{t("operationsDeck")}</div>
                  <h2>{t("heroTitle")}</h2>
                  <p>{t("heroDesc")}</p>
                </div>
                <div className="hero-tools">
                  <input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchPlaceholder")} />
                  <div className="hero-row triple">
                    <SelectField className="group-select" value={selectedGroup} options={groupFilterOptions} onChange={setSelectedGroup} placeholder={t("allGroups")} />
                    <SelectField className="group-select" value={selectedState} options={stateSelectOptions} onChange={setSelectedState} placeholder={t("allStates")} />
                    <button className="btn btn-md ghost" onClick={() => window.commandHub.openLogFolder()}>{t("openLogs")}</button>
                  </div>
                  <div className="hero-row">
                    <button className="btn btn-md teal" onClick={startVisibleGroup}>{t("startAll")}</button>
                    <button className="btn btn-md secondary" onClick={stopVisibleGroup}>{t("stopAll")}</button>
                  </div>
                </div>
              </section>
            ) : (
              <section className="process-toolbar card">
                <div>
                  <div className="eyebrow">{t("processToolbarTitle")}</div>
                  <div className="section-copy">{t("processToolbarDesc")}</div>
                </div>
                <div className="process-toolbar-tools">
                  <input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchPlaceholder")} />
                  <div className="hero-row process-actions">
                    <button
                      className={`btn btn-md ${matchedOnly ? "teal" : "secondary"}`}
                      onClick={() => setMatchedOnly((current) => !current)}
                    >
                      {matchedOnly ? t("allProcesses") : t("matchedOnly")}
                    </button>
                    <button className="btn btn-md ghost" onClick={refreshSystemProcesses}>{t("refresh")}</button>
                  </div>
                </div>
              </section>
            )}

            <div className="subtabs">
              <button className={`btn btn-sm subtab ${commandsTab === "commands" ? "active" : ""}`} onClick={() => setCommandsTab("commands")}>
                {t("commandTab")}
              </button>
              <button className={`btn btn-sm subtab ${commandsTab === "processes" ? "active" : ""}`} onClick={() => setCommandsTab("processes")}>
                {t("processTab")}
              </button>
            </div>

            <section className={commandsTab === "processes" ? "content-grid process-layout" : "content-grid"}>
              {commandsTab === "commands" && (
              <div className="inventory card">
                <div className="section-head split-head">
                  <div>
                    <div className="section-title">{t("managedInventory")}</div>
                    <div className="section-copy">{t("visibleTotal", { visible: sortedCommands.length, total: commands.length })}</div>
                  </div>
                  <div className="section-copy right-copy">{t("listSummary")}</div>
                </div>

                <div className="table-wrap">
                  <div className="table-head" style={{ gridTemplateColumns: tableTemplate }}>
                    {columns.map(([key, label]) => (
                      <div key={key} className="table-head-cell">
                        <button className="table-sort" onClick={() => toggleSort(key)}>
                          {label}
                          {sortKey === key ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
                        </button>
                        <div className="col-resizer" onMouseDown={(event) => startResize(key, event)} />
                      </div>
                    ))}
                  </div>
                  <div className="table-body">
                    {sortedCommands.length === 0 && <div className="empty">{t("emptyCommands")}</div>}
                    {sortedCommands.map((item) => {
                      const status = statuses[item.id]?.state || "stopped";
                      return (
                        <button
                          key={item.id}
                          className={`table-row ${selectedId === item.id ? "selected" : ""}`}
                          onClick={() => setSelectedId(item.id)}
                          onDoubleClick={() => {
                            setSelectedId(item.id);
                            setTimeout(() => {
                              const current = commands.find((entry) => entry.id === item.id);
                              const currentState = statuses[item.id]?.state || "stopped";
                              if (!current) return;
                              if (currentState === "running") {
                                window.commandHub.stopCommand(item.id).then(refreshState);
                              } else {
                                window.commandHub.startCommand(current).then(refreshState);
                              }
                            }, 0);
                          }}
                          style={{ gridTemplateColumns: tableTemplate }}
                        >
                          <div className="cell cell-name">
                            <div className="row-title">{item.name}</div>
                            <div className="row-sub">{item.command}</div>
                          </div>
                          <div className="cell"><span className={`badge badge-${status}`}>{status}</span></div>
                          <div className="cell">{item.group || t("noGroup")}</div>
                          <div className="cell mono">{statuses[item.id]?.pid || "--"}</div>
                          <div className="cell mono">{formatDate(item.lastStartedAt)}</div>
                          <div className="cell mono">{item.lastExitCode ?? "--"}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              )}

              {commandsTab === "processes" && (
                <div className="card process-card process-panel">
                    <div className="section-head split-head">
                      <div>
                        <div className="section-title">{t("processInventory")}</div>
                        <div className="section-copy">{t("processGroupedSummary")}</div>
                      </div>
                      <div className="detail-header-actions">
                        <div className="section-copy right-copy">
                          {t("showCount", { visible: processGroups.reduce((sum, section) => sum + section.items.length, 0), total: filteredProcesses.length })}
                        </div>
                      </div>
                    </div>

                    <div className="table-wrap">
                      <div className="table-head process-table">
                        <div className="table-head-cell"><button className="table-sort" onClick={() => toggleProcessSort("name")}>{t("processName")}{processSortKey === "name" ? (processSortDirection === "asc" ? " ↑" : " ↓") : ""}</button></div>
                        <div className="table-head-cell"><button className="table-sort">{t("processPath")}</button></div>
                        <div className="table-head-cell"><button className="table-sort" onClick={() => toggleProcessSort("pid")}>{t("pid")}{processSortKey === "pid" ? (processSortDirection === "asc" ? " ↑" : " ↓") : ""}</button></div>
                        <div className="table-head-cell"><button className="table-sort" onClick={() => toggleProcessSort("memory")}>{t("memory")}{processSortKey === "memory" ? (processSortDirection === "asc" ? " ↑" : " ↓") : ""}</button></div>
                        <div className="table-head-cell"><button className="table-sort" onClick={() => toggleProcessSort("cpu")}>{t("cpu")}{processSortKey === "cpu" ? (processSortDirection === "asc" ? " ↑" : " ↓") : ""}</button></div>
                        <div className="table-head-cell"><button className="table-sort">{t("action")}</button></div>
                      </div>
                      <div className="table-body process-group-body">
                        {!processesLoaded && <div className="empty">{t("loadProcesses")}</div>}
                        {processesLoaded && filteredProcesses.length === 0 && <div className="empty">{t("emptyProcesses")}</div>}
                        {processGroups.map((section) => (
                          <div key={section.key} className="process-section">
                            <div className="process-section-title">
                              <span>{section.label}</span>
                              <span className="process-section-count">{section.items.length}</span>
                            </div>
                            {section.items.map((group) => {
                              const expanded = group.count === 1 ? true : Boolean(expandedProcessGroups[group.key]);
                              return (
                                <div key={group.key} className="process-group">
                                  <div
                                    className={`table-row process-table process-group-row ${expanded ? "expanded" : ""} ${group.isManaged ? "process-row-managed" : ""}`}
                                    onClick={() => group.count > 1 && toggleProcessGroup(group.key)}
                                  >
                                    <div className="cell cell-name">
                                      <div className="process-name-line">
                                        {group.count > 1 && <span className="process-chevron">{expanded ? "▾" : "▸"}</span>}
                                        <div className="row-title">{group.displayName}</div>
                                        {group.isManaged && <span className={`badge ${group.matchTypes.includes("pid") ? "badge-pid" : "badge-name"}`}>{t("matchedProcessHint")}</span>}
                                        {group.count > 1 && <span className="process-group-pill">{t("processInstances", { count: group.count })}</span>}
                                      </div>
                                      <div className="row-sub">
                                        {group.count > 1 ? `${t("pid")}: ${group.primaryPid}` : `${t("pid")}: ${group.primaryPid}`}
                                        {group.matchedCommandNames.length > 0 ? ` · ${group.matchedCommandNames.join(", ")}` : ""}
                                        {group.matchTypes.includes("pid")
                                          ? ` · ${t("matchedByPid")}`
                                          : group.matchTypes.includes("name")
                                            ? ` · ${t("matchedByName")}`
                                            : group.matchTypes.includes("fuzzy")
                                              ? ` · ${t("matchedByFuzzy")}`
                                              : ""}
                                      </div>
                                    </div>
                                    <div className="cell"><div className="path-cell mono">{group.path || "--"}</div></div>
                                    <div className="cell mono">{group.count > 1 ? group.primaryPid : group.items[0]?.pid}</div>
                                    <div className="cell mono">{group.memory || "--"}</div>
                                    <div className="cell mono">{group.cpu || "--"}</div>
                                    <div className="cell">
                                      {group.count === 1 ? (
                                        <button className="btn btn-sm danger" onClick={(event) => { event.stopPropagation(); endSystemProcess(group.items[0].pid); }}>
                                          {t("endProcess")}
                                        </button>
                                      ) : (
                                        <span className="row-sub">{" "}</span>
                                      )}
                                    </div>
                                  </div>
                                  {expanded && group.count > 1 && (
                                    <div className="process-group-children">
                                      {group.items.map((item) => (
                                        <div key={item.pid} className={`table-row process-table process-child-row ${item.isManaged ? "process-row-managed" : ""}`}>
                                          <div className="cell cell-name">
                                            <div className="process-name-line child-line">
                                              <span className="process-child-marker">•</span>
                                              <div className="row-title">{item.name}</div>
                                              {item.isManaged && <span className={`badge ${item.matchType === "pid" ? "badge-pid" : "badge-name"}`}>{t("matchedProcessHint")}</span>}
                                            </div>
                                            <div className="row-sub">
                                              {t("pid")}: {item.pid}
                                              {item.matchedCommandName ? ` · ${item.matchedCommandName}` : ""}
                                              {item.matchType === "pid"
                                                ? ` · ${t("matchedByPid")}`
                                                : item.matchType === "name"
                                                  ? ` · ${t("matchedByName")}`
                                                  : item.matchType === "fuzzy"
                                                    ? ` · ${t("matchedByFuzzy")}`
                                                    : ""}
                                            </div>
                                          </div>
                                          <div className="cell"><div className="path-cell mono">{item.path || "--"}</div></div>
                                          <div className="cell mono">{item.pid}</div>
                                          <div className="cell mono">{item.memory || "--"}</div>
                                          <div className="cell mono">{item.cpu || "--"}</div>
                                          <div className="cell">
                                            <button className="btn btn-sm danger" onClick={() => endSystemProcess(item.pid)}>{t("endProcess")}</button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                        {processesLoaded && filteredProcesses.length > visibleProcesses.length && (
                          <div className="process-load-more">
                            <div className="section-copy">
                              {t("renderLimitHint", { count: visibleProcesses.length })}
                            </div>
                            <button
                              className="btn btn-md ghost"
                              onClick={() => setProcessRenderCount((current) => current + PROCESS_PAGE_SIZE)}
                            >
                              {t("loadMoreGroups", { count: Math.min(PROCESS_PAGE_SIZE, filteredProcesses.length - visibleProcesses.length) })}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                </div>
              )}

              {commandsTab === "commands" && (
              <div className="detail-rail">
                {commandsTab === "commands" && (
                  <>
                    <div className="card detail-card">
                      <div className="detail-header">
                        <div className="section-title">{t("commandDetail")}</div>
                        <div className="detail-header-actions">
                          <button className={`btn btn-sm ghost ${detailTab === "info" ? "active-chip" : ""}`} onClick={() => setDetailTab("info")}>{t("infoTab")}</button>
                          <button className={`btn btn-sm ghost ${detailTab === "log" ? "active-chip" : ""}`} onClick={() => { setDetailTab("log"); setLogPanelOpen(true); }}>{t("logTab")}</button>
                          <button className="btn btn-sm ghost" onClick={() => setLogPanelOpen((current) => !current)} disabled={!selected}>
                            {logPanelOpen ? t("hideLogPanel") : t("openLogPanel")}
                          </button>
                        </div>
                      </div>
                      {selected ? (
                        <>
                          <h3>{selected.name}</h3>
                          <pre className="command-preview">{[selected.command, selected.args].filter(Boolean).join(" ")}</pre>
                          {detailTab === "info" ? (
                            <div className="detail-grid">
                              {detailRows.map(([label, value]) => (
                                <div key={label} className="detail-row">
                                  <span>{label}</span>
                                  <strong>{value}</strong>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="inline-log-panel">
                              <div className="log-topbar">
                                <div className="section-copy">{selectedStatus?.logPath || t("logWillCreate")}</div>
                                <div className="control-row compact-controls">
                                  <button className="btn btn-sm ghost" onClick={() => setAutoScrollLogs((current) => !current)}>
                                    {autoScrollLogs ? t("pauseFollow") : t("autoScroll")}
                                  </button>
                                  <button className="btn btn-sm ghost" onClick={clearSelectedLog} disabled={!selectedStatus?.logPath}>
                                    {t("clearLog")}
                                  </button>
                                </div>
                              </div>
                              <pre ref={logViewRef} className="log-view inline-log-view">{selected ? (logTail || t("noLogs")) : t("logsEmptySelect")}</pre>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="empty">{t("pickCommand")}</div>
                      )}
                    </div>

                    <div className="card controls-card">
                      <div className="section-title">{t("runtimeControls")}</div>
                      <div className="control-row">
                        <button className="btn btn-md teal" onClick={startSelected} disabled={!selected}>{t("start")}</button>
                        <button className="btn btn-md secondary" onClick={stopSelected} disabled={!selected}>{t("stop")}</button>
                        <button className="btn btn-md secondary" onClick={restartSelected} disabled={!selected}>{t("restart")}</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              )}
            </section>
          </>
        )}

        {activeView === "settings" && (
          <section className="single-panel">
            <div className="card panel-card settings-panel">
              <div className="section-title">{t("settings")}</div>
              <div className="section-copy">{t("settingsDesc")}</div>
              <div className="section-copy">{t("selectFileFixHint")}</div>
              <div className="prefs-list">
                <div className="pref-row">
                  <div className="pref-copy">
                    <div className="pref-title">{t("closeToTray")}</div>
                    <div className="pref-help">{t("settingsDesc")}</div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={Boolean(settings.closeToTray)} onChange={(event) => saveSetting("closeToTray", event.target.checked)} />
                    <span className="switch-slider" />
                  </label>
                </div>
                <div className="pref-row">
                  <div className="pref-copy">
                    <div className="pref-title">{t("launchAtLogin")}</div>
                    <div className="pref-help">{t("silentModeDesc")}</div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={Boolean(settings.launchAtLogin)} onChange={(event) => saveSetting("launchAtLogin", event.target.checked)} />
                    <span className="switch-slider" />
                  </label>
                </div>
                <div className="pref-row">
                  <div className="pref-copy">
                    <div className="pref-title">{t("themeMode")}</div>
                    <div className="pref-help">{t("themeModeHelp")}</div>
                  </div>
                  <div className="pref-control">
                    <SelectField value={settings.themeMode || "system"} options={themeModeOptions} onChange={(value) => saveSetting("themeMode", value)} placeholder={t("themeMode")} />
                  </div>
                </div>
                <div className="pref-row">
                  <div className="pref-copy">
                    <div className="pref-title">{t("language")}</div>
                    <div className="pref-help">{t("selectFileFixHint")}</div>
                  </div>
                  <div className="pref-control">
                    <SelectField value={language} options={languageOptions} onChange={(value) => saveSetting("language", value)} placeholder={t("language")} />
                  </div>
                </div>
                <div className="pref-row">
                  <div className="pref-copy">
                    <div className="pref-title">{t("logMode")}</div>
                    <div className="pref-help">{t("logModeHelp")}</div>
                  </div>
                  <div className="pref-control">
                    <SelectField value={settings.logMode || "overwrite"} options={logModeOptions} onChange={(value) => saveSetting("logMode", value)} placeholder={t("logMode")} />
                  </div>
                </div>
                <div className="pref-row">
                  <div className="pref-copy">
                    <div className="pref-title">{t("compactList")}</div>
                    <div className="pref-help">{t("compactListDesc")}</div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={Boolean(settings.compactList)} onChange={(event) => saveSetting("compactList", event.target.checked)} />
                    <span className="switch-slider" />
                  </label>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <div className={`modal-backdrop ${drawerOpen ? "open" : ""}`} onClick={() => setDrawerOpen(false)}>
      <aside className={`drawer ${drawerOpen ? "open" : ""}`} onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="eyebrow">{t("commandStudio")}</div>
            <h3>{form.id ? t("editCommand") : t("createCommand")}</h3>
          </div>
          <button className="btn btn-sm ghost close" onClick={() => setDrawerOpen(false)}>{t("close")}</button>
        </div>

        <form className="drawer-form" onSubmit={saveForm}>
          <label>
            <span>{t("displayName")}</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            <span>{t("group")}</span>
            <SelectField
              value={groupSelectValue}
              options={groupFormOptions}
              onChange={(value) => {
                setGroupSelectValue(value);
                if (value === NEW_GROUP_VALUE) {
                  setForm((current) => ({ ...current, group: "" }));
                  return;
                }
                setForm((current) => ({ ...current, group: value }));
              }}
              placeholder={t("chooseGroup")}
            />
          </label>
          {groupSelectValue === NEW_GROUP_VALUE && (
            <label>
              <span>{t("newGroupName")}</span>
              <input value={form.group} placeholder={t("newGroupPlaceholder")} onChange={(event) => setForm({ ...form, group: event.target.value })} />
            </label>
          )}
          <label>
            <span>{t("executable")}</span>
            <div className="field-help">{t("commandFieldHint")}</div>
            <div className="browse-row">
              <input value={form.command} onChange={(event) => setForm({ ...form, command: event.target.value })} />
              <button type="button" className="btn btn-sm ghost small" onClick={browseCommandFile}>{t("browseFile")}</button>
            </div>
          </label>
          <label>
            <span>{t("arguments")}</span>
            <input value={form.args} onChange={(event) => setForm({ ...form, args: event.target.value })} />
          </label>
          <label>
            <span>{t("workingDirectory")}</span>
            <div className="field-help">{t("cwdFieldHint")}</div>
            <div className="browse-row">
              <input value={form.cwd} onChange={(event) => setForm({ ...form, cwd: event.target.value })} />
              <button type="button" className="btn btn-sm ghost small" onClick={browseDirectory}>{t("browseFolder")}</button>
            </div>
          </label>
          <label>
            <span>{t("environmentVariables")}</span>
            <textarea rows="8" value={form.envText} onChange={(event) => setForm({ ...form, envText: event.target.value })} placeholder={"OPENCLAW_TOKEN=abc\nPORT=8080"} />
          </label>
          <div className="drawer-actions">
            <button type="button" className="btn btn-md secondary" onClick={() => setDrawerOpen(false)}>{t("cancel")}</button>
            <button type="submit" className="btn btn-lg primary">{t("saveCommand")}</button>
          </div>
        </form>
      </aside>
      </div>

      <div className={`modal-backdrop ${logPanelOpen ? "open" : ""}`} onClick={() => setLogPanelOpen(false)}>
      <aside className={`log-drawer ${logPanelOpen ? "open" : ""}`} style={{ width: `min(${logDrawerWidth}px, calc(100vw - 36px))` }} onClick={(event) => event.stopPropagation()}>
        <div className="drawer-resizer" onMouseDown={startLogDrawerResize} />
        <div className="drawer-head">
          <div>
            <div className="eyebrow">{t("liveLogTail")}</div>
            <h3>{selected?.name || "--"}</h3>
          </div>
          <button className="btn btn-sm ghost" onClick={() => setLogPanelOpen(false)}>{t("hideLogPanel")}</button>
        </div>
        <div className="section-copy">{selectedStatus?.logPath || t("logWillCreate")}</div>
        <div className="control-row compact-controls">
          <button className="btn btn-sm ghost" onClick={() => setAutoScrollLogs((current) => !current)}>
            {autoScrollLogs ? t("pauseFollow") : t("autoScroll")}
          </button>
          <button className="btn btn-sm ghost" onClick={clearSelectedLog} disabled={!selectedStatus?.logPath}>
            {t("clearLog")}
          </button>
          <button className="btn btn-sm ghost" onClick={() => window.commandHub.openLogFolder()}>{t("openLogs")}</button>
        </div>
        <pre className="log-view drawer-log-view">{selected ? (logTail || t("noLogs")) : t("logsEmptySelect")}</pre>
      </aside>
      </div>
    </div>
  );
}

export default App;
