/**
 * Parse canonical gitRepoPath into provider + workspace/owner + repo slug.
 * Examples: github.com/acme/app, bitbucket.org/acme/app, https://github.com/acme/app.git
 * @param {string} raw
 * @returns {{ provider: 'github'|'bitbucket', owner: string, repo: string } | null}
 */
export function parseScmRepoPath(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  const noProto = s.replace(/^https?:\/\//i, "").replace(/\.git$/i, "");

  if (/^bitbucket\.org\//i.test(noProto)) {
    const path = noProto.replace(/^bitbucket\.org\/?/i, "");
    const parts = path.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return { provider: "bitbucket", owner: parts[0], repo: parts[1] };
    }
    return null;
  }

  const ghPath = noProto.replace(/^github\.com\/?/i, "");
  const parts = ghPath.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { provider: "github", owner: parts[0], repo: parts[1] };
  }
  return null;
}
