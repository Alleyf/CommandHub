import { useState, useMemo } from "react";

const COMMON_PORT_PRESETS = [
  { name: "Common Web", range: "80,443,8080,8443" },
  { name: "Database", range: "3306,5432,6379,27017,1433,1521" },
  { name: "Remote Access", range: "22,3389,5900" },
  { name: "Mail", range: "25,110,143,465,587,993,995" },
  { name: "Dev Tools", range: "3000,5173,8000,8080,9000" },
  { name: "1-1000", range: "1-1000" },
  { name: "1-10000", range: "1-10000" }
];

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function PortScanner({ t, onMessage }) {
  const [host, setHost] = useState("127.0.0.1");
  const [portRange, setPortRange] = useState("1-1000");
  const [timeout, setTimeout] = useState(1000);
  const [concurrentLimit, setConcurrentLimit] = useState(50);
  const [scanning, setScanning] = useState(false);
  const [releasingPort, setReleasingPort] = useState(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const openPorts = useMemo(() => {
    return result?.results?.filter((r) => r.open) || [];
  }, [result]);

  const closedPorts = useMemo(() => {
    return result?.results?.filter((r) => !r.open) || [];
  }, [result]);

  async function startScan() {
    if (!host || !portRange) {
      onMessage?.(t("portScannerErrorRequired"), "error");
      return;
    }

    setScanning(true);
    setProgress(0);
    setResult(null);

    try {
      const scanResult = await window.commandHub.scanPorts({
        host,
        portRange,
        timeout: Number(timeout) || 1000,
        concurrentLimit: Number(concurrentLimit) || 50
      });

      setResult(scanResult);
      setProgress(100);
      onMessage?.(t("portScannerScanDone", { count: scanResult.openCount }), "success");
    } catch (error) {
      onMessage?.(t("portScannerScanFailed", { error: error.message || String(error) }), "error");
    } finally {
      setScanning(false);
    }
  }

  async function releasePort(port, pid) {
    setReleasingPort(port);
    try {
      const result = await window.commandHub.releasePort({ port });
      if (result.success) {
        onMessage?.(t("portScannerPortReleased", { port, process: result.processName, pid: result.pid }), "success");
        // 重新扫描
        await startScan();
      } else {
        onMessage?.(t("portScannerReleaseFailed", { message: result.message }), "error");
      }
    } catch (error) {
      onMessage?.(t("portScannerReleaseFailed", { message: error.message || String(error) }), "error");
    } finally {
      setReleasingPort(null);
    }
  }

  function applyPreset(range) {
    setPortRange(range);
  }

  return (
    <div className="port-scanner-container">
      <section className="card refined-panel productivity-block wide-block">
        <div className="block-head">
          <div>
            <div className="section-title">{t("portScanner")}</div>
            <div className="section-copy">{t("portScannerDesc")}</div>
          </div>
          <button
            className="btn btn-sm teal"
            onClick={startScan}
            disabled={scanning}
          >
            {scanning ? t("portScannerScanning") : t("portScannerScan")}
          </button>
        </div>

        <div className="port-scanner-form">
          <div className="form-row">
            <label className="field-shell">
              <span className="field-label">{t("portScannerHost")}</span>
              <input
                className="field-input"
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder={t("portScannerHostPlaceholder")}
                disabled={scanning}
              />
            </label>
            <label className="field-shell">
              <span className="field-label">{t("portScannerRange")}</span>
              <input
                className="field-input"
                type="text"
                value={portRange}
                onChange={(e) => setPortRange(e.target.value)}
                placeholder={t("portScannerRangePlaceholder")}
                disabled={scanning}
              />
            </label>
          </div>

          <div className="form-row">
            <label className="field-shell">
              <span className="field-label">{t("portScannerTimeout")}</span>
              <input
                className="field-input"
                type="number"
                min="100"
                max="10000"
                step="100"
                value={timeout}
                onChange={(e) => setTimeout(e.target.value)}
                disabled={scanning}
              />
            </label>
            <label className="field-shell">
              <span className="field-label">{t("portScannerConcurrent")}</span>
              <input
                className="field-input"
                type="number"
                min="10"
                max="200"
                step="10"
                value={concurrentLimit}
                onChange={(e) => setConcurrentLimit(e.target.value)}
                disabled={scanning}
              />
            </label>
          </div>

          <div className="port-scanner-presets">
            <span className="field-label">{t("portScannerQuickSelect")}:</span>
            <div className="preset-buttons">
              {COMMON_PORT_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  className="btn btn-sm ghost"
                  onClick={() => applyPreset(preset.range)}
                  disabled={scanning}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {scanning && (
          <div className="scan-activity">
            <div className="scan-activity-head">
              <div>
                <div className="field-label">{t("scanRunning")}</div>
                <div className="field-helper">{t("portScannerScanning")}</div>
              </div>
              <div className="scan-activity-progress">{progress}%</div>
            </div>
            <div className="scan-progress-track">
              <div className="scan-progress-bar" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {result && (
          <>
            <div className="summary-grid four-col">
              <div className="summary-card">
                <span>{t("portScannerTotalPorts")}</span>
                <strong>{result.totalPorts}</strong>
                <small>{t("scannedFiles")}</small>
              </div>
              <div className="summary-card">
                <span>{t("portScannerOpenPorts")}</span>
                <strong className="open-count">{result.openCount}</strong>
                <small>{t("portScannerOpen")}</small>
              </div>
              <div className="summary-card">
                <span>{t("portScannerClosedPorts")}</span>
                <strong>{result.closedCount}</strong>
                <small>{t("portScannerClosed")}</small>
              </div>
              <div className="summary-card">
                <span>{t("portScannerDuration")}</span>
                <strong>{formatDuration(result.duration)}</strong>
                <small>{result.host}</small>
              </div>
            </div>

            {openPorts.length > 0 && (
              <div className="standard-list-card">
                <div className="field-label">{t("portScannerOpenPorts")}</div>
                <div className="standard-list port-list">
                  {openPorts.map((port) => (
                    <div key={port.port} className="result-row action-row port-row open">
                      <div className="result-row-main">
                        <div className="result-row-title">
                          <span className="port-number">{port.port}</span>
                          {port.service && <span className="port-service">{port.service}</span>}
                        </div>
                        <div className="result-row-sub">
                          {port.processName ? `${port.processName} (PID: ${port.pid})` : t("portScannerOpen")}
                        </div>
                      </div>
                      <div className="result-row-side">
                        <span className="port-state-badge open">{t("portScannerOpen")}</span>
                        {port.pid && (
                          <button
                            className="btn btn-sm red"
                            onClick={() => releasePort(port.port, port.pid)}
                            disabled={releasingPort === port.port}
                            style={{ marginLeft: "8px" }}
                          >
                            {releasingPort === port.port ? t("portScannerReleasing") : t("portScannerRelease")}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {openPorts.length === 0 && (
              <div className="empty slim-empty">
                {t("portScannerNoOpenPorts")}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
