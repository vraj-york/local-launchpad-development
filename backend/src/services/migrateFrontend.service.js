import path from "path";
import fs from "fs-extra";
import { randomUUID } from "crypto";
import { ReleaseStatus } from "@prisma/client";
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
import {
  executeLaunchpadHeadDeploy,
  markScratchVersionFailedIfCreating,
  isReadonlyMigrateAgentId,
  READONLY_MIGRATE_AGENT_PREFIX,
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

/**
 * Prefer conventional names, then other common monorepo / app roots.
 * Submodules are not cloned or copied.
 */
const UI_ROOT_CANDIDATES = [
  "frontend",
  "Frontend",
  "client",
  "web",
  "ui",
  "app",
  "www",
  "site",
  "portal",
  "website",
  "apps/web",
  "apps/client",
  "apps/frontend",
  "packages/web",
  "packages/app",
  "packages/client",
  "packages/ui",
];

const SKIP_TOP_LEVEL_DIR = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  "tmp",
  "temp",
  "__MACOSX",
]);

/**
 * @param {string} absDir
 * @returns {Promise<object|null>}
 */
async function readPackageJson(absDir) {
  const p = path.join(absDir, "package.json");
  if (!(await fs.pathExists(p))) return null;
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Heuristic: directory looks like an app/UI package (react, vue, vite, next, etc.).
 * @param {object|null} pkg
 */
function packageLooksLikeAppUi(pkg) {
  if (!pkg || typeof pkg !== "object") return false;
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const keys = Object.keys(deps).join(" ").toLowerCase();
  if (
    /react|vue|svelte|angular|@angular|next|nuxt|vite|webpack|remix|astro|solid-js|preact|gatsby|ember/.test(
      keys,
    )
  ) {
    return true;
  }
  if (pkg.scripts && typeof pkg.scripts === "object") {
    const s = Object.values(pkg.scripts).join(" ").toLowerCase();
    if (/vite|next|nuxt|webpack|react-scripts|astro|remix/.test(s)) return true;
  }
  return false;
}

/**
 * @param {string} absDir
 * @returns {Promise<number>}
 */
async function scoreUiCandidate(absDir) {
  const pkg = await readPackageJson(absDir);
  if (!pkg || !packageLooksLikeAppUi(pkg)) return 0;
  if (!(await dirHasMigratableContent(absDir))) return 0;
  return 10;
}

/**
 * Discover integration UI root when no env override and no conventional folder name.
 * Prefers nested apps/* / packages/* with a UI-looking package.json, then other top-level dirs, then repo root.
 * @param {string} devDir
 * @returns {Promise<string|null>} repo-relative path using `/` ("" = repo root)
 */
async function discoverUiRootHeuristic(devDir) {
  let best = { score: 0, rel: "" };
  const nestedPrefixes = ["apps", "packages", "projects", "services"];

  for (const prefix of nestedPrefixes) {
    const base = path.join(devDir, prefix);
    if (!(await fs.pathExists(base))) continue;
    const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const name = ent.name;
      if (name.startsWith(".") || SKIP_TOP_LEVEL_DIR.has(name)) continue;
      const abs = path.join(base, name);
      const score = await scoreUiCandidate(abs);
      const rel = path.posix.join(prefix, name);
      if (score > best.score) best = { score, rel };
    }
  }
  if (best.score > 0) return best.rel;

  const top = await fs.readdir(devDir, { withFileTypes: true }).catch(() => []);
  for (const ent of top) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    if (name.startsWith(".") || SKIP_TOP_LEVEL_DIR.has(name)) continue;
    if (nestedPrefixes.includes(name)) continue;
    const abs = path.join(devDir, name);
    const score = await scoreUiCandidate(abs);
    if (score > best.score) best = { score, rel: name };
  }
  if (best.score > 0) return best.rel;

  const rootPkg = await readPackageJson(devDir);
  if (rootPkg && packageLooksLikeAppUi(rootPkg) && (await dirHasMigratableContent(devDir))) {
    return "";
  }
  return null;
}

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
    return envPath.split(path.sep).join("/");
  }
  for (const rel of UI_ROOT_CANDIDATES) {
    const abs = path.join(devDir, ...rel.split("/"));
    if (await fs.pathExists(abs)) {
      const st = await fs.stat(abs).catch(() => null);
      if (st?.isDirectory() && (await dirHasMigratableContent(abs))) {
        return rel;
      }
    }
  }

  const discovered = await discoverUiRootHeuristic(devDir);
  if (discovered !== null) return discovered;

  throw new ApiError(
    400,
    `Could not find an integration UI directory in the developer repository (tried common names under apps/, packages/, and package.json heuristics). ` +
      "Set MIGRATE_FRONTEND_SOURCE_DIR to the correct relative path (e.g. apps/your-app), or ensure the Cursor agent pushed a UI tree with a recognizable frontend stack.",
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

/** Skip backend-ish / CI / env paths when copying the integration UI tree (POSIX rel under UI root). */
function isExcludedFromFrontendMigrateCopy(relPosix, isDir) {
  const parts = String(relPosix || "")
    .split("/")
    .filter(Boolean);
  const lowerParts = parts.map((p) => p.toLowerCase());
  for (const p of lowerParts) {
    if (
      p === "node_modules" ||
      p === ".git" ||
      p === ".github" ||
      p === ".husky" ||
      p === ".circleci" ||
      p === "coverage" ||
      p === "cypress" ||
      p === "playwright-report" ||
      p === "test-results"
    ) {
      return true;
    }
  }
  if (!isDir && parts.length) {
    const leaf = parts[parts.length - 1].toLowerCase();
    if (
      leaf === "dockerfile" ||
      leaf === "docker-compose.yml" ||
      leaf === "docker-compose.yaml" ||
      leaf === "jenkinsfile" ||
      leaf === ".gitlab-ci.yml" ||
      leaf === ".travis.yml"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Merge dev UI tree **into** an existing platform directory: add/overwrite files, do not delete
 * destination paths missing from the source. Skips nested `.git` and sensitive leaf names.
 * @param {string} srcDir — resolved dev UI root (e.g. …/dev/Frontend)
 * @param {string} destDir — platform target directory (e.g. …/platform or …/platform/apps/web)
 * @param {string} platGitRoot — absolute root of the platform git clone (for `git add -f` paths)
 * @returns {Promise<string[]>} repo-relative POSIX paths for each file or symlink written
 */
async function mergeUiTreeIntoPlatform(srcDir, destDir, platGitRoot) {
  const platResolved = path.resolve(platGitRoot);
  const written = [];
  function recordWritten(absTo) {
    const rel = path.relative(platResolved, path.resolve(absTo));
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;
    written.push(rel.split(path.sep).join("/"));
  }

  await fs.mkdir(destDir, { recursive: true });
  async function walk(rel) {
    const abs = path.join(srcDir, rel);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const ent of entries) {
      const name = ent.name;
      if (name === ".git") continue;
      if (isSensitiveMigrateLeafName(name)) continue;
      const relChild = rel ? path.join(rel, name) : name;
      const relPosix = relChild.split(path.sep).join("/");
      if (isExcludedFromFrontendMigrateCopy(relPosix, ent.isDirectory())) continue;
      const from = path.join(srcDir, relChild);
      const to = path.join(destDir, relChild);
      if (ent.isDirectory()) {
        await fs.mkdir(to, { recursive: true });
        await walk(relChild);
      } else if (ent.isSymbolicLink()) {
        const link = await fs.readlink(from);
        await fs.remove(to).catch(() => {});
        await fs.symlink(link, to);
        recordWritten(to);
      } else {
        await fs.ensureDir(path.dirname(to));
        await fs.copyFile(from, to);
        recordWritten(to);
      }
    }
  }
  await walk("");
  return written;
}

/** Stage migrated paths even when the platform repo `.gitignore` would otherwise hide them. */
async function gitAddMergedPaths(platDir, repoRelPaths) {
  const uniq = [...new Set(repoRelPaths.filter(Boolean))];
  const BATCH = 80;
  for (let i = 0; i < uniq.length; i += BATCH) {
    const batch = uniq.slice(i, i + BATCH);
    await git(platDir, ["add", "-f", ...batch]);
  }
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
    (typeof CURSOR_AGENT_SOURCE_REF_ENV === "string" && CURSOR_AGENT_SOURCE_REF_ENV.trim()
      ? CURSOR_AGENT_SOURCE_REF_ENV.trim()
      : null) ||
    (meta.defaultBranch && String(meta.defaultBranch).trim()) ||
    "main";

  const agentId = `${READONLY_MIGRATE_AGENT_PREFIX}${randomUUID()}`;
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
      status: "READONLY_QUEUED",
      targetBranchName: refBranch,
      deferLaunchpadMerge: false,
      awaitingLaunchpadConfirmation: false,
      skipLaunchpadAutomation: false,
      flow: FIGMA_CONVERSION_FLOW_MIGRATE_FRONTEND,
      migrateTargetProjectVersionId,
      migrateFrontend: migrateFrontendAck,
    },
  });

  const cid = created.id;
  setImmediate(() => {
    void (async () => {
      try {
        await prisma.figmaConversion.update({
          where: { id: cid },
          data: { status: "READONLY_SYNCING" },
        });
        await runMigrateFrontendPropagation({
          agentId,
          agentData: null,
          figmaConversionId: cid,
        });
      } catch (err) {
        console.error("[migrate-frontend] read-only propagation failed", {
          figmaConversionId: cid,
          error: err?.message || err,
        });
        await prisma.figmaConversion.updateMany({
          where: { id: cid, projectVersionId: null },
          data: { status: "MIGRATE_PLATFORM_SYNC_FAILED" },
        });
      }
    })();
  });

  return {
    agentId,
    figmaConversionId: created.id,
  };
}

/**
 * Called from cursor.service poller when a migrate_frontend agent reaches a success terminal state.
 * @param {{ agentId: string, agentData: object, convRow: { id: number, projectId: number, releaseId: number, projectVersionId: number|null, flow: string|null } }} params
 */
function normalizeMigrateFlowValue(flow) {
  return String(flow ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export async function runMigrateFrontendPhaseBFromPoller({ agentId, agentData, convRow }) {
  if (!convRow?.id || normalizeMigrateFlowValue(convRow.flow) !== FIGMA_CONVERSION_FLOW_MIGRATE_FRONTEND)
    return;
  if (convRow.projectVersionId != null) return;

  const id = String(agentId || "").trim();
  if (!id) return;
  if (isReadonlyMigrateAgentId(id)) return;
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
      agentId: true,
      targetBranchName: true,
    },
  });
  if (!conversion || conversion.projectVersionId != null) return;

  const readonly = isReadonlyMigrateAgentId(String(conversion.agentId || ""));
  let headBranch = "";
  if (readonly) {
    headBranch = String(conversion.targetBranchName || "").trim();
    if (!headBranch) {
      throw new Error("Migrate Frontend: missing developer ref (targetBranchName) for read-only migration");
    }
  } else {
    headBranch =
      typeof agentData?.target?.branchName === "string"
        ? agentData.target.branchName.trim()
        : "";
    if (!headBranch) {
      throw new Error("Migrate Frontend: agent has no target branch name");
    }
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

  let devTipSha = null;
  if (readonly) {
    const tip = await scmGetBranchSha("github", devOwner, devRepo, headBranch, devToken);
    devTipSha = tip?.sha || null;
  } else {
    devTipSha =
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
  }
  if (!devTipSha) {
    throw new Error(
      readonly
        ? "Migrate Frontend: could not resolve developer branch tip (read-only clone)"
        : "Migrate Frontend: could not resolve agent branch tip on developer repo",
    );
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
    if (readonly) {
      await git(devDir, ["checkout", "--detach", `origin/${headBranch}`]);
    } else {
      await git(devDir, ["checkout", "-B", headBranch, `origin/${headBranch}`]);
    }

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

    const migrateBranchName = `migrate-ui/r${conversion.releaseId}-${Date.now().toString(36)}`;
    const lpRemote = await scmGetBranchSha(provider, owner, repo, "launchpad", token);
    if (lpRemote?.sha) {
      await git(platDir, ["fetch", "origin", "launchpad"]);
      await git(platDir, ["checkout", "--detach", "origin/launchpad"]);
    } else {
      await git(platDir, ["fetch", "origin", defaultBranch]);
      await git(platDir, ["checkout", "--detach", `origin/${defaultBranch}`]);
    }

    await git(platDir, ["checkout", "-B", migrateBranchName]);

    const destBase = path.join(platDir, platformSubdir);
    const destUiRoot = path.join(destBase, destRel);
    await fs.ensureDir(destBase);
    const mergeTargetSummary = formatPlatformMergeTargetSummary(platformSubdir, destRel);
    const mergedRelPaths = await mergeUiTreeIntoPlatform(devUiRoot, destUiRoot, platDir);

    const copyTargets = [mergeTargetSummary];

    await git(platDir, ["add", "-A"]);
    if (mergedRelPaths.length) {
      await gitAddMergedPaths(platDir, mergedRelPaths);
    }
    const statusPorcelain = await git(platDir, ["status", "--porcelain"]);
    if (!String(statusPorcelain.stdout || "").trim()) {
      throw new Error(
        `Migrate Frontend: no changes to commit after merge (${mergedRelPaths.length} file(s) copied). ` +
          `Usually: (1) dev UI at "${sourceRel}/" already matches platform at "${mergeTargetSummary}", ` +
          `(2) set MIGRATE_FRONTEND_SOURCE_DIR / MIGRATE_FRONTEND_DEST_REL / MIGRATE_FRONTEND_PLATFORM_SUBDIR if paths are wrong. ` +
          (readonly
            ? "The developer repository was only read (no push)."
            : "Confirm the Cursor agent pushed commits to the developer branch."),
      );
    }
    const commitSubject = readonly
      ? `chore(migrate-ui): ${sourceRel}/* → ${mergeTargetSummary} from ${devOwner}/${devRepo}@${headBranch}@${devTipSha.slice(0, 12)} (read-only)`
      : `chore: merge UI ${sourceRel}/* → ${mergeTargetSummary} from dev ${devOwner}/${devRepo} @ ${devTipSha.slice(0, 12)}`;
    await git(platDir, [
      "-c",
      "user.email=migrate-frontend@noreply.local",
      "-c",
      "user.name=Migrate Frontend",
      "commit",
      "-m",
      commitSubject,
    ]);

    if (readonly) {
      await git(platDir, ["push", "origin", `HEAD:refs/heads/${migrateBranchName}`]);
    } else {
      await git(platDir, ["push", "origin", "HEAD:launchpad"]);
    }

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
            from: readonly
              ? `${devOwner}/${devRepo} read-only @ ${headBranch} (${devTipSha.slice(0, 7)})`
              : `${devOwner}/${devRepo} branch ${headBranch} @ ${devTipSha.slice(0, 7)}`,
            to: readonly
              ? `Platform ${owner}/${repo} branches ${migrateBranchName} + launchpad @ ${newSha.slice(0, 7)} (paths: ${relTargetSummary})`
              : `Platform ${owner}/${repo} launchpad @ ${newSha.slice(0, 7)} (paths: ${relTargetSummary})`,
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
      await executeLaunchpadHeadDeploy(
        conversion,
        newSha,
        headBranch,
        {
          skipShaDedupe: true,
          reuseExistingReleaseTag: reuseRevision,
          explicitAnchorProjectVersionId: reuseRevision
            ? conversion.migrateTargetProjectVersionId
            : null,
        },
      );
    } catch (deployErr) {
      await markScratchVersionFailedIfCreating(conversion.projectId);
      throw deployErr;
    }

    const { setReleaseStatusService, syncProjectActiveVersionForProject } =
      await import("./release.service.js");

    /** Single-release projects: after first Migrate Frontend, make that release + latest version live. */
    let activatedSoleDraftRelease = false;
    const releaseCount = await prisma.release.count({
      where: { projectId: conversion.projectId },
    });
    if (releaseCount === 1) {
      const rel = await prisma.release.findFirst({
        where: { id: conversion.releaseId, projectId: conversion.projectId },
        select: { id: true, status: true },
      });
      if (rel?.status === ReleaseStatus.draft) {
        const actor = await prisma.user.findUnique({
          where: { id: conversion.attemptedById },
          select: { id: true, email: true, role: true },
        });
        if (actor?.id) {
          await setReleaseStatusService(
            conversion.releaseId,
            ReleaseStatus.active,
            actor,
            {
              reason:
                "First release: activated automatically after Migrate Frontend completed.",
            },
          );
          activatedSoleDraftRelease = true;
        }
      }
    }
    if (!activatedSoleDraftRelease) {
      await prisma.$transaction(async (tx) => {
        await syncProjectActiveVersionForProject(tx, conversion.projectId);
      });
    }

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
