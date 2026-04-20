/** Set when POST /v0/agents/:id/stop is called; launcher checks before/after spawn and in catch. */
const stopRequested = new Set<string>();

export function requestCloudAgentStop(agentId: string): void {
  const id = agentId.trim();
  if (id) stopRequested.add(id);
}

export function isCloudAgentStopRequested(agentId: string): boolean {
  return stopRequested.has(agentId.trim());
}

export function clearCloudAgentStopRequest(agentId: string): void {
  stopRequested.delete(agentId.trim());
}
