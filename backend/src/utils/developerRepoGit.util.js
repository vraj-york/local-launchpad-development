import { execa } from "execa";
import ApiError from "./apiError.js";
import { parseGitRepoPath } from "../services/github.service.js";

export function normalizeGithubRepoPath(raw) {
  if (raw == null) return null;
  const parsed = parseGitRepoPath(String(raw));
  if (!parsed) return null;
  return `github.com/${parsed.owner}/${parsed.repo}`;
}

export function publicHttpsRepoUrl(parsed) {
  return `https://github.com/${parsed.owner}/${parsed.repo}.git`;
}

/**
 * HTTPS URL with embedded credentials for `git clone` / `git submodule add` (no TTY).
 * Prefer username + token when `githubUsername` is set (OAuth / legacy DB field); else `x-access-token`.
 */
export function authenticatedCloneUrl(parsed, token, githubUsername) {
  const t = token?.trim();
  if (!t) return null;
  const user = typeof githubUsername === "string" ? githubUsername.trim() : "";
  if (user) {
    return `https://${encodeURIComponent(user)}:${encodeURIComponent(t)}@github.com/${parsed.owner}/${parsed.repo}.git`;
  }
  return `https://x-access-token:${encodeURIComponent(t)}@github.com/${parsed.owner}/${parsed.repo}.git`;
}

/** Env for raw `execa("git", ...)` calls so Git never prompts in Docker. */
export function gitHeadlessEnv() {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

/**
 * Rewrite bare https://github.com/... URLs to token-authenticated URLs for this repo only.
 * Required for `git submodule add` / `submodule update` in headless environments (no credential helper).
 */
export async function configureGithubHttpsAuthInsteadOf(workDir, token, githubUsername) {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t) return;
  const user = typeof githubUsername === "string" ? githubUsername.trim() : "";
  const authPrefix = user
    ? `https://${encodeURIComponent(user)}:${encodeURIComponent(t)}@github.com/`
    : `https://x-access-token:${encodeURIComponent(t)}@github.com/`;
  await git(workDir, [
    "config",
    "--local",
    "url.https://github.com/.insteadOf",
    authPrefix,
  ]);
}

/**
 * Git strips user:pass from remote URLs on fetch; use an Authorization header instead (CI/Docker-safe).
 * @see https://git-scm.com/docs/git-config#Documentation/git-config.txt-httplturlgtextraHeader
 */
export async function configureGithubHttpExtraHeader(workDir, token, githubUsername) {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t) return;
  const user =
    typeof githubUsername === "string" && githubUsername.trim()
      ? githubUsername.trim()
      : "x-access-token";
  const basic = Buffer.from(`${user}:${t}`, "utf8").toString("base64");
  const header = `AUTHORIZATION: basic ${basic}`;
  await git(workDir, [
    "config",
    "--local",
    "http.https://github.com/.extraHeader",
    header,
  ]);
}

export async function git(cwd, args, opts = {}) {
  try {
    return await execa("git", args, {
      cwd,
      ...opts,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        ...opts.env,
      },
    });
  } catch (e) {
    const stderr = e.stderr?.toString?.() || "";
    const msg = (stderr || e.shortMessage || e.message || String(e)).slice(0, 800);
    throw new ApiError(502, `Git failed: ${msg}`);
  }
}
