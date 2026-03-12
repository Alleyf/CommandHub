export const EMPTY_FORM = {
  id: "",
  name: "",
  command: "",
  args: "",
  cwd: "",
  envText: "",
  group: ""
};

export const NEW_GROUP_VALUE = "__new_group__";

export function nowIso() {
  return new Date().toISOString();
}

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function format(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

export function stripAnsiSequences(text) {
  return String(text || "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\u0000/g, "");
}

export function filePathFromHandle(file) {
  if (!file) return "";
  return window.commandHub?.getPathForFile?.(file) || file.path || "";
}

export function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function uptime(startedAt) {
  if (!startedAt) return "--";
  const delta = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(delta / 3600);
  const minutes = Math.floor((delta % 3600) / 60);
  const seconds = delta % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function toEnvMap(text) {
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

export function fromCommand(command) {
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
