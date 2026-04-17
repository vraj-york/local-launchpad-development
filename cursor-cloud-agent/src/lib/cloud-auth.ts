import type { NextRequest } from "next/server";

/**
 * Validates Cloud API–style credentials.
 * Accepts:
 * - `Authorization: Basic base64(<key>:)` (empty password), e.g. curl -u KEY:
 * - `Authorization: Bearer <key>` (same as many HTTP clients and Cursor docs examples)
 * Rejects Basic with a non-empty password (key must be username-only).
 */
export function authorizeCloudApi(req: NextRequest, apiKey: string): boolean {
  const token = extractCloudApiKeyFromAuthorization(req.headers.get("authorization"));
  return token === apiKey;

}

export function extractCloudApiKeyFromAuthorization(auth: string | null): string | null {
  if (!auth) return null;

  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  if (bearer) {
    const t = bearer[1]?.trim();
    return t || null;
  }

  const basic = /^Basic\s+(.+)$/i.exec(auth);
  if (basic) {
    try {
      const decoded = Buffer.from(basic[1], "base64").toString("utf-8");
      const idx = decoded.indexOf(":");
      const user = idx === -1 ? decoded : decoded.slice(0, idx);
      if (idx !== -1 && decoded.slice(idx + 1) !== "") return null;
      return user;
    } catch {
      return null;
    }
  }

  return null;
}

/** Non-empty key from Authorization (never compared to server env). */
export function getIncomingCloudApiKey(auth: string | null): string | null {
  const key = extractCloudApiKeyFromAuthorization(auth);
  const t = key?.trim();
  return t ? t : null;
}
