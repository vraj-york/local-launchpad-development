import type initSqlJs from "sql.js";
import { getDb, persistDb } from "@/lib/session-store";
import { decryptApiKey } from "@/lib/cloud-api-key-crypto";
import type {
  CloudAgentListItem,
  CloudAgentListResponse,
  CloudConversationMessage,
  CloudLaunchRequest,
} from "@/lib/cloud-agents-types";
import { normalizeUserEmail } from "@/lib/user-email";

type SqlValue = initSqlJs.SqlValue;
type Database = initSqlJs.Database;

function queryAll(conn: Database, sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
  const stmt = conn.prepare(sql);
  try {
    stmt.bind(params);
    const rows: Record<string, SqlValue>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, SqlValue>);
    }
    return rows;
  } finally {
    stmt.free();
  }
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

export interface UpsertAgentFromSessionInput {
  sessionId: string;
  workspace: string;
  prompt: string;
  model?: string;
}

export interface CreateAgentLaunchInput {
  id: string;
  workspace: string;
  name: string;
  model: string;
  sourceRepository: string | null;
  sourceRef: string;
  sourcePrUrl: string | null;
  targetBranchName: string | null;
  autoCreatePr: boolean;
  openAsCursorGithubApp: boolean;
  skipReviewerRequest: boolean;
  autoBranch: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
  apiKeyEncrypted: string;
  apiKeyFingerprint: string;
  /** Normalized (lowercase) email from `?email=` — stored for PAT resolution and scoping. */
  userEmail: string;
}

export async function upsertAgentFromSession(input: UpsertAgentFromSessionInput): Promise<void> {
  const conn = await getDb();
  const now = Date.now();
  const name = input.prompt.trim().slice(0, 200) || "New agent";
  const model = input.model?.trim() || null;

  const existing = queryOne(conn, "SELECT id FROM agents WHERE id = ?", [input.sessionId]);
  if (existing) {
    conn.run(
      `UPDATE agents SET name = ?, workspace = ?, model = ?, status = 'RUNNING', updated_at = ? WHERE id = ?`,
      [name, input.workspace, model, now, input.sessionId],
    );
  } else {
    conn.run(
      `INSERT INTO agents (
        id, name, status, created_at, updated_at, workspace, model
      ) VALUES (?, ?, 'RUNNING', ?, ?, ?, ?)`,
      [input.sessionId, name, now, now, input.workspace, model],
    );
  }
  persistDb();
}

export function applyLaunchDefaults(body: CloudLaunchRequest): {
  model: string;
  sourceRef: string;
  target: {
    autoCreatePr: boolean;
    openAsCursorGithubApp: boolean;
    skipReviewerRequest: boolean;
    autoBranch: boolean;
    branchName?: string;
  };
} {
  const target = body.target ?? {};
  return {
    model: body.model?.trim() || "default",
    /** Empty string = use remote default branch after clone (see ensureWorkspace). */
    sourceRef: body.source.ref?.trim() ?? "",
    target: {
      autoCreatePr: target.autoCreatePr ?? true,
      openAsCursorGithubApp: target.openAsCursorGithubApp ?? false,
      skipReviewerRequest: target.skipReviewerRequest ?? false,
      autoBranch: target.autoBranch ?? true,
      branchName: target.branchName?.trim() || undefined,
    },
  };
}

export async function createAgentLaunch(input: CreateAgentLaunchInput): Promise<void> {
  const conn = await getDb();
  const now = Date.now();
  conn.run(
    `INSERT INTO agents (
      id, cursor_session_id, name, status, created_at, updated_at, model, workspace,
      source_repository, source_ref, source_pr_url, target_branch_name, target_pr_url,
      auto_create_pr, open_as_cursor_github_app, skip_reviewer_request, auto_branch,
      webhook_url, webhook_secret, api_key_encrypted, api_key_fingerprint, user_email
    ) VALUES (?, NULL, ?, 'CREATING', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.name,
      now,
      now,
      input.model,
      input.workspace,
      input.sourceRepository,
      input.sourceRef,
      input.sourcePrUrl,
      input.targetBranchName,
      input.autoCreatePr ? 1 : 0,
      input.openAsCursorGithubApp ? 1 : 0,
      input.skipReviewerRequest ? 1 : 0,
      input.autoBranch ? 1 : 0,
      input.webhookUrl,
      input.webhookSecret,
      input.apiKeyEncrypted,
      input.apiKeyFingerprint,
      normalizeUserEmail(input.userEmail),
    ],
  );
  persistDb();
}

export async function updateAgentStatus(id: string, status: string, summary?: string): Promise<void> {
  const conn = await getDb();
  const now = Date.now();
  if (summary !== undefined) {
    conn.run("UPDATE agents SET status = ?, summary = ?, updated_at = ? WHERE id = ?", [status, summary, now, id]);
  } else {
    conn.run("UPDATE agents SET status = ?, updated_at = ? WHERE id = ?", [status, now, id]);
  }
  persistDb();
}

export async function setAgentSessionId(id: string, cursorSessionId: string): Promise<void> {
  const conn = await getDb();
  const now = Date.now();
  conn.run("UPDATE agents SET cursor_session_id = ?, updated_at = ? WHERE id = ?", [cursorSessionId, now, id]);
  persistDb();
}

/** Persist the branch actually checked out (e.g. remote default) when source.ref was omitted. */
export async function setAgentResolvedSourceRef(id: string, sourceRef: string): Promise<void> {
  const ref = sourceRef.trim();
  if (!ref) return;
  const conn = await getDb();
  const now = Date.now();
  conn.run("UPDATE agents SET source_ref = ?, updated_at = ? WHERE id = ?", [ref, now, id]);
  persistDb();
}

export async function setAgentConversation(id: string, messages: CloudConversationMessage[]): Promise<void> {
  const conn = await getDb();
  const now = Date.now();
  conn.run("UPDATE agents SET conversation_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(messages), now, id]);
  persistDb();
}

function parseConversationJson(raw: string | null): CloudConversationMessage[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is CloudConversationMessage =>
        m !== null &&
        typeof m === "object" &&
        typeof (m as CloudConversationMessage).id === "string" &&
        ((m as CloudConversationMessage).type === "user_message" ||
          (m as CloudConversationMessage).type === "assistant_message") &&
        typeof (m as CloudConversationMessage).text === "string",
    );
  } catch {
    return [];
  }
}

export async function getAgentConversation(id: string): Promise<CloudConversationMessage[]> {
  const conn = await getDb();
  const row = queryOne(conn, "SELECT conversation_json FROM agents WHERE id = ?", [id]);
  if (!row) return [];
  return parseConversationJson(row.conversation_json as string | null);
}

/**
 * Returns messages only if the agent exists and belongs to this API key (tenant).
 * Legacy rows with `user_email` NULL remain visible; otherwise `userEmailNormalized` must match.
 */
export async function getAgentConversationForApiKey(
  id: string,
  apiKeyFingerprint: string,
  userEmailNormalized: string,
): Promise<CloudConversationMessage[] | null> {
  const conn = await getDb();
  const row = queryOne(
    conn,
    `SELECT conversation_json FROM agents WHERE id = ? AND api_key_fingerprint = ?
     AND (user_email IS NULL OR user_email = ?)`,
    [id, apiKeyFingerprint, userEmailNormalized],
  );
  if (!row) return null;
  return parseConversationJson(row.conversation_json as string | null);
}

export async function getDecryptedApiKeyForAgent(id: string): Promise<string | null> {
  const conn = await getDb();
  const row = queryOne(conn, "SELECT api_key_encrypted FROM agents WHERE id = ?", [id]);
  const enc = row?.api_key_encrypted as string | null;
  if (!enc?.trim()) return null;
  try {
    return decryptApiKey(enc);
  } catch {
    return null;
  }
}

/** Normalized `user_email` for the agent, or null (legacy row). */
export async function getAgentUserEmail(id: string): Promise<string | null> {
  const conn = await getDb();
  const row = queryOne(conn, "SELECT user_email FROM agents WHERE id = ?", [id]);
  const v = row?.user_email as string | null;
  if (!v?.trim()) return null;
  return normalizeUserEmail(v);
}

export async function setAgentResultFields(
  id: string,
  values: { targetPrUrl?: string | null; summary?: string },
): Promise<void> {
  const conn = await getDb();
  const now = Date.now();
  if (values.summary !== undefined && values.targetPrUrl !== undefined) {
    conn.run(
      "UPDATE agents SET target_pr_url = ?, summary = ?, updated_at = ? WHERE id = ?",
      [values.targetPrUrl, values.summary, now, id],
    );
  } else if (values.summary !== undefined) {
    conn.run("UPDATE agents SET summary = ?, updated_at = ? WHERE id = ?", [values.summary, now, id]);
  } else if (values.targetPrUrl !== undefined) {
    conn.run("UPDATE agents SET target_pr_url = ?, updated_at = ? WHERE id = ?", [values.targetPrUrl, now, id]);
  }
  persistDb();
}

export interface ListAgentsParams {
  limit?: number;
  cursor?: string | null;
  prUrl?: string | null;
  /** Required for cloud API: only list agents created with this API key. */
  apiKeyFingerprint: string;
  /** Normalized email from `?email=` — required for cloud list scoping. */
  userEmailNormalized: string;
}

interface CursorPayload {
  createdAt: number;
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8");
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (typeof o.createdAt !== "number" || typeof o.id !== "string") return null;
    return { createdAt: o.createdAt, id: o.id };
  } catch {
    return null;
  }
}

function intToBool(n: SqlValue): boolean {
  return Number(n) === 1;
}

export function mapRowToCloudAgent(row: Record<string, SqlValue>, origin: string): CloudAgentListItem {
  const id = row.id as string;
  const createdAtMs = row.created_at as number;
  const sourceRepo = (row.source_repository as string | null) ?? (row.workspace as string);
  const rawRef = (row.source_ref as string | null)?.trim();
  const sourceRef = rawRef && rawRef.length > 0 ? rawRef : "(repo-default)";

  const source: CloudAgentListItem["source"] = { repository: sourceRepo, ref: sourceRef };
  const sourcePr = row.source_pr_url as string | null;
  if (sourcePr) source.prUrl = sourcePr;

  const status = ((row.status as string | null) || "FINISHED").toUpperCase();

  const target: CloudAgentListItem["target"] = {
    url: `${origin}/#session=${encodeURIComponent(id)}`,
    autoCreatePr: intToBool(row.auto_create_pr),
    openAsCursorGithubApp: intToBool(row.open_as_cursor_github_app),
    skipReviewerRequest: intToBool(row.skip_reviewer_request),
    autoBranch: intToBool(row.auto_branch),
  };
  const branchName = row.target_branch_name as string | null;
  if (branchName) target.branchName = branchName;
  const targetPr = row.target_pr_url as string | null;
  if (targetPr) target.prUrl = targetPr;

  const item: CloudAgentListItem = {
    id,
    name: row.name as string,
    status,
    source,
    target,
    createdAt: new Date(createdAtMs).toISOString(),
  };
  const summary = row.summary as string | null;
  if (summary) item.summary = summary;

  return item;
}

export async function listAgents(params: ListAgentsParams, origin: string): Promise<CloudAgentListResponse> {
  let limit = params.limit ?? 20;
  if (limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  const conn = await getDb();
  const prUrl = params.prUrl?.trim();
  const cursorPayload = params.cursor?.trim() ? decodeCursor(params.cursor.trim()) : null;
  if (params.cursor?.trim() && !cursorPayload) {
    return { agents: [] };
  }

  const conditions: string[] = ["api_key_fingerprint = ?", "user_email = ?"];
  const sqlParams: SqlValue[] = [params.apiKeyFingerprint, params.userEmailNormalized];

  if (prUrl) {
    conditions.push("(source_pr_url = ? OR target_pr_url = ?)");
    sqlParams.push(prUrl, prUrl);
  }
  if (cursorPayload) {
    conditions.push("((created_at < ?) OR (created_at = ? AND id < ?))");
    sqlParams.push(cursorPayload.createdAt, cursorPayload.createdAt, cursorPayload.id);
  }

  sqlParams.push(limit + 1);

  const rows = queryAll(
    conn,
    `SELECT * FROM agents WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    sqlParams,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const agents = page.map((row) => mapRowToCloudAgent(row, origin));

  let nextCursor: string | undefined;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = encodeCursor({
      createdAt: last.created_at as number,
      id: last.id as string,
    });
  }

  return { agents, nextCursor };
}

export async function getCloudAgentById(
  id: string,
  origin: string,
  apiKeyFingerprint: string,
  userEmailNormalized: string,
): Promise<CloudAgentListItem | null> {
  const conn = await getDb();
  const row = queryOne(
    conn,
    `SELECT * FROM agents WHERE id = ? AND api_key_fingerprint = ?
     AND (user_email IS NULL OR user_email = ?)`,
    [id, apiKeyFingerprint, userEmailNormalized],
  );
  if (!row) return null;
  return mapRowToCloudAgent(row, origin);
}

export interface AgentFollowupContext {
  workspace: string;
  cursorSessionId: string;
  model: string;
  sourceRef: string;
  workBranch: string | null;
  autoCreatePr: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
}

/** For POST /v0/agents/{id}/followup — tenant-scoped; omit cursorSessionId check here (route enforces). */
export async function getAgentFollowupContext(
  id: string,
  apiKeyFingerprint: string,
  userEmailNormalized: string,
): Promise<AgentFollowupContext | null> {
  const conn = await getDb();
  const row = queryOne(
    conn,
    `SELECT workspace, cursor_session_id, model, source_ref, target_branch_name,
            auto_create_pr, webhook_url, webhook_secret
     FROM agents WHERE id = ? AND api_key_fingerprint = ?
     AND (user_email IS NULL OR user_email = ?)`,
    [id, apiKeyFingerprint, userEmailNormalized],
  );
  if (!row) return null;
  const cursorSessionId = (row.cursor_session_id as string | null)?.trim() || "";
  return {
    workspace: row.workspace as string,
    cursorSessionId,
    model: (row.model as string | null)?.trim() || "default",
    sourceRef: (row.source_ref as string | null)?.trim() || "",
    workBranch: (row.target_branch_name as string | null)?.trim() || null,
    autoCreatePr: intToBool(row.auto_create_pr),
    webhookUrl: (row.webhook_url as string | null)?.trim() || null,
    webhookSecret: (row.webhook_secret as string | null)?.trim() || null,
  };
}

export async function getAgentWorkspace(id: string): Promise<string | null> {
  const conn = await getDb();
  const row = queryOne(conn, "SELECT workspace FROM agents WHERE id = ?", [id]);
  return row ? (row.workspace as string) : null;
}

export async function getAgentRuntimeInfo(id: string): Promise<{ workspace: string; sessionId: string }> {
  const conn = await getDb();
  const row = queryOne(conn, "SELECT workspace, cursor_session_id FROM agents WHERE id = ?", [id]);
  if (!row) {
    throw new Error("Agent not found");
  }
  return {
    workspace: row.workspace as string,
    sessionId: (row.cursor_session_id as string | null) || id,
  };
}
