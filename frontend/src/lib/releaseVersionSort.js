/** Semver-style tuple compare (same rules as ReleaseManagement). */

const RELEASE_DOT_VERSION_RE = /^\d+(?:\.\d+)+$/;

export function parseReleaseNameToTuple(name) {
  const n = name?.trim();
  if (!n || !RELEASE_DOT_VERSION_RE.test(n)) return null;
  return n.split(".").map((p) => parseInt(p, 10));
}

export function compareReleaseTuples(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** Descending by version (latest first, e.g. 1.0.3 … 1.0.0); non-semver names last; tie-break newer createdAt first. */
export function sortReleasesByVersionName(releases) {
  return [...releases].sort((a, b) => {
    const ta = parseReleaseNameToTuple(a?.name);
    const tb = parseReleaseNameToTuple(b?.name);
    if (ta && tb) {
      const c = compareReleaseTuples(ta, tb);
      if (c !== 0) return -c;
    } else if (ta && !tb) return -1;
    else if (!ta && tb) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}
