/**
 * Coerce user input into an absolute http(s) URL.
 * Accepts full URLs or shorthand like `github.com/org/repo` (no scheme).
 */
export function normalizeFlexibleUrl(raw: string): string {
  const s = raw.trim();
  if (!s) throw new Error("empty");

  const asHttpUrl = (candidate: string): string | undefined => {
    try {
      const u = new URL(candidate);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch {
      /* ignore */
    }
    return undefined;
  };

  return asHttpUrl(s) ?? asHttpUrl(`https://${s.replace(/^\/+/, "")}`) ?? (() => {
    throw new Error("invalid URL");
  })();
}
