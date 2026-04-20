import type { ChildProcess } from "child_process";

const children = new Map<string, ChildProcess>();

/**
 * Track the active `agent` CLI child for a cloud agent id so POST /v0/agents/:id/stop can SIGTERM it.
 * Replaces any previous registration for the same id.
 */
export function registerCloudAgentChild(agentId: string, child: ChildProcess): void {
  const id = agentId.trim();
  if (!id) return;
  const prev = children.get(id);
  if (prev && prev !== child) {
    try {
      if (!prev.killed) prev.kill("SIGTERM");
    } catch {
      /* already dead */
    }
  }
  children.set(id, child);
  const cleanup = (): void => {
    if (children.get(id) === child) children.delete(id);
  };
  child.once("close", cleanup);
  child.once("error", cleanup);
}

/** Send SIGTERM to the registered child, if any. */
export function killRegisteredCloudAgentChild(agentId: string): boolean {
  const id = agentId.trim();
  const child = children.get(id);
  if (!child || child.killed) return false;
  try {
    child.kill("SIGTERM");
    return true;
  } catch {
    return false;
  }
}
