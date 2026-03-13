const { listMatchedSystemProcesses } = require("./system-processes");

process.on("message", (message) => {
  if (!message || message.type !== "scan") return;

  try {
    const items = listMatchedSystemProcesses(message.commands || [], message.statuses || {});
    if (process.send) {
      process.send({
        type: "scan-result",
        requestId: message.requestId,
        items
      });
    }
  } catch (error) {
    if (process.send) {
      process.send({
        type: "scan-error",
        requestId: message.requestId,
        error: String(error.message || error)
      });
    }
  }
});
