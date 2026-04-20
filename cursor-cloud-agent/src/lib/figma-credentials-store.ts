import type initSqlJs from "sql.js";
import { getDb, persistDb } from "@/lib/session-store";
import { decryptApiKey, encryptApiKey } from "@/lib/cloud-api-key-crypto";
import { normalizeUserEmail } from "@/lib/user-email";

type SqlValue = initSqlJs.SqlValue;
type Database = initSqlJs.Database;

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

export async function upsertFigmaAccessToken(emailRaw: string, plaintextToken: string): Promise<void> {
  const email = normalizeUserEmail(emailRaw);
  if (!email) throw new Error("email is required");
  const tok = plaintextToken.trim();
  if (!tok) throw new Error("figmaAccessToken is required");

  const conn = await getDb();
  const now = Date.now();
  const enc = encryptApiKey(tok);
  conn.run(
    `INSERT OR REPLACE INTO figma_credentials (email_normalized, figma_token_encrypted, updated_at) VALUES (?, ?, ?)`,
    [email, enc, now],
  );
  persistDb();
}

export async function getFigmaAccessTokenForEmail(emailRaw: string): Promise<string | null> {
  const email = normalizeUserEmail(emailRaw);
  if (!email) return null;

  const conn = await getDb();
  const row = queryOne(conn, "SELECT figma_token_encrypted FROM figma_credentials WHERE email_normalized = ?", [
    email,
  ]);
  const enc = row?.figma_token_encrypted as string | null;
  if (!enc?.trim()) return null;
  try {
    return decryptApiKey(enc);
  } catch {
    return null;
  }
}

export async function hasFigmaAccessToken(emailRaw: string): Promise<boolean> {
  const t = await getFigmaAccessTokenForEmail(emailRaw);
  return Boolean(t?.trim());
}

/** True if env fallback or DB has a Figma token for this normalized email. */
export async function hasEffectiveFigmaAccessToken(emailNormalized: string): Promise<boolean> {
  if (process.env.FIGMA_API_KEY?.trim()) return true;
  return hasFigmaAccessToken(emailNormalized);
}
