import { useState } from "react";

const DEFAULT_OPTIONS = {
  fps: 30,
  width: 1920,
  quality: 30,
  startTime: 0,
  duration: ""
};

export function VideoToGif({ t, onMessage }) {
  const [inputFile, setInputFile] = useState("");
  const [outputFile, setOutputFile] = useState("");
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState(0);

  const handlePickVideo = async () => {
    const path = await window.commandHub.pickVideoFile();
    if (path) {
      setInputFile(path);
      if (!outputFile) {
        const ext = path.lastIndexOf(".");
        const base = ext > 0 ? path.substring(0, ext) : path;
        setOutputFile(`${base}.gif`);
      }
    }
  };

  const handlePickOutput = async () => {
    const path = await window.commandHub.pickGifSavePath();
    if (path) {
      setOutputFile(path);
    }
  };

  const handleOpenFolder = async () => {
    if (outputFile) {
      const folderPath = outputFile.substring(0, outputFile.lastIndexOf("\\")) || outputFile.substring(0, outputFile.lastIndexOf("/"));
      if (folderPath) {
        await window.commandHub.openPath(folderPath);
      }
    }
  };

  const handleConvert = async () => {
    if (!inputFile || !outputFile) {
      onMessage?.(t("videoToGifErrorRequired"));
      return;
    }

    setConverting(true);
    setProgress(0);

    // 模拟进度
    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 5, 90));
    }, 500);

    try {
      const result = await window.commandHub.convertVideoToGif({
        inputPath: inputFile,
        outputPath: outputFile,
        fps: options.fps,
        width: options.width,
        quality: options.quality,
        startTime: options.startTime,
        duration: options.duration || null
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (result?.success) {
        onMessage?.(t("videoToGifSuccess"), "success");
      }
    } catch (error) {
      clearInterval(progressInterval);
      onMessage?.(error.message || t("videoToGifError"), "error");
    } finally {
      setConverting(false);
      setTimeout(() => setProgress(0), 1500);
    }
  };

  return (
    <section className="card refined-panel productivity-block wide-block">
      <div className="block-head">
        <div>
          <div className="section-title">{t("videoToGif")}</div>
          <div className="section-copy">{t("videoToGifDesc")}</div>
        </div>
      </div>

      <div className="tool-content">
        <div className="field-stack">
          <label className="field-shell">
            <span className="field-label">{t("videoToGifInput")}</span>
            <div className="file-input-group">
              <input
                type="text"
                className="field-input"
                value={inputFile}
                onChange={(e) => setInputFile(e.target.value)}
                placeholder="C:/path/to/video.mp4"
              />
            </div>
          </label>
          <button
            type="button"
            className="btn btn-sm ghost"
            onClick={handlePickVideo}
            style={{ marginTop: "-8px" }}
          >
            {t("browseFile")}
          </button>

          <label className="field-shell">
            <span className="field-label">{t("videoToGifOutput")}</span>
            <div className="file-input-group">
              <input
                type="text"
                className="field-input"
                value={outputFile}
                onChange={(e) => setOutputFile(e.target.value)}
                placeholder="C:/path/to/output.gif"
              />
            </div>
          </label>
          <button
            type="button"
            className="btn btn-sm ghost"
            onClick={handlePickOutput}
            style={{ marginTop: "-8px" }}
          >
            {t("browseFile")}
          </button>
        </div>

        <div className="options-grid three-col">
          <label className="field-shell">
            <span className="field-label">{t("videoToGifFps")}</span>
            <input
              type="number"
              className="field-input"
              value={options.fps}
              onChange={(e) => setOptions({ ...options, fps: Number(e.target.value) })}
              min="1"
              max="30"
            />
          </label>

          <label className="field-shell">
            <span className="field-label">{t("videoToGifWidth")}</span>
            <input
              type="number"
              className="field-input"
              value={options.width}
              onChange={(e) => setOptions({ ...options, width: Number(e.target.value) })}
              min="100"
              max="1920"
            />
          </label>

          <label className="field-shell">
            <span className="field-label">{t("videoToGifQuality")}</span>
            <input
              type="number"
              className="field-input"
              value={options.quality}
              onChange={(e) => setOptions({ ...options, quality: Number(e.target.value) })}
              min="1"
              max="31"
            />
          </label>

          <label className="field-shell">
            <span className="field-label">{t("videoToGifStartTime")}</span>
            <input
              type="number"
              className="field-input"
              value={options.startTime}
              onChange={(e) => setOptions({ ...options, startTime: Number(e.target.value) })}
              min="0"
            />
          </label>

          <label className="field-shell">
            <span className="field-label">{t("videoToGifDuration")}</span>
            <input
              type="number"
              className="field-input"
              value={options.duration}
              onChange={(e) => setOptions({ ...options, duration: e.target.value })}
              min="1"
              placeholder={t("videoToGifDurationPlaceholder")}
            />
          </label>

          <label className="field-shell" style={{ visibility: "hidden" }}>
            <span className="field-label">&nbsp;</span>
          </label>
        </div>

        {converting && (
          <div className="conversion-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="progress-text">{progress}%</span>
          </div>
        )}

        <div className="action-row">
          <button
            className="btn btn-secondary"
            onClick={handleOpenFolder}
            disabled={!outputFile || converting}
            style={{ marginRight: "8px" }}
          >
            {t("openFolder")}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleConvert}
            disabled={converting || !inputFile || !outputFile}
          >
            {converting ? t("videoToGifConverting") : t("videoToGifConvert")}
          </button>
        </div>
      </div>
    </section>
  );
}
