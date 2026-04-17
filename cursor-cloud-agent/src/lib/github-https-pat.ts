const GITHUB_PAT_ENV = "GITHUB_PAT_TOKEN";

function resolvePat(explicitPat?: string | null): string | null {
  const fromArg = explicitPat?.trim();
  if (fromArg) return fromArg;
  return process.env[GITHUB_PAT_ENV]?.trim() || null;
}

/**
 * Rewrites `https://github.com/...` remotes for HTTPS Git (user `x-access-token`, password = PAT).
 * PAT source: `explicitPat` when non-empty, else `GITHUB_PAT_TOKEN` env.
 * Does not modify SSH remotes, non-GitHub URLs, or URLs that already include userinfo.
 */
export function withOptionalGithubHttpsPat(repoUrl: string, explicitPat?: string | null): string {
  const pat = resolvePat(explicitPat);
  if (!pat) return repoUrl;
  try {
    const u = new URL(repoUrl);
    if (u.protocol !== "https:" || u.hostname !== "github.com") return repoUrl;
    if (u.username || u.password) return repoUrl;
    u.username = "x-access-token";
    u.password = pat;
    return u.toString();
  } catch {
    return repoUrl;
  }
}

/** Strip embedded credentials from an HTTPS URL for safe logging. */
export function redactGitRemoteForLog(repoUrl: string): string {
  try {
    const u = new URL(repoUrl);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
    }
    return u.toString();
  } catch {
    return repoUrl;
  }
}
