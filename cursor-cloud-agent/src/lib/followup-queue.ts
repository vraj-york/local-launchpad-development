import type initSqlJs from "sql.js";
import { getDb, persistDb } from "@/lib/session-store";
import type { CloudFollowupRequest } from "@/lib/cloud-agents-types";

type SqlValue = initSqlJs.SqlValue;
type Database = initSqlJs.Database;

export const MAX_FOLLOWUP_QUEUE_DEPTH = 50;

const mutexTails = new Map<string, Promise<unknown>>();

/** Serialize follow-up enqueue vs drain per agent (avoids double-start races). */
export async function withFollowupQueueLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
  const prev = mutexTails.get(agentId) ?? Promise.resolve();
  const result = prev.then(() => fn());
  mutexTails.set(
    agentId,
    result.then(
      () => {},
      () => {},
    ),
  );
  return result as Promise<T>;
}

function queryOne(conn: Database, sql: string, params: SqlValue[]): Record<string, SqlValue> | undefined {
  const stmt = conn.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) return stmt.getAsObject() as Record<string, SqlValue>;
    return undefined;
  } finally {
    stmt.free();
  }
}

export async function getFollowupQueueDepth(agentId: string): Promise<number> {
  const conn = await getDb();
  const row = queryOne(conn, "SELECT COUNT(*) AS c FROM followup_queue WHERE agent_id = ?", [agentId]);
  return Number(row?.c ?? 0);
}

export class FollowupQueueFullError extends Error {
  constructor() {
    super(`Follow-up queue is full (max ${MAX_FOLLOWUP_QUEUE_DEPTH})`);
    this.name = "FollowupQueueFullError";
  }
}

export async function enqueueFollowup(
  agentId: string,
  apiKeyFingerprint: string,
  userEmailNormalized: string,
  prompt: CloudFollowupRequest["prompt"],
): Promise<{ queuePosition: number }> {
  const depth = await getFollowupQueueDepth(agentId);
  if (depth >= MAX_FOLLOWUP_QUEUE_DEPTH) {
    throw new FollowupQueueFullError();
  }
  const conn = await getDb();
  const now = Date.now();
  const promptJson = JSON.stringify(prompt);
  conn.run(
    "INSERT INTO followup_queue (agent_id, api_key_fingerprint, user_email_normalized, prompt_json, created_at) VALUES (?, ?, ?, ?, ?)",
    [agentId, apiKeyFingerprint, userEmailNormalized, promptJson, now],
  );
  persistDb();
  const newDepth = await getFollowupQueueDepth(agentId);
  return { queuePosition: newDepth };
}

export interface PoppedFollowup {
  apiKeyFingerprint: string;
  userEmailNormalized: string;
  prompt: CloudFollowupRequest["prompt"];
}

export async function popFollowupQueue(agentId: string): Promise<PoppedFollowup | null> {
  const conn = await getDb();
  const first = queryOne(
    conn,
    "SELECT id, api_key_fingerprint, user_email_normalized, prompt_json FROM followup_queue WHERE agent_id = ? ORDER BY id ASC LIMIT 1",
    [agentId],
  );
  if (!first) return null;

  let prompt: CloudFollowupRequest["prompt"];
  try {
    prompt = JSON.parse(first.prompt_json as string) as CloudFollowupRequest["prompt"];
  } catch {
    const rowId = first.id as number;
    conn.run("DELETE FROM followup_queue WHERE id = ?", [rowId]);
    persistDb();
    return null;
  }

  const rowId = first.id as number;
  conn.run("DELETE FROM followup_queue WHERE id = ?", [rowId]);
  persistDb();

  const emailRaw = first.user_email_normalized as string | null | undefined;
  const userEmailNormalized = emailRaw?.trim() || "";

  return {
    apiKeyFingerprint: first.api_key_fingerprint as string,
    userEmailNormalized,
    prompt,
  };
}

/** After `markCloudAgentFinished`, pop at most one queued follow-up and start it (non-awaited). */
export async function drainFollowupQueueAfterRun(agentId: string): Promise<void> {
  await withFollowupQueueLock(agentId, async () => {
    const next = await popFollowupQueue(agentId);
    if (!next) return;
    const { followupAgentInBackground } = await import("@/lib/cloud-agent-launcher");
    void followupAgentInBackground({
      id: agentId,
      apiKeyFingerprint: next.apiKeyFingerprint,
      userEmailNormalized: next.userEmailNormalized,
      prompt: next.prompt,
    });
  });
}
