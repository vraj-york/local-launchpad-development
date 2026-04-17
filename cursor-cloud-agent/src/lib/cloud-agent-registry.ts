const runningAgents = new Set<string>();

export function markCloudAgentRunning(id: string): void {
  runningAgents.add(id);
}

export function markCloudAgentFinished(id: string): void {
  runningAgents.delete(id);
}

export function isCloudAgentRunning(id: string): boolean {
  return runningAgents.has(id);
}
