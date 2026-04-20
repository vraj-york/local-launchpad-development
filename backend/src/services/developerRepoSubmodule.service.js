import path from "path";
import fs from "fs-extra";
import { execa } from "execa";
import fetch from "node-fetch";
import { prisma } from "../lib/prisma.js";
import ApiError from "../utils/apiError.js";
import { getBackendRoot } from "../utils/instanceRoot.js";
import { parseGitRepoPath } from "./github.service.js";
import { parseScmRepoPath } from "../utils/scmPath.js";
import { resolveGithubCredentialsFromProject } from "./integrationCredential.service.js";
import {
  authenticatedCloneUrl,
  configureGithubHttpExtraHeader,
  configureGithubHttpsAuthInsteadOf,
  git,
  gitHeadlessEnv,
  normalizeGithubRepoPath,
  publicHttpsRepoUrl,
} from "../utils/developerRepoGit.util.js";
import { API_BASE_URLS } from "../constants/contstants.js";

/** Default submodule path inside the developer repository (git submodule path / folder name). */
export const LAUNCHPAD_FRONTEND_SUBMODULE_PATH = "launchpad-frontend";

const MAX_DEVELOPER_SUBMODULE_PATH_LEN = 200;
const MAX_DEVELOPER_AGENT_REF_LEN = 255;

function parentSubmoduleCommitMessage() {
  const custom = (process.env.DEVELOPER_SUBMODULE_PARENT_COMMIT_MESSAGE || "").trim();
  if (custom) return custom;
  return "Update the Launchpad branch";
}

/** True if string looks like a full git object id. */
function looksLikeFullSha(s) {
  return /^[0-9a-f]{40}$/i.test(String(s).trim());
}

/**
 * Resolve tag/branch/sha to a commit SHA on a GitHub repo using the REST API.
 * @param {{ owner: string, repo: string }} repoParsed
 * @param {string} notFoundLabel — e.g. "platform" or "developer" (for error messages)
 */
async function resolveGithubRefToCommitSha(repoParsed, gitTagRef, token, notFoundLabel) {
  const ref = String(gitTagRef).trim();
  if (!ref) {
    throw new ApiError(400, "Ref is empty.");
  }
  if (looksLikeFullSha(ref)) {
    return ref.toLowerCase();
  }
  const t = typeof token === "string" ? token.trim() : "";
  if (!t) {
    throw new ApiError(400, "GitHub token is required to resolve the ref.");
  }
  const owner = encodeURIComponent(repoParsed.owner);
  const repo = encodeURIComponent(repoParsed.repo);
  const refEnc = encodeURIComponent(ref);
  const url = `${API_BASE_URLS.GITHUB}/repos/${owner}/${repo}/commits/${refEnc}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "project-management-platform/release-lock",
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const errBody = await res.json();
      detail =
        typeof errBody?.message === "string" ? errBody.message : JSON.stringify(errBody);
    } catch {
      detail = (await res.text()).slice(0, 300);
    }
    throw new ApiError(
      res.status === 404 ? 404 : 400,
      `Could not resolve "${ref}" on the ${notFoundLabel} GitHub repository (${res.status}): ${detail}`,
    );
  }
  const data = await res.json();
  const sha = typeof data?.sha === "string" ? data.sha.trim() : "";
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new ApiError(502, "GitHub API returned an unexpected commit payload.");
  }
  return sha.toLowerCase();
}

/**
 * Resolve tag/branch/sha to a commit SHA on the platform GitHub repo using the REST API.
 * @param {{ owner: string, repo: string }} srcParsed
 */
async function resolvePlatformRefToCommitSha(srcParsed, gitTagRef, token) {
  const ref = String(gitTagRef).trim();
  if (!ref) {
    throw new ApiError(400, "Active version has an empty git tag / ref.");
  }
  return resolveGithubRefToCommitSha(srcParsed, ref, token, "platform");
}

/**
 * Effective submodule path under the developer repo (trim slashes, reject traversal).
 * @param {string | null | undefined} raw
 * @returns {string}
 */
export function resolveDeveloperSubmodulePathForLock(raw) {
  const fallback = LAUNCHPAD_FRONTEND_SUBMODULE_PATH;
  if (raw == null || String(raw).trim() === "") return fallback;
  const s = String(raw).trim().replace(/^\/+|\/+$/g, "");
  if (!s) return fallback;
  if (s.includes("..")) {
    throw new ApiError(400, "developerSubmodulePath must not contain '..'.");
  }
  if (path.isAbsolute(s)) {
    throw new ApiError(400, "developerSubmodulePath must be a relative path.");
  }
  if (s.length > MAX_DEVELOPER_SUBMODULE_PATH_LEN) {
    throw new ApiError(
      400,
      `developerSubmodulePath is too long (max ${MAX_DEVELOPER_SUBMODULE_PATH_LEN}).`,
    );
  }
  return s;
}

/**
 * @param {string | null | undefined} raw
 * @returns {string | null} null when omitted / blank
 */
export function normalizeDeveloperAgentRefForLock(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (t.length > MAX_DEVELOPER_AGENT_REF_LEN) {
    throw new ApiError(
      400,
      `developerAgentRef is too long (max ${MAX_DEVELOPER_AGENT_REF_LEN}).`,
    );
  }
  if (/[\s\x00-\x1f]/.test(t)) {
    throw new ApiError(400, "developerAgentRef must not contain whitespace or control characters.");
  }
  return t;
}

/**
 * Ensures `ref` resolves on the project's GitHub developmentRepoUrl (branch, tag, or full SHA).
 * @param {import("@prisma/client").Project} project — must include developmentRepoUrl
 * @param {string} ref — non-empty after trim
 */
export async function assertDeveloperAgentRefResolvable(project, ref) {
  const normalized = normalizeDeveloperAgentRefForLock(ref);
  if (!normalized) return;

  const devUrl = String(project.developmentRepoUrl || "").trim();
  const parsed = parseScmRepoPath(devUrl);
  if (!parsed || parsed.provider !== "github") {
    throw new ApiError(
      400,
      "developerAgentRef requires a GitHub developmentRepoUrl on the project.",
    );
  }

  const { githubToken } = await resolveGithubCredentialsFromProject(project);
  const token = githubToken?.trim();
  if (!token) {
    throw new ApiError(400, "GitHub credentials are required to validate developerAgentRef.");
  }

  await resolveGithubRefToCommitSha(
    { owner: parsed.owner, repo: parsed.repo },
    normalized,
    token,
    "developer",
  );
}

/** `remoteUrl` should be the public HTTPS repo URL; auth is via `configureGithubHttpExtraHeader(subAbs)`. */
async function ensureSubmoduleHasCommit(subAbs, remoteUrl, commitSha, refHint) {
  await git(subAbs, ["remote", "set-url", "origin", remoteUrl]);
  await execa("git", ["-C", subAbs, "fetch", "--unshallow"], {
    reject: false,
    env: gitHeadlessEnv(),
  });
  await git(subAbs, ["fetch", "origin", "--tags"]);
  await git(subAbs, ["fetch", "origin"]).catch(() => {});
  try {
    await git(subAbs, ["cat-file", "-e", `${commitSha}^{commit}`]);
    return;
  } catch {
    /* need to fetch objects */
  }
  await git(subAbs, ["fetch", "origin", commitSha]).catch(() => {});
  try {
    await git(subAbs, ["cat-file", "-e", `${commitSha}^{commit}`]);
    return;
  } catch {
    /* continue */
  }
  const hint = String(refHint || "").trim();
  if (hint && !looksLikeFullSha(hint)) {
    await git(subAbs, ["fetch", "origin", `refs/tags/${hint}:refs/tags/${hint}`]).catch(() => {});
    await git(subAbs, ["fetch", "origin", `refs/heads/${hint}:refs/remotes/origin/${hint}`]).catch(
      () => {},
    );
  }
  try {
    await git(subAbs, ["cat-file", "-e", `${commitSha}^{commit}`]);
  } catch {
    throw new ApiError(
      502,
      `Could not fetch commit ${commitSha.slice(0, 7)} into the submodule. Ensure it exists on the platform remote.`,
    );
  }
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * If launchpad-frontend exists but is not a valid submodule checkout, remove it so
 * `git submodule add` can run (stale folder, broken submodule, or partial clone).
 */
async function resetBrokenSubmodulePathForAdd(workDir, submoduleRel) {
  const subAbs = path.join(workDir, submoduleRel);
  const hasSubGit = await pathExists(path.join(subAbs, ".git"));
  if (hasSubGit) return;

  const existingName = await getSubmoduleNameForPath(workDir, submoduleRel);
  if (existingName) {
    await execa("git", ["submodule", "deinit", "-f", submoduleRel], {
      cwd: workDir,
      reject: false,
      env: gitHeadlessEnv(),
    });
  }
  await execa("git", ["rm", "-rf", "--cached", submoduleRel], {
    cwd: workDir,
    reject: false,
    env: gitHeadlessEnv(),
  });
  if (await pathExists(subAbs)) {
    await fs.remove(subAbs);
  }
}

async function getSubmoduleNameForPath(workDir, relPath) {
  const gm = path.join(workDir, ".gitmodules");
  if (!(await pathExists(gm))) return null;
  const text = await fs.readFile(gm, "utf8");
  const esc = relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pathLine = new RegExp(`^\\s*path\\s*=\\s*${esc}\\s*$`, "m");
  const blocks = text.split(/(?=\[submodule ")/g);
  for (const block of blocks) {
    if (!pathLine.test(block)) continue;
    const head = /\[submodule "([^"]+)"\]/.exec(block);
    if (head) return head[1];
  }
  return null;
}

/**
 * Requires developmentRepoUrl (GitHub). Clone that repo, ensure the platform gitRepoPath is a submodule
 * at launchpad-frontend/, then follow the usual submodule pin flow:
 *   cd launchpad-frontend && git fetch origin && git checkout &lt;commit-sha&gt;
 *   cd .. && git commit -m "…" && git push
 * The commit SHA comes from the active ProjectVersion gitTag (tag/branch/sha) on that release.
 * Uses public https URLs in .gitmodules; token only for fetch/push remotes.
 *
 * @param {{ releaseId: number, project: object, releaseName?: string|null, developerSubmodulePath?: string|null }} params
 */
export async function syncDeveloperRepoSubmoduleForReleaseLock(params) {
  const { releaseId, project } = params;
  const submoduleRel = resolveDeveloperSubmodulePathForLock(params.developerSubmodulePath);
  const releaseName =
    typeof params.releaseName === "string" && params.releaseName.trim()
      ? params.releaseName.trim()
      : `release-${releaseId}`;

  const trimmedDev = String(project.developmentRepoUrl || "").trim();
  if (!trimmedDev) {
    throw new ApiError(
      400,
      "Add a developer repository (development repository URL) on the project before locking this release.",
    );
  }

  const devNorm = normalizeGithubRepoPath(project.developmentRepoUrl || "");
  const srcNorm = normalizeGithubRepoPath(project.gitRepoPath || "");
  if (!devNorm) {
    const scm = parseScmRepoPath(trimmedDev);
    if (scm?.provider === "bitbucket") {
      throw new ApiError(
        400,
        "Release lock submodule sync supports GitHub developer repositories only. Set developmentRepoUrl to github.com/owner/repo.",
      );
    }
    throw new ApiError(
      400,
      "developmentRepoUrl must be a valid GitHub repository path (e.g. github.com/owner/repo) before locking.",
    );
  }
  if (!srcNorm) {
    throw new ApiError(
      400,
      "Project gitRepoPath is missing or invalid; cannot add source submodule.",
    );
  }
  if (devNorm === srcNorm) {
    throw new ApiError(
      400,
      "developmentRepoUrl must differ from the platform gitRepoPath (source repository).",
    );
  }

  const version = await prisma.projectVersion.findFirst({
    where: { releaseId, isActive: true },
    orderBy: { createdAt: "desc" },
    select: { gitTag: true },
  });
  const tag = typeof version?.gitTag === "string" ? version.gitTag.trim() : "";
  if (!tag) {
    throw new ApiError(
      400,
      "This release has no active version with a git tag. Set the version you want to lock as active for this release before locking, or clear developmentRepoUrl.",
    );
  }

  const { githubToken, githubUsername } = await resolveGithubCredentialsFromProject(project);
  const token = githubToken?.trim();
  if (!token) {
    throw new ApiError(400, "GitHub credentials are required to sync the developer repository.");
  }

  const devParsed = parseGitRepoPath(devNorm);
  const srcParsed = parseGitRepoPath(srcNorm);
  if (!devParsed || !srcParsed) {
    throw new ApiError(400, "Invalid GitHub repository path.");
  }

  const devAuthUrl = authenticatedCloneUrl(devParsed, token, githubUsername);
  const srcAuthUrl = authenticatedCloneUrl(srcParsed, token, githubUsername);
  const srcPublicUrl = publicHttpsRepoUrl(srcParsed);
  const devPublicUrl = publicHttpsRepoUrl(devParsed);
  if (!devAuthUrl || !srcAuthUrl) {
    throw new ApiError(400, "Could not build authenticated git URLs.");
  }

  const tmpBase = path.join(
    getBackendRoot(),
    "_tmp_developer_submodule",
    `rel_${releaseId}_${Date.now()}`,
  );
  const workDir = path.join(tmpBase, "repo");
  const authorName =
    (process.env.DEVELOPER_SUBMODULE_COMMITTER_NAME || "Launchpad").trim() || "Launchpad";
  const authorEmail =
    (process.env.DEVELOPER_SUBMODULE_COMMITTER_EMAIL || "noreply@launchpad.local").trim() ||
    "noreply@launchpad.local";
  const gitIdent = ["-c", `user.name=${authorName}`, "-c", `user.email=${authorEmail}`];

  try {
    await fs.ensureDir(tmpBase);
    await git(tmpBase, ["clone", devAuthUrl, workDir]);
    await configureGithubHttpsAuthInsteadOf(workDir, token, githubUsername);
    await configureGithubHttpExtraHeader(workDir, token, githubUsername);

    const commitSha = await resolvePlatformRefToCommitSha(srcParsed, tag, token);

    const subAbs = path.join(workDir, submoduleRel);
    let hasSubGit = await pathExists(path.join(subAbs, ".git"));

    if (!hasSubGit) {
      const existingName = await getSubmoduleNameForPath(workDir, submoduleRel);
      if (existingName) {
        await git(workDir, [
          "config",
          "-f",
          ".gitmodules",
          `submodule.${existingName}.url`,
          srcPublicUrl,
        ]);
        await execa("git", ["submodule", "sync"], {
          cwd: workDir,
          reject: false,
          env: gitHeadlessEnv(),
        });
        await execa("git", ["submodule", "update", "--init", "--recursive"], {
          cwd: workDir,
          reject: false,
          env: gitHeadlessEnv(),
        });
        hasSubGit = await pathExists(path.join(subAbs, ".git"));
      }
    }

    if (!hasSubGit) {
      await resetBrokenSubmodulePathForAdd(workDir, submoduleRel);
      /* Embedded credentials: submodule clone often ignores parent url.insteadOf; .gitmodules is rewritten to public URL below. */
      await git(workDir, [...gitIdent, "submodule", "add", "-f", srcAuthUrl, submoduleRel]);
    }

    const submoduleName =
      (await getSubmoduleNameForPath(workDir, submoduleRel)) || submoduleRel;
    await git(workDir, [
      "config",
      "-f",
      ".gitmodules",
      `submodule.${submoduleName}.url`,
      srcPublicUrl,
    ]);
    await execa("git", ["submodule", "sync"], {
      cwd: workDir,
      reject: false,
      env: gitHeadlessEnv(),
    });
    await execa("git", ["submodule", "update", "--init", "--recursive"], {
      cwd: workDir,
      reject: false,
      env: gitHeadlessEnv(),
    });
    const subReady = await pathExists(path.join(subAbs, ".git"));
    if (!subReady) {
      throw new ApiError(
        502,
        `Failed to initialize git submodule at "${submoduleRel}" in the developer repository.`,
      );
    }

    await configureGithubHttpExtraHeader(subAbs, token, githubUsername);
    await ensureSubmoduleHasCommit(subAbs, srcPublicUrl, commitSha, tag);
    await git(subAbs, ["checkout", "--force", commitSha]);

    await git(subAbs, ["remote", "set-url", "origin", srcPublicUrl]);

    await git(workDir, ["add", ".gitmodules", submoduleRel]);

    const commitMsg = parentSubmoduleCommitMessage();

    const diffCached = await execa("git", ["diff", "--cached", "--quiet"], {
      cwd: workDir,
      reject: false,
      env: gitHeadlessEnv(),
    });
    if (diffCached.exitCode !== 0) {
      await git(workDir, [...gitIdent, "commit", "-m", commitMsg]);
    }

    await git(workDir, ["remote", "set-url", "origin", devPublicUrl]);
    await git(workDir, ["push", "origin", "HEAD"]);

    return {
      skipped: false,
      submodulePath: submoduleRel,
      commitSha,
      gitTag: tag,
      releaseName,
      parentCommitMessage: commitMsg,
      shortSha: commitSha.slice(0, 7),
    };
  } finally {
    await fs.remove(tmpBase).catch(() => {});
  }
}
