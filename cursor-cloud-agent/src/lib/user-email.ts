/** Normalize for storage and lookup: trim + lowercase. */
export function normalizeUserEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/** `?email=` required for Cloud v0 — returns null if missing or blank. */
export function getRequiredNormalizedEmailFromUrl(req: Request): string | null {
  const raw = new URL(req.url).searchParams.get("email");
  const email = normalizeUserEmail(raw);
  return email || null;
}
