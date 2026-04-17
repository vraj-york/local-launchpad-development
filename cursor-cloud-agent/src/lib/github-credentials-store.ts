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

export async function upsertGithubPat(emailRaw: string, plaintextPat: string): Promise<void> {
  const email = normalizeUserEmail(emailRaw);
  if (!email) throw new Error("email is required");
  const pat = plaintextPat.trim();
  if (!pat) throw new Error("githubToken is required");

  const conn = await getDb();
  const now = Date.now();
  const enc = encryptApiKey(pat);
  conn.run(
    `INSERT OR REPLACE INTO github_credentials (email_normalized, github_pat_encrypted, updated_at) VALUES (?, ?, ?)`,
    [email, enc, now],
  );
  persistDb();
}

export async function getGithubPatForEmail(emailRaw: string): Promise<string | null> {
  const email = normalizeUserEmail(emailRaw);
  if (!email) return null;

  const conn = await getDb();
  const row = queryOne(conn, "SELECT github_pat_encrypted FROM github_credentials WHERE email_normalized = ?", [
    email,
  ]);
  const enc = row?.github_pat_encrypted as string | null;
  if (!enc?.trim()) return null;
  try {
    return decryptApiKey(enc);
  } catch {
    return null;
  }
}

export async function hasGithubPat(emailRaw: string): Promise<boolean> {
  const p = await getGithubPatForEmail(emailRaw);
  return Boolean(p?.trim());
}

/** True if env fallback or DB has a PAT for this normalized email. */
export async function hasEffectiveGithubPat(emailNormalized: string): Promise<boolean> {
  if (process.env.GITHUB_PAT_TOKEN?.trim()) return true;
  return hasGithubPat(emailNormalized);
}
