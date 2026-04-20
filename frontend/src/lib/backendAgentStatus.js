/** Aligns with backend Cursor agent status strings (uppercase, underscores). */
export function normalizeBackendAgentStatus(status) {
  if (status == null || status === "") return "";
  return String(status).trim().toUpperCase().replace(/\s+/g, "_");
}

export function isBackendAgentSuccessTerminal(status) {
  const u = normalizeBackendAgentStatus(status);
  if (!u) return false;
  return (
    u === "FINISHED" ||
    u === "COMPLETED" ||
    u === "COMPLETE" ||
    u === "SUCCEEDED" ||
    u === "SUCCESS" ||
    u === "DONE"
  );
}

export function isBackendAgentFailureTerminal(status) {
  const u = normalizeBackendAgentStatus(status);
  if (!u) return false;
  if (u === "FAILED" || u === "ERROR" || u === "CANCELLED" || u === "CANCELED")
    return true;
  return u.includes("FAIL");
}

/** True while we should poll the API for backend agent updates. */
export function isBackendAgentPollActive(status) {
  if (!status || String(status).trim() === "") return false;
  if (
    isBackendAgentSuccessTerminal(status) ||
    isBackendAgentFailureTerminal(status)
  ) {
    return false;
  }
  return true;
}

/** Migrate Frontend pipeline phases from GET /api/cursor/agents/:id → migrateFrontendPipeline.phase */
export function isMigrateFrontendPipelineTerminal(phase) {
  if (!phase || typeof phase !== "string") return false;
  return (
    phase === "completed" ||
    phase === "platform_failed" ||
    phase === "agent_failed"
  );
}
