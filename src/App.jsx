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

  const language = settings.language || "zh-CN";
  const copy = APP_MESSAGES[language] || APP_MESSAGES["zh-CN"];

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
                  <div className="inventory-actions">
                    <div className="section-copy right-copy">{t("listSummary")}</div>
                    <div className="toolbar-buttons">
                      <button className="btn btn-sm primary" onClick={openCreate}>{t("newCommand")}</button>
                      <button className="btn btn-sm ghost" onClick={openEdit} disabled={!selected}>{t("editSelected")}</button>
                      <button className="btn btn-sm danger" onClick={removeSelected} disabled={!selected}>{t("deleteSelected")}</button>
                    </div>
                  </div>
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
                <div className="pref-row">
                  <div className="pref-copy">
                    <div className="pref-title">{t("checkForUpdates")}</div>
                    <div className="pref-help">{updateStatus.message || t("settingsDesc")}</div>
                  </div>
                  <button className={`btn btn-md ${updateStatus.type === "error" ? "danger" : "ghost"}`} onClick={handleCheckForUpdates} disabled={updateStatus.checking}>
                    {updateStatus.checking ? t("checkingForUpdates") : t("checkForUpdates")}
                  </button>
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
        <pre ref={drawerLogViewRef} className="log-view drawer-log-view">{selected ? (logTail || t("noLogs")) : t("logsEmptySelect")}</pre>
      </aside>
      </div>
    </div>
  );
}

export default App;
