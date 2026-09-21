const MAX_EVENTS = 250;
const DIAGNOSTIC_LOGS = [];

function recordDiagnostic(event = {}) {
  DIAGNOSTIC_LOGS.push({
    timestamp: new Date().toISOString(),
    type: String(event.type || "info"),
    scope: String(event.scope || "system"),
    taskType: String(event.taskType || ""),
    validationState: String(event.validationState || ""),
    fallbackUsed: Boolean(event.fallbackUsed),
    note: String(event.note || "").slice(0, 500),
    details: event.details && typeof event.details === "object" ? event.details : {}
  });

  if (DIAGNOSTIC_LOGS.length > MAX_EVENTS) {
    DIAGNOSTIC_LOGS.splice(0, DIAGNOSTIC_LOGS.length - MAX_EVENTS);
  }
}

function listDiagnostics(limit = 80) {
  const safeLimit = Math.max(1, Math.min(Number(limit || 80), MAX_EVENTS));
  return DIAGNOSTIC_LOGS.slice(-safeLimit).reverse();
}

module.exports = {
  listDiagnostics,
  recordDiagnostic
};
