import validator from "validator";

/**
 * Normalize optional comma/semicolon/newline-separated emails for storage (lowercase, deduped).
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeOptionalEmailListString(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new Error("Email list must be a string");
  }
  const parts = raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    if (!validator.isEmail(p)) {
      throw new Error(`Invalid email: ${p}`);
    }
    const lower = p.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      out.push(lower);
    }
  }
  return out.join(", ");
}

/**
 * @param {string|null|undefined} stored - DB value
 * @returns {Set<string>} lowercase emails
 */
export function parseStoredEmailListToSet(stored) {
  if (!stored || typeof stored !== "string") return new Set();
  return new Set(
    stored
      .split(/[,;\n]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}
