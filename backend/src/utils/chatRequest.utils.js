/**
 * @param {Record<string, unknown> | undefined} body
 * @param {Record<string, unknown> | undefined} query
 */
export function readReleaseId(body, query) {
  const raw =
    body?.r ?? body?.releaseId ?? query?.r ?? query?.releaseId;
  const r0 = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(r0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** @param {Record<string, unknown> | undefined} body */
export function readClientEmail(body) {
  const raw = body?.clientEmail ?? body?.e ?? body?.lockedBy;
  if (typeof raw !== "string") return "";
  return raw.trim();
}
