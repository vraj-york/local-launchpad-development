import path from "path";
import fs from "fs-extra";
import { execa } from "execa";
import { PrismaClient } from "@prisma/client";
import ApiError from "../utils/apiError.js";
import { getBackendRoot } from "../utils/instanceRoot.js";
import { parseGitRepoPath } from "./github.service.js";
import { resolveGithubCredentialsFromProject } from "./integrationCredential.service.js";

const prisma = new PrismaClient();

function normalizeGithubRepoPath(raw) {
  if (raw == null) return null;
  const parsed = parseGitRepoPath(String(raw));
  if (!parsed) return null;
  return `github.com/${parsed.owner}/${parsed.repo}`;
}

function publicHttpsRepoUrl(parsed) {
  return `https://github.com/${parsed.owner}/${parsed.repo}.git`;
}

function authenticatedCloneUrl(parsed, token) {
  const t = token?.trim();
  if (!t) return null;
  return `https://x-access-token:${t}@github.com/${parsed.owner}/${parsed.repo}.git`;
}

/** Fixed submodule path inside the developer repository (git submodule path / folder name). */
const LAUNCHPAD_FRONTEND_SUBMODULE_PATH = "launchpad-frontend";

function parentSubmoduleCommitMessage() {
  const custom = (process.env.DEVELOPER_SUBMODULE_PARENT_COMMIT_MESSAGE || "").trim();
  if (custom) return custom;
  return "Update the Launchpad branch";
}

async function git(cwd, args, opts = {}) {
  try {
    return await execa("git", args, {
      cwd,
      ...opts,
      env: { ...process.env, ...opts.env },
    });
  } catch (e) {
    const stderr = e.stderr?.toString?.() || "";
    const msg = (stderr || e.shortMessage || e.message || String(e)).slice(0, 800);
    throw new ApiError(502, `Git failed: ${msg}`);
  }
}

/** True if string looks like a full git object id. */
function looksLikeFullSha(s) {
  return /^[0-9a-f]{40}$/i.test(String(s).trim());
}

function pickShaFromLsRemote(stdout) {
  const lines = stdout.trim().split("\n").filter(Boolean);
  let fallback = null;
  for (const line of lines) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const sha = line.slice(0, tab).trim();
    const name = line.slice(tab + 1).trim();
    if (name.endsWith("^{}")) return sha.toLowerCase();
    if (/^[0-9a-f]{40}$/i.test(sha)) fallback = sha.toLowerCase();
  }
  return fallback;
}

/**
 * Resolve active version gitTag (tag, branch name, or full sha) to a commit SHA on the platform remote.
 */
async function resolvePlatformRefToCommitSha(cwd, remoteUrl, gitTagRef) {
  const ref = String(gitTagRef).trim();
  if (!ref) {
    throw new ApiError(400, "Active version has an empty git tag / ref.");
  }
  if (looksLikeFullSha(ref)) {
    return ref.toLowerCase();
  }
  const { stdout } = await git(cwd, [
    "ls-remote",
    remoteUrl,
    `refs/tags/${ref}^{}`,
    `refs/tags/${ref}`,
    `refs/heads/${ref}`,
  ]);
  const sha = pickShaFromLsRemote(stdout);
  if (!sha) {
    throw new ApiError(
      400,
      `Could not resolve "${ref}" to a commit on the platform repository (tag, branch, or full SHA).`,
    );
  }
  return sha;
}

async function ensureSubmoduleHasCommit(subAbs, remoteUrl, commitSha, refHint) {
  await git(subAbs, ["remote", "set-url", "origin", remoteUrl]);
  await execa("git", ["-C", subAbs, "fetch", "--unshallow"], { reject: false });
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
 * When developmentRepoUrl is set, clone that repo, ensure the platform gitRepoPath is a submodule
 * at launchpad-frontend/, then follow the usual submodule pin flow:
 *   cd launchpad-frontend && git fetch origin && git checkout &lt;commit-sha&gt;
 *   cd .. && git commit -m "…" && git push
 * The commit SHA comes from the active ProjectVersion gitTag (tag/branch/sha) on that release.
 * Uses public https URLs in .gitmodules; token only for fetch/push remotes.
 *
 * @param {{ releaseId: number, project: object, releaseName?: string|null }} params
 */
export async function syncDeveloperRepoSubmoduleForReleaseLock(params) {
  const { releaseId, project } = params;
  const releaseName =
    typeof params.releaseName === "string" && params.releaseName.trim()
      ? params.releaseName.trim()
      : `release-${releaseId}`;

  const devNorm = normalizeGithubRepoPath(project.developmentRepoUrl || "");
  const srcNorm = normalizeGithubRepoPath(project.gitRepoPath || "");
  if (!devNorm) {
    return { skipped: true, reason: "developmentRepoUrl not set" };
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

  const { githubToken } = await resolveGithubCredentialsFromProject(project);
  const token = githubToken?.trim();
  if (!token) {
    throw new ApiError(400, "GitHub credentials are required to sync the developer repository.");
  }

  const devParsed = parseGitRepoPath(devNorm);
  const srcParsed = parseGitRepoPath(srcNorm);
  if (!devParsed || !srcParsed) {
    throw new ApiError(400, "Invalid GitHub repository path.");
  }

  const devAuthUrl = authenticatedCloneUrl(devParsed, token);
  const srcAuthUrl = authenticatedCloneUrl(srcParsed, token);
  const srcPublicUrl = publicHttpsRepoUrl(srcParsed);
  if (!devAuthUrl || !srcAuthUrl) {
    throw new ApiError(400, "Could not build authenticated git URLs.");
  }

  const tmpBase = path.join(
    getBackendRoot(),
    "_tmp_developer_submodule",
    `rel_${releaseId}_${Date.now()}`,
  );
  const workDir = path.join(tmpBase, "repo");
  const submoduleRel = LAUNCHPAD_FRONTEND_SUBMODULE_PATH;
  const authorName =
    (process.env.DEVELOPER_SUBMODULE_COMMITTER_NAME || "Launchpad").trim() || "Launchpad";
  const authorEmail =
    (process.env.DEVELOPER_SUBMODULE_COMMITTER_EMAIL || "noreply@launchpad.local").trim() ||
    "noreply@launchpad.local";
  const gitIdent = ["-c", `user.name=${authorName}`, "-c", `user.email=${authorEmail}`];

  try {
    await fs.ensureDir(tmpBase);
    await git(tmpBase, ["clone", devAuthUrl, workDir]);

    const commitSha = await resolvePlatformRefToCommitSha(workDir, srcAuthUrl, tag);

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
        await execa("git", ["submodule", "sync"], { cwd: workDir, reject: false });
        await execa("git", ["submodule", "update", "--init", "--recursive"], {
          cwd: workDir,
          reject: false,
        });
        hasSubGit = await pathExists(path.join(subAbs, ".git"));
      }
    }

    if (!hasSubGit) {
      await git(workDir, [...gitIdent, "submodule", "add", "-f", srcPublicUrl, submoduleRel]);
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
    await execa("git", ["submodule", "sync"], { cwd: workDir, reject: false });
    await execa("git", ["submodule", "update", "--init", "--recursive"], {
      cwd: workDir,
      reject: false,
    });
    const subReady = await pathExists(path.join(subAbs, ".git"));
    if (!subReady) {
      throw new ApiError(
        502,
        `Failed to initialize git submodule at "${submoduleRel}" in the developer repository.`,
      );
    }

    await ensureSubmoduleHasCommit(subAbs, srcAuthUrl, commitSha, tag);
    await git(subAbs, ["checkout", "--force", commitSha]);

    await git(subAbs, ["remote", "set-url", "origin", srcPublicUrl]);

    await git(workDir, ["add", ".gitmodules", submoduleRel]);

    const commitMsg = parentSubmoduleCommitMessage();

    const diffCached = await execa("git", ["diff", "--cached", "--quiet"], {
      cwd: workDir,
      reject: false,
    });
    if (diffCached.exitCode !== 0) {
      await git(workDir, [...gitIdent, "commit", "-m", commitMsg]);
    }

    await git(workDir, ["remote", "set-url", "origin", devAuthUrl]);
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
