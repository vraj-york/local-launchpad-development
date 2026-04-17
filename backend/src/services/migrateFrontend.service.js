import path from "path";
import fs from "fs-extra";
import { prisma } from "../lib/prisma.js";
import ApiError from "../utils/apiError.js";
import { assertProjectAccess } from "./project.service.js";
import { parseScmRepoPath } from "../utils/scmPath.js";
import { scmGetRepositoryMetadata, scmGetBranchSha } from "./scmFacade.service.js";
import {
  resolveScmCredentialsFromProject,
  resolveGithubCredentialsFromProject,
} from "./integrationCredential.service.js";
import { waitForAgentBranchTipSha } from "../utils/agentBranchTipWait.js";
import {
  git,
  authenticatedCloneUrl,
  configureGithubHttpExtraHeader,
} from "../utils/developerRepoGit.util.js";
import { getBackendRoot } from "../utils/instanceRoot.js";
import { buildMigrateFrontendPrompt } from "./cursorPrompts.js";
import {
  cursorRequest,
  startAgentPolling,
  executeLaunchpadHeadDeploy,
  markScratchVersionFailedIfCreating,
} from "./cursor.service.js";

export const FIGMA_CONVERSION_FLOW_MIGRATE_FRONTEND = "migrate_frontend";

const CURSOR_AGENT_SOURCE_REF_ENV = process.env.CURSOR_AGENT_SOURCE_REF;

/** In-process guard so two poll ticks do not run propagation concurrently for the same agent. */
const migratePropagationInFlight = new Set();

function normalizePlatformSubdirEnv() {
  const raw = typeof process.env.MIGRATE_FRONTEND_PLATFORM_SUBDIR === "string"
    ? process.env.MIGRATE_FRONTEND_PLATFORM_SUBDIR.trim()
    : "";
  const s = raw.replace(/^\/+|\/+$/g, "");
  if (!s) return "";
  if (s.includes("..")) {
    throw new ApiError(400, "MIGRATE_FRONTEND_PLATFORM_SUBDIR must not contain '..'.");
  }
  if (path.isAbsolute(s)) {
    throw new ApiError(400, "MIGRATE_FRONTEND_PLATFORM_SUBDIR must be a relative path.");
  }
  return s;
}

/** Explicit integration UI root under the dev repo (relative path). */
function normalizeMigrateSourceDirEnv() {
  const raw =
    typeof process.env.MIGRATE_FRONTEND_SOURCE_DIR === "string"
      ? process.env.MIGRATE_FRONTEND_SOURCE_DIR.trim()
      : "";
  if (!raw) return null;
  const s = raw.replace(/^\/+|\/+$/g, "");
  if (!s) return null;
  if (s.includes("..")) {
    throw new ApiError(400, "MIGRATE_FRONTEND_SOURCE_DIR must not contain '..'.");
  }
  if (path.isAbsolute(s)) {
    throw new ApiError(400, "MIGRATE_FRONTEND_SOURCE_DIR must be a relative path.");
  }
  return s;
}

/** Explicit destination relative path under platform repo (see resolvePlatformUiDestRel). */
function normalizeMigrateDestRelEnv() {
  const raw =
    typeof process.env.MIGRATE_FRONTEND_DEST_REL === "string"
      ? process.env.MIGRATE_FRONTEND_DEST_REL.trim()
      : "";
  if (!raw) return null;
  const s = raw.replace(/^\/+|\/+$/g, "");
  if (!s) return null;
  if (s.includes("..")) {
    throw new ApiError(400, "MIGRATE_FRONTEND_DEST_REL must not contain '..'.");
  }
  if (path.isAbsolute(s)) {
    throw new ApiError(400, "MIGRATE_FRONTEND_DEST_REL must be a relative path.");
  }
  return s;
}

/** Prefer `frontend/` / `Frontend/`, then other common UI roots. Submodules are not cloned or copied. */
const UI_ROOT_CANDIDATES = ["frontend", "Frontend", "client", "web", "ui", "app"];

/**
 * Resolve relative path to integration UI in dev clone (env or first matching candidate with content).
 * @param {string} devDir
 * @returns {Promise<string>}
 */
async function resolveDevUiSourceRelPath(devDir) {
  const envPath = normalizeMigrateSourceDirEnv();
  if (envPath) {
    const abs = path.join(devDir, envPath);
    if (!(await fs.pathExists(abs))) {
      throw new ApiError(
        400,
        `MIGRATE_FRONTEND_SOURCE_DIR is set to "${envPath}" but that path does not exist on the checked-out developer branch.`,
      );
    }
    const st = await fs.stat(abs).catch(() => null);
    if (!st?.isDirectory()) {
      throw new ApiError(400, `MIGRATE_FRONTEND_SOURCE_DIR must point to a directory.`);
    }
    if (!(await dirHasMigratableContent(abs))) {
      throw new ApiError(
        400,
        `MIGRATE_FRONTEND_SOURCE_DIR="${envPath}" has no migratable files (empty or only git metadata).`,
      );
    }
    return envPath;
  }
  for (const rel of UI_ROOT_CANDIDATES) {
    const abs = path.join(devDir, rel);
    if (await fs.pathExists(abs)) {
      const st = await fs.stat(abs).catch(() => null);
      if (st?.isDirectory() && (await dirHasMigratableContent(abs))) {
        return rel;
      }
    }
  }
  throw new ApiError(
    400,
    `Could not find an integration UI directory in the developer repository (tried: ${UI_ROOT_CANDIDATES.join(", ")}). ` +
      "Set MIGRATE_FRONTEND_SOURCE_DIR to the correct relative path (e.g. apps/web).",
  );
}

/**
 * Relative path under `MIGRATE_FRONTEND_PLATFORM_SUBDIR` (repo-relative) where dev UI files land.
 * - If `MIGRATE_FRONTEND_DEST_REL` is set, that path is used.
 * - If `MIGRATE_FRONTEND_MIRROR_SOURCE_FOLDER=true`, mirror the dev folder name (e.g. `Frontend/`).
 * - Default: `""` — merge **contents** of the dev UI root into the platform base (no extra `Frontend/` segment on platform).
 * @param {string} sourceRel — resolved dev UI directory name (e.g. `Frontend`)
 */
function resolvePlatformUiDestRel(sourceRel) {
  const envDest = normalizeMigrateDestRelEnv();
  if (envDest) return envDest;
  const mirror =
    process.env.MIGRATE_FRONTEND_MIRROR_SOURCE_FOLDER === "true" ||
    String(process.env.MIGRATE_FRONTEND_MIRROR_SOURCE_FOLDER || "").toLowerCase() === "true";
  if (mirror) return sourceRel;
  return "";
}

/** Repo-relative summary for logs (e.g. `apps/web` or `.`). */
function formatPlatformMergeTargetSummary(platformSubdir, destRel) {
  const parts = [];
  if (platformSubdir) parts.push(platformSubdir.replace(/^\/+|\/+$/g, ""));
  if (destRel) parts.push(destRel.replace(/^\/+|\/+$/g, ""));
  return parts.length ? parts.join("/") : ".";
}

function isSensitiveMigrateLeafName(name) {
  const n = String(name || "");
  const lower = n.toLowerCase();
  if (lower === ".env" || lower.startsWith(".env.")) return true;
  if (lower.endsWith(".pem") || lower.endsWith(".key")) return true;
  if (n === "id_rsa" || n === "id_ed25519") return true;
  if (lower === "credentials.json" || lower === "serviceaccountkey.json") return true;
  if (lower === ".npmrc") return true;
  return false;
}

/**
 * Merge dev UI tree **into** an existing platform directory: add/overwrite files, do not delete
 * destination paths missing from the source. Skips nested `.git` and sensitive leaf names.
 * @param {string} srcDir — resolved dev UI root (e.g. …/dev/Frontend)
 * @param {string} destDir — platform target directory (e.g. …/platform or …/platform/apps/web)
 */
async function mergeUiTreeIntoPlatform(srcDir, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  async function walk(rel) {
    const abs = path.join(srcDir, rel);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const ent of entries) {
      const name = ent.name;
      if (name === ".git") continue;
      if (isSensitiveMigrateLeafName(name)) continue;
      const relChild = rel ? path.join(rel, name) : name;
      const from = path.join(srcDir, relChild);
      const to = path.join(destDir, relChild);
      if (ent.isDirectory()) {
        await fs.mkdir(to, { recursive: true });
        await walk(relChild);
      } else if (ent.isSymbolicLink()) {
        const link = await fs.readlink(from);
        await fs.remove(to).catch(() => {});
        await fs.symlink(link, to);
      } else {
        await fs.ensureDir(path.dirname(to));
        await fs.copyFile(from, to);
      }
    }
  }
  await walk("");
}

/** True if directory exists and has at least one entry other than `.git` (submodule gitlink). */
async function dirHasMigratableContent(absDir) {
  const st = await fs.stat(absDir).catch(() => null);
  if (!st?.isDirectory()) return false;
  const entries = await fs.readdir(absDir);
  return entries.some((e) => e !== ".git");
}

/**
 * POST handler: start Cursor agent on developer repo; persist FigmaConversion with flow migrate_frontend.
 * @param {{ projectId: number, releaseId: number, user: object, targetProjectVersionId?: number|null, migrateFrontend?: boolean }} params
 * @param {number|null} [params.targetProjectVersionId] — optional revision to update (moves that tag to new launchpad SHA); omit to create a new revision after deploy.
 * @param {boolean} [params.migrateFrontend] — must be true (user confirmed Migrate Frontend checklist, or create-project auto flow).
 * @returns {Promise<{ agentId: string, figmaConversionId: number }>}
 */
export async function startMigrateFrontendForRelease({
  projectId,
  releaseId,
  user,
  targetProjectVersionId: targetProjectVersionIdRaw = null,
  migrateFrontend: migrateFrontendRaw = null,
}) {
  if (!process.env.CURSOR_API_KEY?.trim()) {
    throw new ApiError(503, "Cursor API key not configured");
  }

  const migrateFrontendAck =
    migrateFrontendRaw === true ||
    String(migrateFrontendRaw || "").toLowerCase() === "true";
  if (!migrateFrontendAck) {
    throw new ApiError(
      400,
      "migrateFrontend must be true (confirm the Migrate Frontend checklist before starting).",
    );
  }

  await assertProjectAccess(projectId, user);

  const rid = Number(releaseId);
  const pid = Number(projectId);
  if (!Number.isInteger(rid) || rid < 1 || !Number.isInteger(pid) || pid < 1) {
    throw new ApiError(400, "Invalid project or release id");
  }

  const release = await prisma.release.findFirst({
    where: { id: rid, projectId: pid },
    select: { id: true },
  });
  if (!release) {
    throw new ApiError(404, "Release not found for this project");
  }

  const project = await prisma.project.findUnique({
    where: { id: pid },
    select: {
      id: true,
      name: true,
      developmentRepoUrl: true,
      gitRepoPath: true,
      githubUsername: true,
      githubToken: true,
      githubConnectionId: true,
      bitbucketUsername: true,
      bitbucketToken: true,
      bitbucketConnectionId: true,
      createdById: true,
    },
  });
  if (!project) {
    throw new ApiError(404, "Project not found");
  }

  let migrateTargetProjectVersionId = null;
  if (targetProjectVersionIdRaw != null && targetProjectVersionIdRaw !== "") {
    const tvid = Number(targetProjectVersionIdRaw);
    if (!Number.isInteger(tvid) || tvid < 1) {
      throw new ApiError(400, "Invalid projectVersionId");
    }
    const pv = await prisma.projectVersion.findFirst({
      where: { id: tvid, projectId: pid, releaseId: rid },
      select: { id: true, gitTag: true },
    });
    if (!pv) {
      throw new ApiError(
        400,
        "That revision does not belong to this release (or was removed).",
      );
    }
    if (!String(pv.gitTag || "").trim()) {
      throw new ApiError(
        400,
        "That revision has no git tag yet. Run a build or pick another revision, or leave revision unset to create a new one.",
      );
    }
    migrateTargetProjectVersionId = pv.id;
  }

  const devRaw = String(project.developmentRepoUrl || "").trim();
  if (!devRaw) {
    throw new ApiError(400, "Set a developer repository URL (GitHub) on the project before migrating Frontend.");
  }

  const devParsed = parseScmRepoPath(devRaw);
  if (!devParsed || devParsed.provider !== "github") {
    throw new ApiError(
      400,
      "Migrate Frontend currently supports a GitHub developer repository URL only.",
    );
  }

  if (!String(project.gitRepoPath || "").trim()) {
    throw new ApiError(400, "Set the platform gitRepoPath on the project before migrating Frontend.");
  }

  const platParsed = parseScmRepoPath(project.gitRepoPath);
  if (!platParsed) {
    throw new ApiError(400, "Invalid platform gitRepoPath format.");
  }

  let ghCreds;
  try {
    ghCreds = await resolveGithubCredentialsFromProject(project);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(
      400,
      "GitHub credentials are required to clone the developer repository. Connect GitHub on the project (OAuth or legacy token).",
    );
  }

  let platScm;
  try {
    platScm = await resolveScmCredentialsFromProject(project);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, "Repository credentials are not configured for the platform repo.");
  }

  if (platScm.provider !== platParsed.provider) {
    throw new ApiError(
      400,
      `Platform gitRepoPath is ${platParsed.provider} but project credentials are for ${platScm.provider}.`,
    );
  }

  const repositoryUrl = `https://github.com/${devParsed.owner}/${devParsed.repo}`;
  const meta = await scmGetRepositoryMetadata(
    "github",
    devParsed.owner,
    devParsed.repo,
    ghCreds.githubToken,
  );
  if (!meta.ok) {
    throw new ApiError(
      400,
      meta.message || "Cannot read the developer repository on GitHub. Check access and token scope.",
    );
  }

  const refBranch =
    (meta.defaultBranch && String(meta.defaultBranch).trim()) ||
    (typeof CURSOR_AGENT_SOURCE_REF_ENV === "string" && CURSOR_AGENT_SOURCE_REF_ENV.trim()
      ? CURSOR_AGENT_SOURCE_REF_ENV.trim()
      : "main");

  const promptText = buildMigrateFrontendPrompt();

  const { status, data } = await cursorRequest({
    method: "POST",
    path: "/v0/agents",
    body: {
      prompt: { text: promptText },
      source: { repository: repositoryUrl, ref: refBranch },
      target: { autoBranch: true },
    },
  });

  if (status < 200 || status >= 300 || !data?.id) {
    const msg =
      (data && typeof data.error === "string" && data.error) ||
      (data && typeof data.message === "string" && data.message) ||
      "Cursor agent could not be started";
    throw new ApiError(status >= 400 && status < 600 ? status : 502, msg);
  }

  const agentId = String(data.id).trim();
  const count = await prisma.figmaConversion.count({
    where: { projectId: pid, releaseId: rid },
  });
  const attemptNumber = count + 1;

  const created = await prisma.figmaConversion.create({
    data: {
      projectId: pid,
      releaseId: rid,
      agentId,
      attemptedById: user.id,
      attemptNumber,
      nodeCount: null,
      status: data.status ? String(data.status).toUpperCase() : "CREATING",
      deferLaunchpadMerge: false,
      awaitingLaunchpadConfirmation: false,
      skipLaunchpadAutomation: false,
      flow: FIGMA_CONVERSION_FLOW_MIGRATE_FRONTEND,
      migrateTargetProjectVersionId,
      migrateFrontend: migrateFrontendAck,
    },
  });

  startAgentPolling(agentId);

  return {
    agentId,
    figmaConversionId: created.id,
  };
}

/**
 * Called from cursor.service poller when a migrate_frontend agent reaches a success terminal state.
 * @param {{ agentId: string, agentData: object, convRow: { id: number, projectId: number, releaseId: number, projectVersionId: number|null, flow: string|null } }} params
 */
export async function runMigrateFrontendPhaseBFromPoller({ agentId, agentData, convRow }) {
  if (!convRow?.id || convRow.flow !== FIGMA_CONVERSION_FLOW_MIGRATE_FRONTEND) return;
  if (convRow.projectVersionId != null) return;

  const id = String(agentId || "").trim();
  if (!id) return;
  if (migratePropagationInFlight.has(id)) return;
  migratePropagationInFlight.add(id);

  try {
    await runMigrateFrontendPropagation({
      agentId: id,
      agentData,
      figmaConversionId: convRow.id,
    });
  } finally {
    migratePropagationInFlight.delete(id);
  }
}

/**
 * Clone dev repo at agent branch (no submodules), copy only the resolved integration UI dir into platform launchpad tree, push, tag + deploy.
 */
async function runMigrateFrontendPropagation({ agentId, agentData, figmaConversionId }) {
  const conversion = await prisma.figmaConversion.findFirst({
    where: { id: figmaConversionId, agentId, flow: FIGMA_CONVERSION_FLOW_MIGRATE_FRONTEND },
    select: {
      id: true,
      projectId: true,
      releaseId: true,
      attemptedById: true,
      projectVersionId: true,
      migrateTargetProjectVersionId: true,
      migrateFrontend: true,
    },
  });
  if (!conversion || conversion.projectVersionId != null) return;

  const headBranch =
    typeof agentData?.target?.branchName === "string"
      ? agentData.target.branchName.trim()
      : "";
  if (!headBranch) {
    throw new Error("Migrate Frontend: agent has no target branch name");
  }

  const project = await prisma.project.findUnique({
    where: { id: conversion.projectId },
    select: {
      id: true,
      developmentRepoUrl: true,
      gitRepoPath: true,
      githubUsername: true,
      githubToken: true,
      githubConnectionId: true,
      bitbucketUsername: true,
      bitbucketToken: true,
      bitbucketConnectionId: true,
      createdById: true,
    },
  });
  if (!project?.developmentRepoUrl?.trim() || !project.gitRepoPath?.trim()) {
    throw new Error("Migrate Frontend: project missing developer or platform repo");
  }

  const devParsed = parseScmRepoPath(project.developmentRepoUrl);
  if (!devParsed || devParsed.provider !== "github") {
    throw new Error("Migrate Frontend: developer repo must be GitHub");
  }

  const platParsed = parseScmRepoPath(project.gitRepoPath);
  if (!platParsed) {
    throw new Error("Migrate Frontend: invalid platform gitRepoPath");
  }

  const ghCreds = await resolveGithubCredentialsFromProject(project);
  const platScm = await resolveScmCredentialsFromProject(project);
  if (platScm.provider !== platParsed.provider) {
    throw new Error("Migrate Frontend: platform host does not match project credentials");
  }

  const { owner: devOwner, repo: devRepo } = devParsed;
  const devToken = ghCreds.githubToken;
  const devUser = ghCreds.githubUsername;

  let devTipSha =
    (await waitForAgentBranchTipSha({
      provider: "github",
      owner: devOwner,
      repo: devRepo,
      branch: headBranch,
      token: devToken,
    })) || null;

  if (!devTipSha) {
    const tip = await scmGetBranchSha("github", devOwner, devRepo, headBranch, devToken);
    devTipSha = tip?.sha || null;
  }
  if (!devTipSha) {
    throw new Error("Migrate Frontend: could not resolve agent branch tip on developer repo");
  }

  const platformSubdir = normalizePlatformSubdirEnv();
  const { owner, repo, provider } = platParsed;
  const token = platScm.token;
  const platUsername = platScm.username;

  const backendRoot = getBackendRoot();
  const workRoot = path.join(
    backendRoot,
    "_tmp_migrate_frontend",
    `${conversion.projectId}_${conversion.releaseId}_${Date.now()}`,
  );

  await fs.ensureDir(workRoot);

  const devDir = path.join(workRoot, "dev");
  const platDir = path.join(workRoot, "platform");

  try {
    const devCloneUrl = authenticatedCloneUrl(
      { owner: devOwner, repo: devRepo },
      devToken,
      devUser,
    );
    if (!devCloneUrl) {
      throw new Error("Migrate Frontend: could not build authenticated clone URL for dev repo");
    }

    await git(workRoot, [
      "clone",
      "--recurse-submodules=no",
      "--no-checkout",
      devCloneUrl,
      "dev",
    ]);
    await configureGithubHttpExtraHeader(devDir, devToken, devUser);
    await git(devDir, ["fetch", "origin", headBranch]);
    await git(devDir, ["checkout", "-B", headBranch, `origin/${headBranch}`]);

    const sourceRel = await resolveDevUiSourceRelPath(devDir);
    const destRel = resolvePlatformUiDestRel(sourceRel);
    const devUiRoot = path.join(devDir, sourceRel);

    const platCloneUrl =
      provider === "github"
        ? `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`
        : `https://x-token-auth:${encodeURIComponent(token)}@bitbucket.org/${owner}/${repo}.git`;

    await git(workRoot, ["clone", platCloneUrl, "platform"]);

    if (provider === "github") {
      await configureGithubHttpExtraHeader(platDir, token, platUsername);
    }

    const metaPlat = await scmGetRepositoryMetadata(provider, owner, repo, token);
    const defaultBranch =
      metaPlat.ok && metaPlat.defaultBranch?.trim()
        ? metaPlat.defaultBranch.trim()
        : "main";

    const lpRemote = await scmGetBranchSha(provider, owner, repo, "launchpad", token);
    if (lpRemote?.sha) {
      await git(platDir, ["fetch", "origin", "launchpad"]);
      await git(platDir, ["checkout", "-B", "launchpad", "origin/launchpad"]);
    } else {
      await git(platDir, ["fetch", "origin", defaultBranch]);
      await git(platDir, ["checkout", "-B", "launchpad", `origin/${defaultBranch}`]);
    }

    const destBase = path.join(platDir, platformSubdir);
    const destUiRoot = path.join(destBase, destRel);
    await fs.ensureDir(destBase);
    const mergeTargetSummary = formatPlatformMergeTargetSummary(platformSubdir, destRel);
    await mergeUiTreeIntoPlatform(devUiRoot, destUiRoot);

    const copyTargets = [mergeTargetSummary];

    await git(platDir, ["add", "-A"]);
    const statusPorcelain = await git(platDir, ["status", "--porcelain"]);
    if (!String(statusPorcelain.stdout || "").trim()) {
      throw new Error(
        `Migrate Frontend: no changes to commit — contents of ${sourceRel}/ already match platform at ${mergeTargetSummary}.`,
      );
    }
    const commitSubject = `chore: merge UI ${sourceRel}/* → ${mergeTargetSummary} from dev ${devOwner}/${devRepo} @ ${devTipSha.slice(0, 12)}`;
    await git(platDir, [
      "-c",
      "user.email=migrate-frontend@noreply.local",
      "-c",
      "user.name=Migrate Frontend",
      "commit",
      "-m",
      commitSubject,
    ]);

    await git(platDir, ["push", "origin", "HEAD:launchpad"]);

    const rev = await git(platDir, ["rev-parse", "HEAD"]);
    const newSha = String(rev.stdout || "").trim();
    if (!newSha) {
      throw new Error("Migrate Frontend: could not read new platform commit SHA");
    }

    const uploader = await prisma.user.findUnique({
      where: { id: conversion.attemptedById },
      select: { email: true },
    });
    const email = uploader?.email ? String(uploader.email).trim() : null;

    const relTargetSummary = copyTargets.join(", ");

    let targetRevisionMeta = null;
    const targetVid = conversion.migrateTargetProjectVersionId;
    if (targetVid != null) {
      const tv = await prisma.projectVersion.findUnique({
        where: { id: targetVid },
        select: { version: true, gitTag: true },
      });
      if (tv) {
        targetRevisionMeta = { version: tv.version, gitTag: tv.gitTag };
      }
    }

    await prisma.releaseChangeLog.create({
      data: {
        releaseId: conversion.releaseId,
        reason: "Migrate Frontend (developer repo → platform launchpad)",
        changedById: conversion.attemptedById,
        changedByEmail: email,
        changes: {
          migrateFrontend: {
            from: `${devOwner}/${devRepo} branch ${headBranch} @ ${devTipSha.slice(0, 7)}`,
            to: `Platform ${owner}/${repo} launchpad @ ${newSha.slice(0, 7)} (paths: ${relTargetSummary})`,
            ...(targetRevisionMeta
              ? { targetRevision: targetRevisionMeta }
              : {}),
          },
        },
      },
    });

    const reuseRevision = conversion.migrateTargetProjectVersionId != null;
    const disclaimerAck = Boolean(conversion.migrateFrontend);
    try {
      await executeLaunchpadHeadDeploy(conversion, newSha, headBranch, {
        skipShaDedupe: true,
        reuseExistingReleaseTag: reuseRevision,
        explicitAnchorProjectVersionId: reuseRevision
          ? conversion.migrateTargetProjectVersionId
          : null,
      });
    } catch (deployErr) {
      await markScratchVersionFailedIfCreating(conversion.projectId);
      throw deployErr;
    }

    const { syncProjectActiveVersionForProject } = await import(
      "./release.service.js",
    );
    await prisma.$transaction(async (tx) => {
      await syncProjectActiveVersionForProject(tx, conversion.projectId);
    });

    if (disclaimerAck) {
      const convAfter = await prisma.figmaConversion.findUnique({
        where: { id: conversion.id },
        select: { projectVersionId: true },
      });
      const mergedVersionId = convAfter?.projectVersionId;
      if (mergedVersionId != null) {
        await prisma.projectVersion.updateMany({
          where: {
            id: mergedVersionId,
            projectId: conversion.projectId,
          },
          data: { migrateFrontend: true },
        });
      }
    }
  } finally {
    await fs.remove(workRoot).catch(() => {});
  }
}
