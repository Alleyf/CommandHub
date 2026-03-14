import { useEffect, useMemo, useState } from "react";

const DUPLICATE_SCAN_PHASES = ["indexing", "comparing", "ranking"];
const STALE_SCAN_PHASES = ["indexing", "aging", "prioritizing"];

function formatBytes(value) {
  const size = Number(value || 0);
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  const amount = size / (1024 ** index);
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatDuration(value) {
  const ms = Number(value || 0);
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function splitLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(items) {
  return (Array.isArray(items) ? items : []).join("\n");
}

function percent(value, total) {
  if (!value || !total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function safeLabel(text, fallback = "--") {
  const value = String(text || "").trim();
  if (!value) return fallback;
  if (value.includes("�")) return fallback;
  return value;
}

function ScanActivity({ busy, progress, phase, phases, t }) {
  if (!busy) return null;
  return (
    <div className="scan-activity">
      <div className="scan-activity-head">
        <div>
          <div className="field-label">{t("scanRunning")}</div>
          <div className="field-helper">{t(`scanPhase_${phase}`)}</div>
        </div>
        <div className="scan-activity-progress">{progress}%</div>
      </div>
      <div className="scan-progress-track"><div className="scan-progress-bar" style={{ width: `${progress}%` }} /></div>
      <div className="scan-phase-row">
        {phases.map((item) => (
          <span key={item} className={`scan-phase-pill ${item === phase ? "active" : ""}`}>{t(`scanPhase_${item}`)}</span>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, meta }) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </div>
  );
}

function UsageRow({ item, totalMs }) {
  const label = safeLabel(item.label, safeLabel(item.appName, "--"));
  const detail = safeLabel(item.website || item.windowTitle || item.appName, label);
  return (
    <div className="result-row">
      <div className="result-row-main">
        <div className="result-row-title">{label}</div>
        <div className="result-row-sub">{detail}</div>
      </div>
      <div className="result-row-side">
        <strong>{formatDuration(item.durationMs)}</strong>
        <span>{percent(item.durationMs, totalMs)}</span>
      </div>
    </div>
  );
}

function DuplicateRow({ group, t, onDelete }) {
  const duplicateFiles = group.files.filter((item) => item.path !== group.keepPath);
  const wastedBytes = duplicateFiles.reduce((sum, item) => sum + Number(item.size || 0), 0);
  return (
    <div className="action-card compact-card">
      <div className="action-card-head">
        <div>
          <div className="result-row-title">{group.files[0]?.name}</div>
          <div className="result-row-sub">{duplicateFiles.length} {t("duplicateCandidates")} · {formatBytes(wastedBytes)}</div>
        </div>
        <button className="btn btn-sm teal" onClick={() => onDelete(group)}>{t("deleteDuplicates")}</button>
      </div>
      <div className="action-card-note">{t("keepFile")}: {group.keepPath}</div>
    </div>
  );
}

function StaleRow({ item, t, onArchive, onDelete }) {
  return (
    <div className="result-row action-row">
      <div className="result-row-main">
        <div className="result-row-title">{item.name}</div>
        <div className="result-row-sub clamp-2">{item.path}</div>
      </div>
      <div className="result-row-side">
        <strong>{item.ageDays}d</strong>
        <span>{formatBytes(item.size)}</span>
      </div>
      <div className="row-actions">
        <button className="btn btn-sm ghost" onClick={() => onArchive(item)}>{t("archiveOne")}</button>
        <button className="btn btn-sm secondary" onClick={() => onDelete(item)}>{t("deleteOne")}</button>
      </div>
    </div>
  );
}

export default function ProductivityHub({ active, t, onToast }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState({ duplicates: false, stale: false });
  const [duplicateRootsText, setDuplicateRootsText] = useState("");
  const [duplicateStrategy, setDuplicateStrategy] = useState("hash");
  const [duplicateResult, setDuplicateResult] = useState(null);
  const [staleRootsText, setStaleRootsText] = useState("");
  const [staleDays, setStaleDays] = useState(30);
  const [archiveDir, setArchiveDir] = useState("");
  const [staleResult, setStaleResult] = useState(null);
  const [duplicateProgress, setDuplicateProgress] = useState(0);
  const [staleProgress, setStaleProgress] = useState(0);
  const [duplicatePhaseIndex, setDuplicatePhaseIndex] = useState(0);
  const [stalePhaseIndex, setStalePhaseIndex] = useState(0);

  async function loadOverview() {
    setLoading(true);
    try {
      const result = await window.commandHub.getProductivityOverview();
      setOverview(result);
      setDuplicateRootsText(joinLines(result?.duplicateCleaner?.roots || []));
      setDuplicateStrategy(result?.duplicateCleaner?.strategy || "hash");
      setStaleRootsText(joinLines(result?.fileExpiry?.roots || []));
      setStaleDays(Number(result?.fileExpiry?.staleDays || 30));
      setArchiveDir(result?.fileExpiry?.archiveDir || "");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (active) loadOverview();
  }, [active]);

  useEffect(() => {
    if (!busy.duplicates) {
      setDuplicateProgress(0);
      setDuplicatePhaseIndex(0);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setDuplicateProgress((current) => Math.min(92, current + 9));
      setDuplicatePhaseIndex((current) => (current + 1) % DUPLICATE_SCAN_PHASES.length);
    }, 420);
    return () => window.clearInterval(timer);
  }, [busy.duplicates]);

  useEffect(() => {
    if (!busy.stale) {
      setStaleProgress(0);
      setStalePhaseIndex(0);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setStaleProgress((current) => Math.min(92, current + 10));
      setStalePhaseIndex((current) => (current + 1) % STALE_SCAN_PHASES.length);
    }, 420);
    return () => window.clearInterval(timer);
  }, [busy.stale]);

  const todayItems = overview?.screenUsage?.today?.items || [];
  const weekItems = overview?.screenUsage?.week?.items || [];
  const todayTotalMs = overview?.screenUsage?.today?.totalMs || 0;
  const weekTotalMs = overview?.screenUsage?.week?.totalMs || 0;

  const duplicatePriority = useMemo(() => {
    const groups = duplicateResult?.groups || [];
    return [...groups]
      .map((group) => ({
        ...group,
        wastedBytes: group.files.filter((item) => item.path !== group.keepPath).reduce((sum, item) => sum + Number(item.size || 0), 0)
      }))
      .sort((left, right) => right.wastedBytes - left.wastedBytes)
      .slice(0, 8);
  }, [duplicateResult]);

  const stalePriority = useMemo(() => {
    const items = staleResult?.items || [];
    return [...items]
      .sort((left, right) => (right.ageDays * Math.max(1, right.size || 0)) - (left.ageDays * Math.max(1, left.size || 0)))
      .slice(0, 12);
  }, [staleResult]);

  async function appendFolder(setter, currentText) {
    const picked = await window.commandHub.pickDirectory();
    if (!picked) return;
    const next = splitLines(currentText);
    if (!next.includes(picked)) next.push(picked);
    setter(next.join("\n"));
  }

  async function saveFileExpirySettings() {
    await window.commandHub.saveProductivitySettings({
      fileExpiry: {
        roots: splitLines(staleRootsText),
        staleDays: Number(staleDays || 30),
        archiveDir
      }
    });
  }

  async function runDuplicateScan() {
    setBusy((current) => ({ ...current, duplicates: true }));
    try {
      const result = await window.commandHub.scanDuplicateFiles({ roots: splitLines(duplicateRootsText), strategy: duplicateStrategy });
      setDuplicateProgress(100);
      setDuplicateResult(result);
      onToast?.(t("duplicatesScanDone", { count: result?.summary?.groupCount || 0 }), "success");
      await loadOverview();
    } catch (error) {
      onToast?.(t("actionFailed", { error: error.message || String(error) }), "error");
    } finally {
      window.setTimeout(() => setBusy((current) => ({ ...current, duplicates: false })), 240);
    }
  }

  async function runStaleScan() {
    setBusy((current) => ({ ...current, stale: true }));
    try {
      await saveFileExpirySettings();
      const result = await window.commandHub.scanStaleFiles({ roots: splitLines(staleRootsText), staleDays: Number(staleDays || 30), archiveDir });
      setStaleProgress(100);
      setStaleResult(result);
      onToast?.(t("staleScanDone", { count: result?.summary?.staleFileCount || 0 }), "success");
      await loadOverview();
    } catch (error) {
      onToast?.(t("actionFailed", { error: error.message || String(error) }), "error");
    } finally {
      window.setTimeout(() => setBusy((current) => ({ ...current, stale: false })), 240);
    }
  }

  async function deleteDuplicateGroup(group) {
    const paths = (group?.files || []).filter((item) => item.path !== group.keepPath).map((item) => item.path);
    if (!paths.length) return;
    await window.commandHub.deleteFiles({ paths });
    onToast?.(t("duplicatesDeleteDone", { count: paths.length }), "success");
    await runDuplicateScan();
  }

  async function archiveStaleItem(item) {
    if (!archiveDir) {
      onToast?.(t("archiveDirRequired"), "error");
      return;
    }
    await window.commandHub.archiveFiles({ paths: [item.path], archiveDir });
    onToast?.(t("archiveDone", { count: 1 }), "success");
    await runStaleScan();
  }

  async function deleteStaleItem(item) {
    await window.commandHub.deleteFiles({ paths: [item.path] });
    onToast?.(t("deleteFilesDone", { count: 1 }), "success");
    await runStaleScan();
  }

  return (
    <section className="single-panel productivity-shell refined-productivity-shell">
      <section className="productivity-header card refined-panel">
        <div>
          <div className="eyebrow">{t("productivityCenter")}</div>
          <h2>{t("productivityTitle")}</h2>
          <p className="section-copy">{t("productivityDesc")}</p>
        </div>
        <div className="summary-grid three-col">
          <SummaryCard label={t("screenUsageToday")} value={formatDuration(todayTotalMs)} meta={safeLabel(todayItems[0]?.label, t("screenUsageHint"))} />
          <SummaryCard label={t("weekTopApps")} value={safeLabel(weekItems[0]?.label, "--")} meta={weekItems[0] ? formatDuration(weekItems[0].durationMs) : t("screenUsageEmpty")} />
          <SummaryCard label={t("websitesTracked")} value={String(todayItems.filter((item) => item.website).length)} meta={`${t("lastUpdatedAt")}: ${formatDate(overview?.screenUsage?.updatedAt)}`} />
        </div>
      </section>

      <div className="refined-productivity-grid">
        <section className="card refined-panel productivity-block">
          <div className="block-head">
            <div>
              <div className="section-title">{t("screenUsage")}</div>
              <div className="section-copy">{t("screenUsagePanelDesc")}</div>
            </div>
            <button className="btn btn-sm ghost" onClick={loadOverview} disabled={loading}>{loading ? t("scanRunning") : t("refresh")}</button>
          </div>
          <div className="summary-grid">
            <SummaryCard label={t("todayTopApps")} value={safeLabel(todayItems[0]?.label, "--")} meta={todayItems[0] ? `${formatDuration(todayItems[0].durationMs)} · ${percent(todayItems[0].durationMs, todayTotalMs)}` : t("screenUsageEmpty")} />
            <SummaryCard label={t("weekTopApps")} value={safeLabel(weekItems[0]?.label, "--")} meta={weekItems[0] ? `${formatDuration(weekItems[0].durationMs)} · ${percent(weekItems[0].durationMs, weekTotalMs)}` : t("screenUsageEmpty")} />
          </div>
          <div className="standard-list-card">
            <div className="field-label">{t("todayTopApps")}</div>
            <div className="standard-list">
              {todayItems.length ? todayItems.slice(0, 6).map((item) => <UsageRow key={item.id} item={item} totalMs={todayTotalMs} />) : <div className="empty slim-empty">{t("screenUsageEmpty")}</div>}
            </div>
          </div>
        </section>

        <section className="card refined-panel productivity-block">
          <div className="block-head">
            <div>
              <div className="section-title">{t("duplicateCleaner")}</div>
              <div className="section-copy">{t("duplicateCleanerDesc")}</div>
            </div>
            <button className="btn btn-sm teal" onClick={runDuplicateScan} disabled={busy.duplicates}>{busy.duplicates ? t("scanRunning") : t("scanDuplicates")}</button>
          </div>
          <div className="field-stack">
            <label className="field-shell">
              <span className="field-label">{t("scanFolders")}</span>
              <textarea className="field-input field-textarea" rows="4" value={duplicateRootsText} onChange={(event) => setDuplicateRootsText(event.target.value)} />
            </label>
            <div className="inline-field-row">
              <button className="btn btn-sm ghost" onClick={() => appendFolder(setDuplicateRootsText, duplicateRootsText)}>{t("browseFolder")}</button>
              <select className="field-input select-input" value={duplicateStrategy} onChange={(event) => setDuplicateStrategy(event.target.value)}>
                <option value="hash">{t("duplicateStrategyHash")}</option>
                <option value="name">{t("duplicateStrategyName")}</option>
                <option value="size">{t("duplicateStrategySize")}</option>
              </select>
            </div>
          </div>
          <ScanActivity busy={busy.duplicates} progress={duplicateProgress} phase={DUPLICATE_SCAN_PHASES[duplicatePhaseIndex]} phases={DUPLICATE_SCAN_PHASES} t={t} />
          <div className="summary-grid three-col">
            <SummaryCard label={t("duplicateGroups")} value={String(duplicateResult?.summary?.groupCount || 0)} meta={t("scanFolders")} />
            <SummaryCard label={t("reclaimableSpace")} value={formatBytes(duplicateResult?.summary?.wastedBytes || 0)} meta={t("duplicateWasteHint")} />
            <SummaryCard label={t("scannedFiles")} value={String(duplicateResult?.scannedFileCount || 0)} meta={t("lastUpdatedAt")} />
          </div>
          <div className="standard-list-card">
            <div className="field-label">{t("duplicateGroups")}</div>
            <div className="standard-list">
              {duplicatePriority.length ? duplicatePriority.map((group) => <DuplicateRow key={group.id} group={group} t={t} onDelete={deleteDuplicateGroup} />) : <div className="empty slim-empty">{t("duplicatesEmpty")}</div>}
            </div>
          </div>
        </section>

        <section className="card refined-panel productivity-block wide-block">
          <div className="block-head">
            <div>
              <div className="section-title">{t("fileExpiryAssistant")}</div>
              <div className="section-copy">{t("fileExpiryDesc")}</div>
            </div>
            <button className="btn btn-sm teal" onClick={runStaleScan} disabled={busy.stale}>{busy.stale ? t("scanRunning") : t("scanStaleFiles")}</button>
          </div>
          <div className="stale-form-grid">
            <label className="field-shell field-span-2">
              <span className="field-label">{t("monitorFolders")}</span>
              <textarea className="field-input field-textarea" rows="4" value={staleRootsText} onChange={(event) => setStaleRootsText(event.target.value)} />
            </label>
            <label className="field-shell">
              <span className="field-label">{t("staleDays")}</span>
              <input className="field-input" type="number" min="1" value={staleDays} onChange={(event) => setStaleDays(event.target.value)} />
            </label>
            <label className="field-shell">
              <span className="field-label">{t("archiveFolder")}</span>
              <input className="field-input" value={archiveDir} onChange={(event) => setArchiveDir(event.target.value)} />
            </label>
          </div>
          <div className="inline-field-row">
            <button className="btn btn-sm ghost" onClick={() => appendFolder(setStaleRootsText, staleRootsText)}>{t("browseFolder")}</button>
            <button className="btn btn-sm ghost" onClick={saveFileExpirySettings}>{t("saveSettings")}</button>
          </div>
          <ScanActivity busy={busy.stale} progress={staleProgress} phase={STALE_SCAN_PHASES[stalePhaseIndex]} phases={STALE_SCAN_PHASES} t={t} />
          <div className="summary-grid four-col">
            <SummaryCard label={t("staleFileCount")} value={String(staleResult?.summary?.staleFileCount || 0)} meta={t("staleFilesHint")} />
            <SummaryCard label={t("reclaimableSpace")} value={formatBytes(staleResult?.summary?.reclaimableBytes || 0)} meta={t("fileExpiryAssistant")} />
            <SummaryCard label={t("staleDays")} value={String(staleDays)} meta={t("monitorFolders")} />
            <SummaryCard label={t("lastScanAt")} value={formatDate(overview?.fileExpiry?.lastScanAt)} meta={t("lastUpdatedAt")} />
          </div>
          <div className="standard-list-card">
            <div className="field-label">{t("staleQueueTitle")}</div>
            <div className="standard-list">
              {stalePriority.length ? stalePriority.map((item) => <StaleRow key={item.path} item={item} t={t} onArchive={archiveStaleItem} onDelete={deleteStaleItem} />) : <div className="empty slim-empty">{t("staleFilesEmpty")}</div>}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
