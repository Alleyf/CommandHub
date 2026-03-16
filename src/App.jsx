import { useEffect, useMemo, useRef, useState } from "react";

import {
  EMPTY_FORM,
  NEW_GROUP_VALUE,
  filePathFromHandle,
  format,
  formatDate,
  fromCommand,
  nowIso,
  stripAnsiSequences,
  toEnvMap,
  uid,
  uptime
} from "./app-utils";
import { APP_MESSAGES } from "./messages";
import {
  annotateMatchedProcesses,
  buildProcessGroups,
  buildVirtualProcessRows,
  getVirtualSlice
} from "./process-utils";
import { COMMAND_TEMPLATES } from "./command-templates";
import ProductivityHub from "./ProductivityHub";
import {
  AlertTriangle,
  Bot,
  Boxes,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  FolderSearch,
  Layers3,
  Logs,
  Orbit,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  ScanSearch,
  Search,
  Settings2,
  Sparkles,
  Square,
  ToggleLeft,
  Star,
  TerminalSquare,
  Trash2,
  Upload
} from "lucide-react";

function Metric({ label, value, hint, tone }) {
  return (
    <div className={`metric metric-${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-hint">{hint}</div>
    </div>
  );
}

function SelectField({ value, options, onChange, placeholder, className = "", disabled = false, icon: Icon = null, compact = false }) {
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
        className={`select-trigger ${compact ? "select-trigger-compact" : ""}`.trim()}
        disabled={disabled}
        onClick={() => !disabled && setOpen((current) => !current)}
      >
        {Icon && (
          <span className="select-leading-icon" aria-hidden="true">
            <Icon size={15} strokeWidth={2} />
          </span>
        )}
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

function NavIcon({ view }) {
  if (view === "commands") return <Bot size={16} strokeWidth={2.1} />;
  if (view === "library") return <Boxes size={16} strokeWidth={2.1} />;
  if (view === "logs") return <Logs size={16} strokeWidth={2.1} />;
  if (view === "productivity") return <Layers3 size={16} strokeWidth={2.1} />;
  return <Settings2 size={16} strokeWidth={2.1} />;
}

function getLibraryMeta(library) {
  const key = String(library || "").toLowerCase();
  if (key.includes("openclaw")) return { icon: Bot, tone: "library-openclaw" };
  if (key.includes("jupiter")) return { icon: Sparkles, tone: "library-jupiter" };
  if (key.includes("node")) return { icon: Boxes, tone: "library-node" };
  if (key.includes("python")) return { icon: TerminalSquare, tone: "library-python" };
  if (key.includes("java")) return { icon: Cpu, tone: "library-java" };
  if (key.includes("go")) return { icon: Orbit, tone: "library-go" };
  if (key.includes("docker")) return { icon: Boxes, tone: "library-docker" };
  if (key.includes("database")) return { icon: Database, tone: "library-db" };
  return { icon: FolderSearch, tone: "library-generic" };
}

function App() {
  const [commands, setCommands] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [usageStats, setUsageStats] = useState({ counts: {}, lastUsed: {} });
  const [systemProcesses, setSystemProcesses] = useState([]);
  const [settings, setSettings] = useState({
    closeToTray: true,
    launchAtLogin: false,
    language: "zh-CN",
    compactList: true,
    quietMode: false,
    errorReminder: true,
    themeMode: "system",
    particleMode: false,
    gestureMode: false,
    onboardingCompleted: false
  });
  const [systemTheme, setSystemTheme] = useState("dark");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const [commandsTab, setCommandsTab] = useState("commands");
  const [processesLoaded, setProcessesLoaded] = useState(false);
  const [expandedProcessGroups, setExpandedProcessGroups] = useState({});
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [processSortKey, setProcessSortKey] = useState("name");
  const [processSortDirection, setProcessSortDirection] = useState("asc");
  const [processScrollTop, setProcessScrollTop] = useState(0);
  const [processViewportHeight, setProcessViewportHeight] = useState(640);
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
  const [updateStatus, setUpdateStatus] = useState({ checking: false, message: "", type: "" });
  const [updateProgress, setUpdateProgress] = useState(null);
  const [actionStatus, setActionStatus] = useState({ message: "", type: "" });
  const [globalLogs, setGlobalLogs] = useState([]);
  const [globalLogType, setGlobalLogType] = useState("");
  const [globalLogQuery, setGlobalLogQuery] = useState("");
  const [globalLogCommandId, setGlobalLogCommandId] = useState("");
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState("");
  const [templateMatches, setTemplateMatches] = useState([]);
  const [templateScanBusy, setTemplateScanBusy] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingTargetRect, setOnboardingTargetRect] = useState(null);
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
  const inlineLogViewRef = useRef(null);
  const drawerLogViewRef = useRef(null);
  const processBodyRef = useRef(null);
  const refreshInFlightRef = useRef(null);

  const language = settings.language || "zh-CN";
  const copy = APP_MESSAGES[language] || APP_MESSAGES["zh-CN"];
  const effectiveParticleMode = Boolean(settings.particleMode);
  const effectiveGestureMode = effectiveParticleMode && Boolean(settings.gestureMode);

  function t(key, values) {
    const template = copy[key] || key;
    return values ? format(template, values) : template;
  }

  async function refreshState() {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }
    refreshInFlightRef.current = (async () => {
    const state = await window.commandHub.getState();
    setCommands(state.commands);
    setStatuses(state.statuses);
    setUsageStats(state.usageStats || { counts: {}, lastUsed: {} });
    setSettings((current) => {
      const merged = {
        compactList: true,
        quietMode: false,
        errorReminder: true,
        themeMode: "system",
        particleMode: false,
        gestureMode: false,
        onboardingCompleted: false,
        ...current,
        ...state.settings
      };
      // 强制禁用粒子模式和手势模式
      merged.particleMode = false;
      merged.gestureMode = false;
      return merged;
    });
    setSelectedId((current) => current || state.commands[0]?.id || "");
    setOnboardingOpen(!state.settings?.onboardingCompleted);
    })().finally(() => {
      refreshInFlightRef.current = null;
    });
    return refreshInFlightRef.current;
  }

  function showActionStatus(message, type = "success") {
    if (settings.quietMode && type !== "error") {
      return;
    }
    setActionStatus({ message, type });
    window.clearTimeout(showActionStatus.timerId);
    showActionStatus.timerId = window.setTimeout(() => {
      setActionStatus({ message: "", type: "" });
    }, 3000);
  }

  async function refreshGlobalLogs(nextOptions = {}) {
    const entries = await window.commandHub.getGlobalLogs({
      limit: 240,
      category: nextOptions.category ?? globalLogType,
      commandId: nextOptions.commandId ?? globalLogCommandId,
      query: nextOptions.query ?? globalLogQuery
    });
    setGlobalLogs(entries || []);
    setLogsLoaded(true);
    setSelectedLogId((current) => current && (entries || []).some((item) => item.id === current) ? current : entries?.[0]?.id || "");
  }

  useEffect(() => {
    refreshState();
    const disposeRuntime = window.commandHub.onRuntimeUpdated(refreshState);

    // 监听更新事件
    const unsubscribeProgress = window.commandHub.onUpdateProgress((progress) => {
      setUpdateProgress(progress);
      if (progress && progress.percent !== undefined) {
        setUpdateStatus({
          checking: false,
          message: `正在下载更新... ${Math.round(progress.percent)}%`,
          type: "info"
        });
      }
    });

    const unsubscribeDownloaded = window.commandHub.onUpdateDownloaded(() => {
      setUpdateProgress(null);
      setUpdateStatus({
        checking: false,
        message: "更新已下载完成",
        type: "success"
      });
    });

    return () => {
      disposeRuntime?.();
      unsubscribeProgress?.();
      unsubscribeDownloaded?.();
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

  const processGroups = useMemo(() => {
    const direction = processSortDirection === "asc" ? 1 : -1;
    const groups = buildProcessGroups(filteredProcesses).sort((a, b) => {
      if (processSortKey === "name") return a.name.localeCompare(b.name) * direction;
      if (processSortKey === "cpu") return (a.cpuValue - b.cpuValue) * direction;
      if (processSortKey === "memory") return (a.memoryValue - b.memoryValue) * direction;
      if (processSortKey === "pid") return (a.primaryPid - b.primaryPid) * direction;
      return 0;
    });

    const categoryOrder = ["application", "background", "service", "windows"];
    const categoryLabels = {
      application: { "zh-CN": "应用", "en-US": "Apps" },
      background: { "zh-CN": "后台进程", "en-US": "Background Processes" },
      service: { "zh-CN": "Windows 服务", "en-US": "Windows Services" },
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
  }, [filteredProcesses, language, processSortDirection, processSortKey]);

  const processRows = useMemo(
    () => buildVirtualProcessRows(processGroups, expandedProcessGroups, false),
    [expandedProcessGroups, processGroups]
  );

  const visibleProcessWindow = useMemo(
    () => getVirtualSlice(processRows, processScrollTop, processViewportHeight),
    [processRows, processScrollTop, processViewportHeight]
  );

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

  useEffect(() => {
    if (!effectiveParticleMode && settings.gestureMode) {
      saveSetting("particleMode", false);
    }
  }, [effectiveParticleMode, settings.gestureMode]);

  const selected = commands.find((item) => item.id === selectedId) || null;
  const selectedStatus = selected ? statuses[selected.id] || {} : null;
  const selectedGlobalLog = globalLogs.find((item) => item.id === selectedLogId) || globalLogs[0] || null;

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
    if (!selectedStatus?.logPath) return undefined;
    const shouldPoll = selectedStatus?.state === "running" || detailTab === "log" || logPanelOpen;
    if (!shouldPoll) return undefined;

    const timer = window.setInterval(async () => {
      const text = await window.commandHub.getLogTail(selectedStatus.logPath);
      setLogTail(stripAnsiSequences(text));
    }, 1200);

    return () => window.clearInterval(timer);
  }, [detailTab, logPanelOpen, selectedStatus?.logPath, selectedStatus?.state]);

  useEffect(() => {
    if (!autoScrollLogs) return;

    const syncToBottom = () => {
      for (const node of [inlineLogViewRef.current, drawerLogViewRef.current]) {
        if (!node) continue;
        node.scrollTop = node.scrollHeight;
      }
    };

    syncToBottom();
    const frameId = window.requestAnimationFrame(syncToBottom);
    return () => window.cancelAnimationFrame(frameId);
  }, [logTail, autoScrollLogs, activeView, detailTab, logPanelOpen, selectedId]);

  useEffect(() => {
    if (activeView === "logs") {
      refreshGlobalLogs();
    }
  }, [activeView, globalLogType, globalLogCommandId, globalLogQuery, commands, statuses]);

  const metrics = useMemo(() => {
    const running = Object.values(statuses).filter((item) => item.state === "running").length;
    return { total: commands.length, running, idle: Math.max(0, commands.length - running) };
  }, [commands, statuses]);

  const favoriteCommands = useMemo(() => commands.filter((item) => item.isFavorite), [commands]);
  const recentCommands = useMemo(() => {
    const lastUsed = usageStats?.lastUsed || {};
    return [...commands]
      .filter((item) => lastUsed[item.id])
      .sort((left, right) => new Date(lastUsed[right.id]).getTime() - new Date(lastUsed[left.id]).getTime())
      .slice(0, 5);
  }, [commands, usageStats]);
  const hasNoCommands = commands.length === 0;

  async function runCommandAction(task, successMessage) {
    try {
      const result = await task();
      if (result?.state === "error") {
        const message = [result.message, result.hint].filter(Boolean).join(" · ");
        showActionStatus(message || t("actionFailed", { error: "Unknown error" }), "error");
      } else if (successMessage) {
        showActionStatus(successMessage, "success");
      }
      await refreshState();
      return result;
    } catch (error) {
      showActionStatus(t("actionFailed", { error: error.message || String(error) }), "error");
      throw error;
    }
  }

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
      accentTone: form.accentTone || "teal",
      isFavorite: Boolean(form.isFavorite),
      env: toEnvMap(form.envText),
      autoRestart: false,
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
      lastStartedAt: existing?.lastStartedAt || null,
      lastExitCode: existing?.lastExitCode ?? null,
      lastStoppedAt: existing?.lastStoppedAt || null,
      lastState: existing?.lastState || "stopped",
      lastHint: existing?.lastHint || ""
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
    await runCommandAction(() => window.commandHub.startCommand(selected), t("commandStarted", { name: selected.name }));
  }

  async function stopSelected() {
    if (!selected) return;
    await runCommandAction(() => window.commandHub.stopCommand(selected.id), t("commandStopped", { name: selected.name }));
  }

  async function startCommandItem(command) {
    if (!command) return;
    await runCommandAction(() => window.commandHub.startCommand(command), t("commandStarted", { name: command.name }));
  }

  async function stopCommandItem(commandId) {
    if (!commandId) return;
    const target = commands.find((item) => item.id === commandId);
    await runCommandAction(() => window.commandHub.stopCommand(commandId), t("commandStopped", { name: target?.name || "--" }));
  }

  async function restartSelected() {
    if (!selected) return;
    await runCommandAction(() => window.commandHub.restartCommand(selected), t("commandRestarted", { name: selected.name }));
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
    if (key === "particleMode" && !value) {
      next.gestureMode = false;
    }
    const persisted = await window.commandHub.saveSettings(next);
    setSettings(persisted);
  }

  async function completeOnboarding() {
    setOnboardingOpen(false);
    setOnboardingStep(0);
    if (!settings.onboardingCompleted) {
      const persisted = await window.commandHub.saveSettings({ ...settings, onboardingCompleted: true });
      setSettings(persisted);
    }
  }

  function reopenOnboarding() {
    setOnboardingStep(0);
    setOnboardingOpen(true);
  }

  async function updateCommandMeta(commandId, patch) {
    const target = commands.find((item) => item.id === commandId);
    if (!target) return;
    await window.commandHub.saveCommand({
      ...target,
      ...patch,
      updatedAt: nowIso()
    });
    await refreshState();
  }

  async function toggleFavorite(commandId) {
    const target = commands.find((item) => item.id === commandId);
    if (!target) return;
    await updateCommandMeta(commandId, { isFavorite: !target.isFavorite });
  }

  async function importCommands() {
    try {
      const result = await window.commandHub.importCommands();
      if (result?.ok) {
        showActionStatus(t("importSuccess", { count: result.count }));
        await refreshState();
      }
    } catch (error) {
      showActionStatus(t("actionFailed", { error: error.message || String(error) }), "error");
    }
  }

  async function exportCommands() {
    try {
      const result = await window.commandHub.exportCommands();
      if (result?.ok) {
        showActionStatus(t("exportSuccess", { count: result.count }));
      }
    } catch (error) {
      showActionStatus(t("actionFailed", { error: error.message || String(error) }), "error");
    }
  }

  async function scanTemplateLibraries() {
    setTemplateScanBusy(true);
    try {
      const result = await window.commandHub.scanTemplateLibraries(COMMAND_TEMPLATES);
      setTemplateMatches(result?.matches || []);
      setActiveView("library");
    } catch (error) {
      showActionStatus(t("actionFailed", { error: error.message || String(error) }), "error");
    } finally {
      setTemplateScanBusy(false);
    }
  }

  function applyTemplate(template) {
    const payload = {
      ...EMPTY_FORM,
      id: uid(),
      name: template.name,
      command: template.detectedCommand || template.command,
      args: template.args || "",
      cwd: template.cwd || "",
      envText: template.envText || "",
      group: template.group || "",
      accentTone: template.accentTone || "teal",
      isFavorite: false
    };
    setForm(payload);
    setGroupSelectValue(payload.group && groups.includes(payload.group) ? payload.group : payload.group ? NEW_GROUP_VALUE : "");
    setActiveView("commands");
    setDrawerOpen(true);
  }

  async function exportGlobalLogs() {
    try {
      const result = await window.commandHub.exportGlobalLogs({
        category: globalLogType,
        commandId: globalLogCommandId,
        query: globalLogQuery
      });
      if (result?.ok) {
        showActionStatus(t("logExportSuccess", { count: result.count }));
      }
    } catch (error) {
      showActionStatus(t("actionFailed", { error: error.message || String(error) }), "error");
    }
  }

  async function clearOperationLogs() {
    await window.commandHub.clearOperationLogs();
    await refreshGlobalLogs();
  }

  async function clearSelectedLog() {
    if (!selectedStatus?.logPath) return;
    await window.commandHub.clearLog(selectedStatus.logPath);
    setLogTail("");
  }

  async function handleCheckForUpdates() {
    setUpdateStatus({ checking: true, message: t("checkingForUpdates"), type: "" });
    try {
      const result = await window.commandHub.checkForUpdates();
      if (result.ok) {
        setTimeout(() => {
          setUpdateStatus({ checking: false, message: t("noUpdatesAvailable"), type: "success" });
          setTimeout(() => setUpdateStatus({ checking: false, message: "", type: "" }), 3000);
        }, 500);
      } else {
        setUpdateStatus({ checking: false, message: t("checkUpdateError", { error: result.error }), type: "error" });
        setTimeout(() => setUpdateStatus({ checking: false, message: "", type: "" }), 5000);
      }
    } catch (error) {
      setUpdateStatus({ checking: false, message: t("checkUpdateError", { error: error.message }), type: "error" });
      setTimeout(() => setUpdateStatus({ checking: false, message: "", type: "" }), 5000);
    }
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
    setProcessScrollTop(0);
    processBodyRef.current?.scrollTo({ top: 0 });
  }, [matchedOnly, search, processSortDirection, processSortKey]);

  useEffect(() => {
    const node = processBodyRef.current;
    if (!node) return;

    const measure = () => setProcessViewportHeight(node.clientHeight || 640);
    measure();

    const observer = new ResizeObserver(() => measure());
    observer.observe(node);
    return () => observer.disconnect();
  }, [commandsTab]);

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
        [t("lastUsed"), formatDate(usageStats?.lastUsed?.[selected.id])],
        [t("exitCode"), selected.lastExitCode ?? "--"],
        [t("failureHint"), selectedStatus?.hint || selected.lastHint || "--"],
        [t("stateNote"), selectedStatus?.message || t("statusReady")]
      ]
    : [];

  const navItems = [["commands", t("navCommands")], ["library", t("navLibrary")], ["productivity", t("navProductivity")], ["logs", t("navLogs")], ["settings", t("navSettings")], ["about", t("navAbout")]];
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
  const onboardingSteps = [
    {
      title: hasNoCommands ? t("onboardingStepCreateTitle") : t("onboardingStepCommandsTitle"),
      body: hasNoCommands ? t("onboardingStepCreateBody") : t("onboardingStepCommandsBody"),
      actionLabel: hasNoCommands ? t("emptyEntryCreate") : t("onboardingOpenCommands"),
      action: () => {
        setActiveView("commands");
        setCommandsTab("commands");
        if (hasNoCommands) {
          openCreate();
        }
      },
      view: "commands",
      target: hasNoCommands ? "empty-entry" : "command-surface"
    },
    {
      title: t("onboardingStepLibraryTitle"),
      body: t("onboardingStepLibraryBody"),
      actionLabel: t("onboardingOpenLibrary"),
      action: () => setActiveView("library"),
      view: "library",
      target: "library-surface"
    },
    {
      title: t("onboardingStepModesTitle"),
      body: t("onboardingStepModesBody"),
      actionLabel: t("onboardingOpenCommands"),
      action: () => {
        setActiveView("commands");
        setCommandsTab("commands");
      },
      view: "commands",
      target: hasNoCommands ? "empty-entry" : "detail-surface"
    }
  ];
  const currentOnboardingStep = onboardingSteps[onboardingStep] || onboardingSteps[0];

  function onboardingFocusClass(target) {
    if (!onboardingOpen) return "";
    return currentOnboardingStep?.target === target ? "onboarding-focus-target" : "";
  }

  useEffect(() => {
    if (!onboardingOpen) return;
    const step = currentOnboardingStep;
    if (!step?.view || activeView === step.view) return;
    setActiveView(step.view);
    if (step.view === "commands") setCommandsTab("commands");
  }, [activeView, currentOnboardingStep, onboardingOpen]);

  useEffect(() => {
    if (!onboardingOpen) {
      setOnboardingTargetRect(null);
      return;
    }
    const target = currentOnboardingStep?.target;
    if (!target) {
      setOnboardingTargetRect(null);
      return;
    }

    let rafId = 0;
    const measure = () => {
      const element = document.querySelector(`[data-onboarding-target="${target}"]`);
      if (!element) {
        setOnboardingTargetRect(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      const paddedTop = Math.max(12, rect.top - 8);
      const paddedLeft = Math.max(12, rect.left - 8);
      setOnboardingTargetRect({
        top: paddedTop,
        left: paddedLeft,
        width: Math.min(rect.width + 16, window.innerWidth - paddedLeft - 12),
        height: Math.min(rect.height + 16, window.innerHeight - paddedTop - 12)
      });
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };

    scheduleMeasure();
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
    };
  }, [activeView, commandsTab, currentOnboardingStep?.target, onboardingOpen]);

  const logModeOptions = [
    { value: "overwrite", label: t("logModeOverwrite") },
    { value: "append", label: t("logModeAppend") }
  ];
  const accentOptions = [
    { value: "teal", label: t("accentTeal") },
    { value: "gold", label: t("accentGold") },
    { value: "coral", label: t("accentCoral") },
    { value: "slate", label: t("accentSlate") }
  ];
  const globalLogTypeOptions = [
    { value: "", label: t("allLogTypes") },
    { value: "operation", label: t("operationLogs") },
    { value: "command", label: t("commandLogs") }
  ];
  const globalLogCommandOptions = [{ value: "", label: t("allCommands") }, ...commands.map((item) => ({ value: item.id, label: item.name }))];
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
              <span className="nav-button-inner"><NavIcon view={id} />{label}</span>
            </button>
          ))}
        </div>

        <div className="metrics">
          <Metric label={t("managedCommands")} value={metrics.total} hint={t("configuredInventory")} tone="gold" />
          <Metric label={t("currentlyRunning")} value={metrics.running} hint={t("activeInBackground")} tone="green" />
          <Metric label={t("stoppedOrIdle")} value={metrics.idle} hint={t("readyToLaunch")} tone="red" />
        </div>

        <div className="sidebar-note">
          <span>{t("silentMode")}</span>
          <p>{t("silentModeDesc")}</p>
        </div>
      </aside>

      <main className="main-stage">
        {updateProgress && (
          <div className="card status-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <div>{updateStatus.message}</div>
                <div style={{ marginTop: '6px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${updateProgress.percent}%`, background: '#52d6a2', transition: 'width 0.3s' }} />
                </div>
              </div>
            </div>
          </div>
        )}
        {actionStatus.message && (
          <div className={`card status-banner ${actionStatus.type === "error" ? "status-banner-error" : ""}`}>
            {actionStatus.message}
          </div>
        )}
        {activeView === "commands" && (
          <>
            {commandsTab === "commands" ? (
              <section data-onboarding-target="command-surface" className={`hero ${onboardingFocusClass("command-surface")}`.trim()}>
                <div className="hero-copy">
                  <div className="eyebrow">{t("operationsDeck")}</div>
                  <h2>{t("heroTitle")}</h2>
                  <p className="hero-copy-line">{t("heroDesc")}</p>
                </div>
                <div className="hero-toolbar">
                  <label className="toolbar-search-shell">
                    <Search size={15} />
                    <input className="search toolbar-search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchPlaceholder")} />
                  </label>
                  <div className="hero-filter-row">
                    <SelectField
                      className="group-select toolbar-filter"
                      value={selectedGroup}
                      options={groupFilterOptions}
                      onChange={setSelectedGroup}
                      placeholder={t("allGroups")}
                      icon={Layers3}
                      compact
                    />
                    <SelectField
                      className="group-select toolbar-filter"
                      value={selectedState}
                      options={stateSelectOptions}
                      onChange={setSelectedState}
                      placeholder={t("allStates")}
                      icon={ToggleLeft}
                      compact
                    />
                  </div>
                  <div className="hero-action-row">
                    <button className="btn btn-sm teal hero-icon-button" onClick={startVisibleGroup} title={t("startAll")} aria-label={t("startAll")}>
                      <Play size={15} />
                    </button>
                    <button className="btn btn-sm secondary hero-icon-button" onClick={stopVisibleGroup} title={t("stopAll")} aria-label={t("stopAll")}>
                      <Square size={15} />
                    </button>
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

            {commandsTab === "commands" && (
              <section className="shortcut-band">
                <div className="recent-strip recent-strip-inline">
                  <div className="recent-strip-copy inline">
                    <div className="section-title">{t("favorites")}</div>
                  </div>
                  <div className="recent-strip-actions">
                    {favoriteCommands.length === 0 ? (
                      <div className="row-sub">{t("noFavorites")}</div>
                    ) : (
                      favoriteCommands.slice(0, 5).map((item) => (
                        <button
                          key={`favorite-${item.id}`}
                          className={`btn btn-sm ghost recent-chip accent-chip accent-${item.accentTone || "teal"}`}
                          onClick={() => {
                            setSelectedId(item.id);
                            const state = statuses[item.id]?.state || "stopped";
                            if (state === "running") {
                              stopCommandItem(item.id);
                            } else {
                              startCommandItem(item);
                            }
                          }}
                        >
                          <Star size={12} />
                          <span>{item.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <div className="recent-strip recent-strip-inline">
                  <div className="recent-strip-copy inline">
                    <div className="section-title">{t("recentCommands")}</div>
                  </div>
                  <div className="recent-strip-actions">
                    {recentCommands.length === 0 ? (
                      <div className="row-sub">{t("noRecentCommands")}</div>
                    ) : (
                      recentCommands.map((item) => (
                        <button
                          key={`recent-${item.id}`}
                          className={`btn btn-sm ghost recent-chip accent-chip accent-${item.accentTone || "teal"}`}
                          onClick={() => {
                            setSelectedId(item.id);
                            startCommandItem(item);
                          }}
                        >
                          <span>{item.name}</span>
                          <span className="recent-chip-time">{formatDate(usageStats?.lastUsed?.[item.id])}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </section>
            )}

            {commandsTab === "commands" && hasNoCommands && (
              <section data-onboarding-target="empty-entry" className={`command-empty-entry ${onboardingFocusClass("empty-entry")}`.trim()}>
                <div className="command-empty-entry-main">
                  <div className="eyebrow">{t("commandStudio")}</div>
                  <h3>{t("emptyEntryTitle")}</h3>
                  <p className="section-copy">{t("emptyEntryDesc")}</p>
                </div>
                <div className="command-empty-entry-actions">
                  <button className="btn btn-md teal" onClick={openCreate}><Plus size={15} />{t("emptyEntryCreate")}</button>
                  <button className="btn btn-md ghost" onClick={importCommands}><Upload size={15} />{t("emptyEntryImport")}</button>
                  <button className="btn btn-md secondary" onClick={() => setActiveView("library")}><FolderSearch size={15} />{t("emptyEntryTemplates")}</button>
                </div>
              </section>
            )}

            <div className={`subtabs ${commandsTab === "commands" && hasNoCommands ? "subtabs-compact" : ""}`.trim()}>
              <button className={`btn btn-sm subtab ${commandsTab === "commands" ? "active" : ""}`} onClick={() => setCommandsTab("commands")}>
                {t("commandTab")}
              </button>
              <button className={`btn btn-sm subtab ${commandsTab === "processes" ? "active" : ""}`} onClick={() => setCommandsTab("processes")}>
                {t("processTab")}
              </button>
            </div>

            <section className={commandsTab === "processes" ? "content-grid process-layout" : hasNoCommands ? "content-grid content-grid-empty" : "content-grid"}>
              {commandsTab === "commands" && (
              <div className="inventory card">
                <div className="section-head split-head">
                  <div>
                    <div className="section-title section-title-with-icon"><TerminalSquare size={14} />{t("managedInventory")}</div>
                    <div className="section-copy">{t("visibleTotal", { visible: sortedCommands.length, total: commands.length })}</div>
                  </div>
                  <div className="inventory-actions">
                    <div className="section-copy right-copy">{t("listSummary")}</div>
                    <div className="toolbar-buttons compact-actions">
                      <button className="btn btn-sm primary" onClick={openCreate}><Plus size={14} />{t("newCommand")}</button>
                      <button className="btn btn-sm ghost" onClick={openEdit} disabled={!selected}><Pencil size={14} />{t("editSelected")}</button>
                      <button className="btn btn-sm danger" onClick={removeSelected} disabled={!selected}><Trash2 size={14} />{t("deleteSelected")}</button>
                    </div>
                  </div>
                </div>

                {false && settings.particleMode ? (
                  <div className="particle-panel">
                    {sortedCommands.length === 0 ? (
                      <div className="empty">{t("emptyCommands")}</div>
                    ) : (
                      <ParticleCommandStage
                        commands={sortedCommands}
                        statuses={statuses}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        onStart={startCommandItem}
                        onStop={stopCommandItem}
                        gestureEnabled={effectiveGestureMode}
                        copy={copy}
                        format={format}
                      />
                    )}
                  </div>
                ) : (
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
                        const hint = statuses[item.id]?.hint || item.lastHint || "";
                        const accentTone = item.accentTone || "teal";
                        return (
                          <button
                            key={item.id}
                            className={`table-row command-row accent-${accentTone} ${item.isFavorite ? "is-favorite" : ""} ${selectedId === item.id ? "selected" : ""}`}
                            onClick={() => setSelectedId(item.id)}
                            onDoubleClick={() => {
                              setSelectedId(item.id);
                              setTimeout(() => {
                                const current = commands.find((entry) => entry.id === item.id);
                                const currentState = statuses[item.id]?.state || "stopped";
                                if (!current) return;
                                if (currentState === "running") {
                                  stopCommandItem(item.id);
                                } else {
                                  startCommandItem(current);
                                }
                              }, 0);
                            }}
                            style={{ gridTemplateColumns: tableTemplate }}
                          >
                            <div className="cell cell-name">
                              <div className="row-title">
                                {item.isFavorite && <Star size={12} className="favorite-star" />}
                                <span>{item.name}</span>
                              </div>
                              <div className="row-sub">{item.command}</div>
                              <div className="row-sub">
                                {status === "running" ? `${t("uptime")}: ${uptime(statuses[item.id]?.startedAt)}` : `${t("lastUsed")}: ${formatDate(usageStats?.lastUsed?.[item.id])}`}
                              </div>
                              {hint && status === "error" && <div className="row-sub row-sub-warning">{hint}</div>}
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
                )}
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
                      <div
                        ref={processBodyRef}
                        className="table-body process-group-body"
                        onScroll={(event) => setProcessScrollTop(event.currentTarget.scrollTop)}
                      >
                        {!processesLoaded && <div className="empty">{t("loadProcesses")}</div>}
                        {processesLoaded && filteredProcesses.length === 0 && <div className="empty">{t("emptyProcesses")}</div>}
                        {processesLoaded && filteredProcesses.length > 0 && (
                          <div className="process-virtual-space" style={{ height: `${visibleProcessWindow.totalHeight}px` }}>
                            <div
                              className="process-virtual-layer"
                              style={{ transform: `translateY(${visibleProcessWindow.topSpacer}px)` }}
                            >
                              {visibleProcessWindow.items.map((row) => {
                                if (row.type === "section") {
                                  return (
                                    <div key={row.key} className="process-section-title process-row-shell">
                                      <span>{row.section.label}</span>
                                      <span className="process-section-count">{row.section.items.length}</span>
                                    </div>
                                  );
                                }

                                if (row.type === "group") {
                                  const { group, expanded } = row;
                                  return (
                                    <div key={row.key} className="process-group process-row-shell">
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
                                            {`${t("pid")}: ${group.primaryPid}`}
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
                                    </div>
                                  );
                                }

                                const item = row.item;
                                return (
                                  <div key={row.key} className="process-group-children process-row-shell">
                                    <div className={`table-row process-table process-child-row ${item.isManaged ? "process-row-managed" : ""}`}>
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
                                  </div>
                                );
                              })}
                            </div>
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
                    <div data-onboarding-target="detail-surface" className={`card detail-card ${onboardingFocusClass("detail-surface")}`.trim()}>
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
                          {selectedStatus?.hint && (
                            <div className="hint-banner">
                              <AlertTriangle size={16} />
                              <span>{selectedStatus.hint}</span>
                            </div>
                          )}
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
                              <pre ref={inlineLogViewRef} className="log-view inline-log-view">{selected ? (logTail || t("noLogs")) : t("logsEmptySelect")}</pre>
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
                        <button className={`btn btn-md ghost ${selected?.isFavorite ? "favorite-toggle-active" : ""}`} onClick={() => selected && toggleFavorite(selected.id)} disabled={!selected}>
                          <Star size={14} />{selected?.isFavorite ? t("unfavorite") : t("favorite")}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              )}
            </section>
          </>
        )}

        {activeView === "logs" && (
          <section className="single-panel">
            <div className="content-grid logs-layout">
              <div className="card panel-card logs-panel">
                <div className="split-head">
                  <div>
                    <div className="section-title">{t("logsCenterTitle")}</div>
                    <div className="section-copy">{t("logsCenterDesc")}</div>
                  </div>
                  <div className="toolbar-buttons">
                    <button className="btn btn-sm ghost" onClick={() => refreshGlobalLogs()}>{t("refreshLogs")}</button>
                    <button className="btn btn-sm ghost" onClick={exportGlobalLogs}>{t("exportLogs")}</button>
                    <button className="btn btn-sm danger" onClick={clearOperationLogs}>{t("clearOperationLogs")}</button>
                  </div>
                </div>
                <div className="hero-row triple log-filter-row">
                  <SelectField value={globalLogType} options={globalLogTypeOptions} onChange={setGlobalLogType} placeholder={t("allLogTypes")} />
                  <SelectField value={globalLogCommandId} options={globalLogCommandOptions} onChange={setGlobalLogCommandId} placeholder={t("allCommands")} />
                  <button className="btn btn-md ghost" onClick={() => window.commandHub.openLogFolder()}>{t("openCommandLog")}</button>
                </div>
                <input className="search" value={globalLogQuery} onChange={(event) => setGlobalLogQuery(event.target.value)} placeholder={t("searchPlaceholder")} />
                <div className="table-wrap logs-table-wrap">
                  <div className="table-body logs-list">
                    {!logsLoaded && <div className="empty">{t("refreshLogs")}</div>}
                    {logsLoaded && globalLogs.length === 0 && <div className="empty">{t("noGlobalLogs")}</div>}
                    {globalLogs.map((entry) => (
                      <button key={entry.id} className={`log-row ${selectedGlobalLog?.id === entry.id ? "selected" : ""}`} onClick={() => setSelectedLogId(entry.id)}>
                        <div className="log-row-top">
                          <span className={`badge ${entry.category === "command" ? "badge-pid" : "badge-name"}`}>
                            {entry.category === "command" ? t("logCategoryCommand") : t("logCategoryOperation")}
                          </span>
                          <span className="log-row-date">{formatDate(entry.createdAt)}</span>
                        </div>
                        <div className="log-row-title">{entry.title}</div>
                        <div className="row-sub">{entry.summary || "--"}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="detail-rail">
                <div className="card detail-card">
                  <div className="detail-header">
                    <div className="section-title">{t("logDetails")}</div>
                  </div>
                  {selectedGlobalLog ? (
                    <>
                      <h3>{selectedGlobalLog.title}</h3>
                      <div className="detail-grid">
                        {[
                          [t("logSummary"), selectedGlobalLog.summary || "--"],
                          [t("logCreatedAt"), formatDate(selectedGlobalLog.createdAt)],
                          [t("logLevel"), selectedGlobalLog.level || "--"],
                          [t("logCategory"), selectedGlobalLog.category === "command" ? t("logCategoryCommand") : t("logCategoryOperation")],
                          [t("command"), selectedGlobalLog.commandName || "--"],
                          [t("logState"), selectedGlobalLog.state || "--"]
                        ].map(([label, value]) => (
                          <div key={label} className="detail-row">
                            <span>{label}</span>
                            <strong>{value}</strong>
                          </div>
                        ))}
                      </div>
                      <pre className="command-preview log-detail-json">
                        {JSON.stringify(selectedGlobalLog.details || {}, null, 2)}
                      </pre>
                    </>
                  ) : (
                    <div className="empty">{t("noGlobalLogs")}</div>
                  )}
                </div>

                <div className="card controls-card">
                  <div className="section-title">{t("commandOutput")}</div>
                  <pre className="log-view inline-log-view">{selectedGlobalLog?.tail || t("noLogs")}</pre>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeView === "library" && (
          <section className="single-panel">
            <div className="content-grid library-layout">
              <div data-onboarding-target="library-surface" className={`card panel-card logs-panel ${onboardingFocusClass("library-surface")}`.trim()}>
                <div className="split-head">
                  <div>
                    <div className="section-title section-title-with-icon"><FolderSearch size={14} />{t("libraryTitle")}</div>
                    <div className="section-copy">{t("libraryDesc")}</div>
                  </div>
                  <div className="toolbar-buttons">
                    <button className="btn btn-sm primary" onClick={scanTemplateLibraries} disabled={templateScanBusy}><ScanSearch size={14} />{t("scanEnvironment")}</button>
                    <button className="btn btn-sm ghost" onClick={importCommands}><Upload size={14} />{t("importCommands")}</button>
                    <button className="btn btn-sm ghost" onClick={exportCommands}><Download size={14} />{t("exportCommands")}</button>
                  </div>
                </div>
                <div className="template-scan-banner">
                  <Sparkles size={16} />
                  <span>{t("scanEnvironmentDesc")}</span>
                </div>
                <div className="template-grid">
                  {(templateMatches.length > 0 ? templateMatches : COMMAND_TEMPLATES).map((template) => {
                    const meta = getLibraryMeta(template.library || template.group);
                    const LibraryIcon = meta.icon;
                    return (
                      <div key={`${template.id}-${template.detectedPath || "library"}`} className={`template-card ${meta.tone}`}>
                        <div className="template-card-top">
                          <div className="template-library-pill">
                            <LibraryIcon size={15} />
                            <span>{template.library || template.group || "Template"}</span>
                          </div>
                          {template.detectedPath && <span className="template-path mono">{template.detectedPath}</span>}
                        </div>
                        <div className="template-card-title">{template.name}</div>
                        <div className="section-copy">{template.description?.[language] || template.description?.["zh-CN"] || ""}</div>
                        <pre className="command-preview template-preview">{[template.command, template.args].filter(Boolean).join(" ")}</pre>
                        <button className="btn btn-sm ghost strong-ghost" onClick={() => applyTemplate(template)}><Plus size={14} />{t("useTemplate")}</button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="detail-rail">
                <div className="card detail-card template-detected-card">
                  <div className="section-title section-title-with-icon"><ScanSearch size={14} />{t("detectedTemplates")}</div>
                  {templateMatches.length > 0 ? (
                    <div className="template-match-list">
                      {templateMatches.map((template) => {
                        const meta = getLibraryMeta(template.library || template.group);
                        const LibraryIcon = meta.icon;
                        return (
                          <button key={`${template.id}-${template.detectedPath || "detected"}`} className={`log-row template-match-row ${meta.tone}`} onClick={() => applyTemplate(template)}>
                            <div className="log-row-top">
                              <div className="log-row-badges">
                                <span className="template-library-pill"><LibraryIcon size={14} />{template.library || template.group || "Template"}</span>
                                <span className="log-level-pill log-level-success"><CheckCircle2 size={14} />detected</span>
                              </div>
                            </div>
                            <div className="log-row-title">{template.name}</div>
                            <div className="row-sub">{template.detectedPath || template.command}</div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty">{t("noTemplateMatches")}</div>
                  )}
                </div>

                <div className="card controls-card">
                  <div className="section-title section-title-with-icon"><Boxes size={14} />{t("builtInTemplates")}</div>
                  <div className="section-copy">{t("templateDesc")}</div>
                  <div className="metric-value">{COMMAND_TEMPLATES.length}</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeView === "productivity" && (
          <ProductivityHub active={activeView === "productivity"} t={t} onToast={showActionStatus} />
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
                    <div className="pref-title">{t("quietMode")}</div>
                    <div className="pref-help">{t("quietModeDesc")}</div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={Boolean(settings.quietMode)} onChange={(event) => saveSetting("quietMode", event.target.checked)} />
                    <span className="switch-slider" />
                  </label>
                </div>
                <div className="pref-row">
                  <div className="pref-copy">
                    <div className="pref-title">{t("errorReminder")}</div>
                    <div className="pref-help">{t("errorReminderDesc")}</div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={Boolean(settings.errorReminder)} onChange={(event) => saveSetting("errorReminder", event.target.checked)} />
                    <span className="switch-slider" />
                  </label>
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
                {/*
                <div className="pref-row">
                  <div className="pref-copy">
                    <div className="pref-title">{t("particleMode")}</div>
                    <div className="pref-help">{t("particleModeDesc")}</div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={Boolean(settings.particleMode)} onChange={(event) => saveSetting("particleMode", event.target.checked)} />
                    <span className="switch-slider" />
                  </label>
                </div>
                <div className="pref-row">
                  <div className="pref-copy">
                    <div className="pref-title">{t("gestureMode")}</div>
                    <div className="pref-help">{t("gestureModeDesc")}</div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={effectiveGestureMode}
                      disabled={!effectiveParticleMode}
                      onChange={(event) => saveSetting("gestureMode", event.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>
                */}
                <div className="pref-row">
                  <div className="pref-copy">
                    <div className="pref-title">{t("checkForUpdates")}</div>
                    <div className="pref-help">{updateStatus.message || t("settingsDesc")}</div>
                  </div>
                  <button className={`btn btn-md ${updateStatus.type === "error" ? "danger" : "ghost"}`} onClick={handleCheckForUpdates} disabled={updateStatus.checking}>
                    {updateStatus.checking ? t("checkingForUpdates") : t("checkForUpdates")}
                  </button>
                </div>
                <div className="pref-row">
                  <div className="pref-copy">
                    <div className="pref-title">{t("onboardingTitle")}</div>
                    <div className="pref-help">{t("onboardingSubtitle")}</div>
                  </div>
                  <button className="btn btn-md ghost" onClick={reopenOnboarding}>
                    {t("reopenOnboarding")}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeView === "about" && (
          <section className="single-panel">
            <div className="card panel-card">
              <div className="section-title">关于 CommandHub</div>

              {/* 头部介绍 */}
              <div style={{ marginTop: '24px', marginBottom: '32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
                  <svg width="64" height="64" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ borderRadius: '16px' }}>
                    <rect x="8" y="8" width="80" height="80" rx="24" fill="#071118"/>
                    <defs>
                      <linearGradient id="hubShell2" x1="8%" y1="10%" x2="88%" y2="90%">
                        <stop offset="0%" stop-color="#f4c95d"/>
                        <stop offset="52%" stop-color="#66d9e8"/>
                        <stop offset="100%" stop-color="#52d6a2"/>
                      </linearGradient>
                      <linearGradient id="hubBeam2" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#fef1bf"/>
                        <stop offset="100%" stop-color="#66d9e8"/>
                      </linearGradient>
                    </defs>
                    <rect x="8" y="8" width="80" height="80" rx="24" stroke="url(#hubShell2)" stroke-width="3"/>
                    <path d="M28 64V32L48 50L68 32V64" stroke="url(#hubShell2)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="48" cy="48" r="8" fill="url(#hubBeam2)"/>
                    <path d="M48 24V40M24 48H40M56 48H72M48 56V72" stroke="url(#hubBeam2)" strokeWidth="5" strokeLinecap="round"/>
                  </svg>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '20px' }}>CommandHub</div>
                    <div style={{ fontSize: '14px', opacity: 0.7 }}>版本 0.4.7</div>
                  </div>
                </div>

                <p style={{ fontSize: '14px', lineHeight: 1.7, opacity: 0.85, marginBottom: '12px' }}>
                  CommandHub 是一个跨平台桌面应用，用于管理和监控后台运行的 CLI 服务。让命令行工具在后台持续运行，提供可视化的进程监控、日志查看和快捷操作。
                </p>
              </div>

              {/* 使用场景 */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '24px', marginTop: '16px' }}>
                <div className="section-title" style={{ fontSize: '14px', marginBottom: '16px' }}>典型使用场景</div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px', color: '#52d6a2' }}>开发服务器</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, lineHeight: 1.5 }}>
                      Node.js、Python Django/Flask、Go 开发服务器等开发环境常驻运行
                    </div>
                  </div>

                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px', color: '#66d9e8' }}>内网穿透</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, lineHeight: 1.5 }}>
                      frp、localtunnel、ngrok 等内网穿透工具持续运行
                    </div>
                  </div>

                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px', color: '#f4c95d' }}>数据库服务</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, lineHeight: 1.5 }}>
                      MySQL、MongoDB、Redis 等本地数据库服务管理
                    </div>
                  </div>

                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px', color: '#f57d7d' }}>自动化工具</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, lineHeight: 1.5 }}>
                      定时任务脚本、文件同步、备份工具等常驻运行
                    </div>
                  </div>

                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px', color: '#a78bfa' }}>测试工具</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, lineHeight: 1.5 }}>
                      JMeter、Locust 等压测工具后台运行
                    </div>
                  </div>

                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px', color: '#34d399' }}>代理服务</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, lineHeight: 1.5 }}>
                      V2Ray、Clash、Surge 等代理工具稳定运行
                    </div>
                  </div>
                </div>
              </div>

              {/* 核心功能 */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '24px', marginTop: '24px' }}>
                <div className="section-title" style={{ fontSize: '14px', marginBottom: '16px' }}>核心功能</div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#52d6a2' }} />
                    <span style={{ fontSize: '13px', opacity: 0.85 }}>一键启动/停止/重启服务</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#66d9e8' }} />
                    <span style={{ fontSize: '13px', opacity: 0.85 }}>实时日志监控和搜索</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f4c95d' }} />
                    <span style={{ fontSize: '13px', opacity: 0.85 }}>进程状态自动检测和告警</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f57d7d' }} />
                    <span style={{ fontSize: '13px', opacity: 0.85 }}>开机自启动和托盘常驻</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#a78bfa' }} />
                    <span style={{ fontSize: '13px', opacity: 0.85 }}>命令模板快速复用</span>
                  </div>
                </div>
              </div>

              {/* 相关链接 */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '24px', marginTop: '24px' }}>
                <div className="section-title" style={{ fontSize: '14px', marginBottom: '16px' }}>相关链接</div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <a
                    href="https://github.com/Alleyf/CommandHub"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-md ghost"
                    style={{ justifyContent: 'flex-start', gap: '12px' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 500 }}>GitHub 仓库</div>
                      <div style={{ fontSize: '12px', opacity: 0.6 }}>查看源码、文档和更新日志</div>
                    </div>
                  </a>

                  <a
                    href="https://github.com/Alleyf/CommandHub/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-md ghost"
                    style={{ justifyContent: 'flex-start', gap: '12px' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57v-2.234c-3.338.735-4.037-1.416-4.037-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.565 21.795 24 17.31 24 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 500 }}>问题反馈</div>
                      <div style={{ fontSize: '12px', opacity: 0.6 }}>报告 Bug 或提交功能建议</div>
                    </div>
                  </a>

                  <a
                    href="https://github.com/Alleyf"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-md ghost"
                    style={{ justifyContent: 'flex-start', gap: '12px' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57v-2.234c-3.338.735-4.037-1.416-4.037-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.565 21.795 24 17.31 24 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 500 }}>作者 GitHub</div>
                      <div style={{ fontSize: '12px', opacity: 0.6 }}>关注作者更多项目</div>
                    </div>
                  </a>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {onboardingOpen && (
        <div className="onboarding-backdrop">
          {onboardingTargetRect && (
            <div
              className="onboarding-target-frame"
              aria-hidden="true"
              style={{
                top: `${onboardingTargetRect.top}px`,
                left: `${onboardingTargetRect.left}px`,
                width: `${onboardingTargetRect.width}px`,
                height: `${onboardingTargetRect.height}px`
              }}
            />
          )}
          <section className="onboarding-dock card" role="dialog" aria-modal="true" aria-label={t("onboardingTitle")}>
            <div className="onboarding-head">
              <div>
                <div className="eyebrow">{t("onboardingTitle")}</div>
                <div className="onboarding-target-chip">{t("onboardingTargetLabel")}: {currentOnboardingStep.title}</div>
              </div>
              <button className="btn btn-sm ghost" onClick={completeOnboarding}>{t("onboardingSkip")}</button>
            </div>
            <div className="onboarding-copy compact-copy">
              <h3>{currentOnboardingStep.title}</h3>
              <p className="onboarding-body">{currentOnboardingStep.body}</p>
            </div>
            <div className="onboarding-progress">
              {onboardingSteps.map((step, index) => (
                <button
                  key={step.title}
                  className={`onboarding-dot ${index === onboardingStep ? "active" : ""}`}
                  onClick={() => setOnboardingStep(index)}
                  aria-label={step.title}
                />
              ))}
            </div>
            <div className="onboarding-actions compact-actions">
              <button className="btn btn-sm ghost" onClick={currentOnboardingStep.action}>
                {currentOnboardingStep.actionLabel}
              </button>
              <div className="onboarding-actions-right">
                <button className="btn btn-sm secondary" onClick={() => setOnboardingStep((current) => Math.max(0, current - 1))} disabled={onboardingStep === 0}>
                  {t("onboardingBack")}
                </button>
                <button
                  className="btn btn-sm teal"
                  onClick={() => {
                    if (onboardingStep >= onboardingSteps.length - 1) {
                      completeOnboarding();
                      return;
                    }
                    setOnboardingStep((current) => Math.min(onboardingSteps.length - 1, current + 1));
                  }}
                >
                  {onboardingStep >= onboardingSteps.length - 1 ? t("onboardingFinish") : t("onboardingNext")}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
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
          <div className="drawer-section">
            <div className="section-title">{t("commandStudio")}</div>
            <div className="drawer-grid">
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
                <label className="drawer-grid-full">
                  <span>{t("newGroupName")}</span>
                  <input value={form.group} placeholder={t("newGroupPlaceholder")} onChange={(event) => setForm({ ...form, group: event.target.value })} />
                </label>
              )}
              <label>
                <span>{t("accentTone")}</span>
                <SelectField value={form.accentTone || "teal"} options={accentOptions} onChange={(value) => setForm((current) => ({ ...current, accentTone: value }))} placeholder={t("accentTone")} />
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={Boolean(form.isFavorite)} onChange={(event) => setForm((current) => ({ ...current, isFavorite: event.target.checked }))} />
                <span>{t("favorite")}</span>
              </label>
            </div>
          </div>

          <div className="drawer-section">
            <div className="section-title">{t("command")}</div>
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
          </div>

          <div className="drawer-section">
            <div className="section-title">{t("environmentVariables")}</div>
            <label>
              <span>{t("environmentVariables")}</span>
              <textarea rows="8" value={form.envText} onChange={(event) => setForm({ ...form, envText: event.target.value })} placeholder={"OPENCLAW_TOKEN=abc\nPORT=8080"} />
            </label>
          </div>
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
        <pre ref={drawerLogViewRef} className="log-view drawer-log-view">{selected ? (logTail || t("noLogs")) : t("logsEmptySelect")}</pre>
      </aside>
      </div>
    </div>
  );
}

export default App;



