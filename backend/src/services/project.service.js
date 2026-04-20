import { ReleaseStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import ApiError from "../utils/apiError.js";
import { fetchProjectJiraTickets } from "../utils/jiraIntegration.js";
import config from "../config/index.js";
import { getBackendRoot, getProjectsDir, getNginxConfigsDir, getNginxBaseDomain, getNginxUpstreamHost, getProjectLiveAbsolutePath } from "../utils/instanceRoot.js";
import axios from "axios";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { execSync, execFileSync, spawnSync } from "child_process";
import fsExtra from "fs-extra";
import os from 'os';
import fs from "fs-extra";
import { startProjectServer } from "../projectServers.js";
import { signalNginxReload } from "../utils/nginxBinary.js";
import {
  runBuildSequence,
  reloadNginx as reloadNginxRelease,
  createGithubRepo,
  addGithubCollaborator,
  findProjectRoot,
  setReleaseStatusService as applyReleaseStatus,
  createReleaseService,
  autoGenerateVersion,
} from "./release.service.js";
import { createAgentForProjectRelease } from "./cursor.service.js";
import { getRepositoryMetadata, parseGitRepoPath } from "./github.service.js";
import { parseScmRepoPath } from "../utils/scmPath.js";
import { API_BASE_URLS } from "../constants/contstants.js";
import {
  addBitbucketRepositoryCollaborator,
  createBitbucketRepository,
  getBitbucketRepositoryMetadata,
  getDefaultBitbucketWorkspace,
} from "./bitbucket.service.js";
import { projectRepoSlugFromDisplayName } from "../utils/projectValidation.utils.js";
import { normalizeOptionalEmailListString } from "../utils/emailList.utils.js";
import { parseStoredEmailListToSet } from "../utils/emailList.utils.js";
import { maskProjectSecrets } from "../utils/secretMasking.js";
import {
  assertBitbucketConnectionOwned,
  assertGithubConnectionOwned,
  assertJiraConnectionOwned,
  resolveGithubCredentialsFromProject,
  resolveJiraCredentialsFromProject,
  resolveScmCredentialsFromProject,
  jiraIntegrationConfigFromResolved,
} from "./integrationCredential.service.js";
import {
  ensureFreshBitbucketConnection,
  ensureFreshGithubConnection,
  ensureFreshJiraConnection,
  getIntegrationsStatus,
} from "./oauthConnection.service.js";
import { scheduleRegenerateClientReviewSummary } from "./releaseReviewSummary.service.js";
import { ensureLaunchpadPushWebhooksForProject } from "./launchpadScmWebhookRegister.service.js";
import { resolveGitSourceForNewClientChatAgent } from "./platformGitLine.service.js";

/**
 * Allocate a unique slug for Project.slug (DB unique). Tries base, then base-2, base-3, ...
 * @param {number} [excludeProjectId] - when updating, exclude this project from the collision check
 */
async function ensureUniqueProjectSlug(baseSlug, excludeProjectId) {
  let n = 0;
  while (n < 100000) {
    const candidate = n === 0 ? baseSlug : `${baseSlug}-${n}`;
    const taken = await prisma.project.findFirst({
      where: {
        slug: candidate,
        ...(excludeProjectId != null
          ? { id: { not: excludeProjectId } }
          : {}),
      },
      select: { id: true },
    });
    if (!taken) return candidate;
    n += 1;
  }
  throw new ApiError(500, "Could not allocate a unique project slug");
}

const PREVIEW_TTL_MS = 1 * 60 * 60 * 1000; // 1 hour
const PREVIEW_META_FILE = ".preview-meta.json";
const PREVIEW_CLEANUP_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const PREVIEW_LAST_CLEANUP_FILE = ".last-cleanup-at";
const previewBuildLocks = new Map(); // projectId -> Promise chain

const execAsync = promisify(exec);

function normalizeGitRepoPathValue(raw) {
  if (raw == null) return null;
  const parsed = parseScmRepoPath(String(raw));
  if (!parsed) return null;
  const host = parsed.provider === "bitbucket" ? "bitbucket.org" : "github.com";
  return `${host}/${parsed.owner}/${parsed.repo}`;
}

/** Authenticated clone/push URL for GitHub or Bitbucket canonical paths. */
function buildScmRemoteUrl(repoPath, token) {
  const parsed = parseScmRepoPath(String(repoPath || ""));
  const t = token?.trim();
  if (!parsed || !t) return null;
  if (parsed.provider === "github") {
    return `https://x-access-token:${t}@github.com/${parsed.owner}/${parsed.repo}.git`;
  }
  if (parsed.provider === "bitbucket") {
    return `https://x-token-auth:${t}@bitbucket.org/${parsed.owner}/${parsed.repo}.git`;
  }
  return null;
}

function listProjectVersionTags(rows) {
  return Array.from(
    new Set(
      (rows || [])
        .map((r) => (typeof r?.gitTag === "string" ? r.gitTag.trim() : ""))
        .filter(Boolean),
    ),
  );
}

/**
 * Invite GITHUB_DEFAULT_COLLABORATOR to a GitHub or Bitbucket repo (best-effort; logs on failure).
 * No invite is attempted when the env var is unset or blank.
 * @param {string|null|undefined} normalizedRepoPath - e.g. github.com/o/r or bitbucket.org/w/s
 * @param {string|null|undefined} hostToken - OAuth or PAT for the same host as the path
 */
async function inviteDefaultCollaboratorToPath(normalizedRepoPath, hostToken) {
  const token = hostToken?.trim();
  if (!normalizedRepoPath || !token) return;
  const parsed = parseScmRepoPath(normalizedRepoPath);
  if (!parsed) return;
  const defaultCollaborator = (
    process.env.GITHUB_DEFAULT_COLLABORATOR || ""
  ).trim();
  if (!defaultCollaborator) return;
  try {
    if (parsed.provider === "github") {
      const invited = await addGithubCollaborator(
        parsed.owner,
        parsed.repo,
        defaultCollaborator,
        token,
        "push",
      );
      if (!invited) {
        console.warn(
          `[default collaborator] GitHub invite skipped or failed for ${normalizedRepoPath}. Set GITHUB_DEFAULT_COLLABORATOR to a valid GitHub username.`,
        );
      }
    } else {
      const invited = await addBitbucketRepositoryCollaborator(
        parsed.owner,
        parsed.repo,
        defaultCollaborator,
        token,
      );
      if (!invited) {
        console.warn(
          `[default collaborator] Bitbucket invite skipped or failed for ${normalizedRepoPath}. Set GITHUB_DEFAULT_COLLABORATOR to a valid Bitbucket username.`,
        );
      }
    }
  } catch (e) {
    console.warn(`[default collaborator] ${e?.message || e}`);
  }
}

function ensureTagExistsInRemote(remoteUrl, tag, cwd) {
  const output = execFileSync(
    "git",
    ["ls-remote", "--tags", remoteUrl, `refs/tags/${tag}`],
    { cwd, encoding: "utf8", timeout: 120000 },
  ).trim();
  if (!output) {
    throw new ApiError(
      400,
      `Repository migration failed: required tag "${tag}" is missing on destination repository.`,
    );
  }
}

function migrateProjectRepositoryRefs({
  oldGitRepoPath,
  newGitRepoPath,
  githubToken,
  requiredTags,
  backendRoot,
  projectId,
}) {
  if (!oldGitRepoPath || !newGitRepoPath || oldGitRepoPath === newGitRepoPath) return;

  const oldParsed = parseScmRepoPath(String(oldGitRepoPath));
  const newParsed = parseScmRepoPath(String(newGitRepoPath));
  if (!oldParsed || !newParsed || oldParsed.provider !== newParsed.provider) {
    throw new ApiError(
      400,
      "Repository migration failed: source and destination must be on the same code host (GitHub or Bitbucket).",
    );
  }

  const oldRemoteUrl = buildScmRemoteUrl(oldGitRepoPath, githubToken);
  const newRemoteUrl = buildScmRemoteUrl(newGitRepoPath, githubToken);
  if (!oldRemoteUrl || !newRemoteUrl) {
    throw new ApiError(
      400,
      "Repository migration failed: valid repository path and host token are required.",
    );
  }

  const migrationRoot = path.join(
    backendRoot,
    "_tmp_repo_migrations",
    `project_${projectId}_${Date.now()}`,
  );
  const bareMirrorDir = path.join(migrationRoot, "mirror.git");
  fsExtra.ensureDirSync(migrationRoot);
  const tryNonDestructivePush = (args) => {
    try {
      execFileSync("git", args, {
        cwd: backendRoot,
        encoding: "utf8",
        timeout: 300000,
      });
      return true;
    } catch (e) {
      // Non-fast-forward/tag-already-exists errors are expected in non-destructive migration.
      console.warn(
        `[repo-migration] non-destructive push skipped some refs: ${e?.message || e}`,
      );
      return false;
    }
  };
  try {
    execFileSync("git", ["init", "--bare", bareMirrorDir], {
      cwd: backendRoot,
      encoding: "utf8",
      timeout: 120000,
    });
    execFileSync("git", ["--git-dir", bareMirrorDir, "remote", "add", "old-origin", oldRemoteUrl], {
      cwd: backendRoot,
      encoding: "utf8",
      timeout: 120000,
    });
    execFileSync("git", ["--git-dir", bareMirrorDir, "remote", "add", "new-origin", newRemoteUrl], {
      cwd: backendRoot,
      encoding: "utf8",
      timeout: 120000,
    });
    execFileSync(
      "git",
      [
        "--git-dir",
        bareMirrorDir,
        "fetch",
        "--prune",
        "old-origin",
        "+refs/heads/*:refs/heads/*",
        "+refs/tags/*:refs/tags/*",
      ],
      { cwd: backendRoot, encoding: "utf8", timeout: 300000 },
    );
    // Non-destructive migration: push available branches/tags without deleting or force-overwriting
    // existing destination refs.
    tryNonDestructivePush(["--git-dir", bareMirrorDir, "push", "new-origin", "--all"]);
    tryNonDestructivePush(["--git-dir", bareMirrorDir, "push", "new-origin", "--tags"]);
    for (const tag of requiredTags) {
      ensureTagExistsInRemote(newRemoteUrl, tag, backendRoot);
    }
  } catch (error) {
    throw new ApiError(
      400,
      `Repository migration failed: ${error?.message || "unable to mirror refs"}`,
    );
  } finally {
    fsExtra.removeSync(migrationRoot);
  }
}

function refreshSharedGitCacheRemote(gitRepoPath, githubToken, backendRoot) {
  const gitDir = path.join(getProjectsDir(), ".git");
  if (!fsExtra.existsSync(gitDir)) return;
  const remoteUrl = buildScmRemoteUrl(gitRepoPath, githubToken);
  if (!remoteUrl) return;
  try {
    execFileSync("git", ["--git-dir", gitDir, "remote", "set-url", "origin", remoteUrl], {
      cwd: backendRoot,
      encoding: "utf8",
      timeout: 60000,
    });
    execFileSync("git", ["--git-dir", gitDir, "fetch", "--prune", "--tags", "origin"], {
      cwd: backendRoot,
      encoding: "utf8",
      timeout: 180000,
    });
  } catch (e) {
    console.warn("[updateProject] shared projects/.git refresh failed:", e?.message || e);
  }
}

/**
 * Serialize preview builds per project to avoid hash mismatches/404s caused by
 * concurrent writes to the same _preview/project_<id>/serve directory.
 */
async function withPreviewBuildLock(projectId, task) {
  const key = Number(projectId);
  const previous = previewBuildLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => { }).then(task);
  const chain = current.finally(() => {
    if (previewBuildLocks.get(key) === chain) {
      previewBuildLocks.delete(key);
    }
  });
  previewBuildLocks.set(key, chain);
  return current;
}

/** UFW needs sudo; Docker images often have no sudo — skip to avoid noisy warnings. */
function shouldSkipUfw() {
  try {
    if (fs.existsSync("/.dockerenv")) return true;
    execSync("command -v sudo", { stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
}

function runCommand(command, cwd, options = {}) {
  return execSync(command, {
    cwd,
    encoding: "utf-8",
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
}

/**
 * Remove a local tag in the projects bare/cached repo before fetching from GitHub.
 * Fixes: ! [rejected] tag -> tag (would clobber existing tag) when local tag points at a
 * different commit than remote (e.g. after Cursor merge / tag moves). Remote is source of truth.
 */
function deleteLocalGitTag(gitDir, tag) {
  if (!gitDir || !tag) return;
  try {
    execFileSync("git", ["--git-dir", gitDir, "tag", "-d", tag], {
      stdio: "ignore",
      timeout: 30000,
    });
  } catch {
    // Tag may not exist locally — safe to ignore
  }
}

/**
 * Shared access check (PRIVATE helper inside same service)
 */
export async function assertProjectAccess(projectId, user) {
  const project = await prisma.project.findUnique({
    where: { id: Number(projectId) },
    select: { id: true, createdById: true, assignedUserEmails: true },
  });

  if (!project) {
    throw new ApiError(404, "Project not found");
  }

  const { role, id: userId } = user;

  if (role === "admin") {
    return project;
  }

  if (Number(project.createdById) === Number(userId)) {
    return project;
  }

  const email = await resolveUserEmail(user);
  const assignedUsers = parseStoredEmailListToSet(project.assignedUserEmails);
  if (email && assignedUsers.has(email)) {
    return project;
  }

  throw new ApiError(403, "Forbidden");
}

async function resolveUserEmail(user) {
  const direct = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
  if (direct) return direct;
  if (!user?.id) return null;
  const row = await prisma.user.findUnique({
    where: { id: Number(user.id) },
    select: { email: true },
  });
  return row?.email ? String(row.email).trim().toLowerCase() : null;
}

/**
 * Integration connection list for the project creator (same shape as GET /api/integrations/status).
 * Caller must be project creator or admin; must have project access.
 */
export async function getCreatorIntegrationConnectionsForEditor(projectId, user) {
  await assertProjectAccess(projectId, user);
  const project = await prisma.project.findUnique({
    where: { id: Number(projectId) },
    select: { createdById: true },
  });
  if (!project) {
    throw new ApiError(404, "Project not found");
  }
  const allowed =
    user.role === "admin" || Number(user.id) === Number(project.createdById);
  if (!allowed) {
    throw new ApiError(
      403,
      "Only the project creator or an admin can load creator integration connections",
    );
  }
  return getIntegrationsStatus(project.createdById);
}

export async function assertProjectReadAccess(projectId, user) {
  const project = await prisma.project.findUnique({
    where: { id: Number(projectId) },
    select: { id: true, createdById: true, assignedUserEmails: true },
  });
  if (!project) {
    throw new ApiError(404, "Project not found");
  }

  const { role, id: userId } = user || {};
  if (role === "admin") return project;
  if (Number(project.createdById) === Number(userId)) return project;

  const email = await resolveUserEmail(user);
  const assignedUsers = parseStoredEmailListToSet(project.assignedUserEmails);
  if (email && assignedUsers.has(email)) {
    return project;
  }
  throw new ApiError(403, "Forbidden");
}

/** Allow admin, project creator, or listed assignee emails to delete. */
export async function assertProjectDeleteAccess(projectId, user) {
  const project = await prisma.project.findUnique({
    where: { id: Number(projectId) },
    select: { id: true, createdById: true, assignedUserEmails: true },
  });
  if (!project) throw new ApiError(404, "Project not found");
  const { role, id: userId } = user;
  const allowed =
    role === "admin" || Number(project.createdById) === Number(userId);
  if (allowed) return project;
  const email = await resolveUserEmail(user);
  const assignedUsers = parseStoredEmailListToSet(project.assignedUserEmails);
  if (email && assignedUsers.has(email)) return project;
  throw new ApiError(403, "Forbidden");
}

const validateGithubConnection = async (username, token) => {
  try {
    await axios.get(`${API_BASE_URLS.GITHUB}/users/${encodeURIComponent(username)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
  } catch (error) {
    throw new ApiError(400, "Invalid GitHub credentials or username.");
  }
};

/**
 * @param {string} [oauthAccessToken] - If set, uses Bearer (Atlassian 3LO)
 * @param {string} [atlassianCloudId] - Required for 3LO: REST calls go via api.atlassian.com/ex/jira/{cloudId}
 */
const validateJiraConnection = async (
  baseUrl,
  projectKey,
  email,
  apiToken,
  oauthAccessToken,
  atlassianCloudId,
) => {
  const key = encodeURIComponent(projectKey);
  let url;
  const headers = oauthAccessToken
    ? {
      Authorization: `Bearer ${oauthAccessToken}`,
      Accept: "application/json",
    }
    : {
        Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
        Accept: "application/json",
        "X-Atlassian-Token": "no-check",
      };
  if (oauthAccessToken) {
    const cloud = atlassianCloudId && String(atlassianCloudId).trim();
    if (!cloud) {
      throw new ApiError(
        400,
        "Jira OAuth is missing Atlassian cloud id. Reconnect Jira under Integrations, then retry.",
      );
    }
    url = `${API_BASE_URLS.ATLASSIAN}/ex/jira/${encodeURIComponent(cloud)}/rest/api/3/project/${key}`;
  } else {
    url = `${baseUrl.replace(/\/$/, "")}/rest/api/2/project/${key}`;
  }

  try {
    await axios.get(url, { headers });
  } catch (error) {
    const msg =
      error.response?.data?.errorMessages?.[0] ||
      error.response?.data?.message ||
      error.message ||
      "Check credentials";
    throw new ApiError(400, `Jira Validation Failed: ${msg}`);
  }
};
/**
 * create project
 */
function generateNginxConfigTemplate(projectName, port) {
  const baseDomain = getNginxBaseDomain();
  const upstreamHost = getNginxUpstreamHost();
  const serverName = `${projectName}.${baseDomain}`;
  return `# Nginx configuration for ${projectName} (dynamic port ${port})
server {
    listen 80;
    server_name ${serverName};
    
    location / {
        proxy_pass http://${upstreamHost}:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        add_header X-Release-Version \$upstream_http_x_release_version;
    }

    location /health {
        access_log off;
        return 200 "healthy\\n";
        add_header Content-Type text/plain;
    }

    access_log /var/log/nginx/${projectName}_access.log;
    error_log /var/log/nginx/${projectName}_error.log;
}`;
}


/**
 * Automatically opens a specific port on the Linux firewall (UFW).
 * @param {number} port - The project's assigned port (e.g., 8001)
 */
export const allowPortThroughFirewall = async (port) => {
  if (shouldSkipUfw()) {
    return false;
  }
  try {
    // 1. Allow the specific TCP port
    const { stdout } = await execAsync(`sudo ufw allow ${port}/tcp`);

    // 2. Optional: Reload firewall to ensure changes take effect
    // await execAsync(`sudo ufw reload`);

    return true;
  } catch (error) {
    console.error(`[FIREWALL ERROR] Could not open port ${port}:`, error.message);
    // We don't throw here so the project creation can still finish, 
    // but we log the failure for the admin.
    return false;
  }
};
export const reloadNginx = async () => {
  try {
    await signalNginxReload();
    return true;
  } catch (error) {
    console.error(`[NGINX RELOAD ERROR]: ${error.message}`);
    if (os.platform() !== "darwin") throw error;
  }
};

/**
 * Regenerate nginx config for all projects that have a port.
 * (Reserved for future use; SSL wildcard behaviour has been reverted.)
 */
export const regenerateAllProjectNginxConfigs = async () => {
  // No-op: SSL wildcard reverted; configs are created on project create only.
};

/** Prepended to the user scratch prompt for the Cursor Cloud agent only (not stored on Project.scratchPrompt). */
const SCRATCH_CURSOR_AGENT_BASE_PROMPT = `
You are an experienced software engineer working in a fresh project repository. 
Focus on the user's request and First create a plan and then implement it and aim for a result that builds and runs. 
If requirements are ambiguous, make reasonable assumptions and state them briefly.`;

/**
 * @param {string} userPrompt
 * @returns {string}
 */
function buildScratchAgentPromptText(userPrompt) {
  const trimmed = typeof userPrompt === "string" ? userPrompt.trim() : "";
  if (!trimmed) {
    return SCRATCH_CURSOR_AGENT_BASE_PROMPT;
  }
  return `${SCRATCH_CURSOR_AGENT_BASE_PROMPT}

User request:

${trimmed}`;
}

/**
 * Create release 1.0.0 and start the Cursor agent for the "from scratch" flow.
 * On success, persists `scratchPrompt`, sets `fromScratch` true. On failure, rolls back the release and clears `scratchPrompt`.
 */
export async function runScratchAgentSetup({ projectId, userId, promptText }) {
  if (!process.env.CURSOR_API_KEY?.trim()) {
    await prisma.project
      .update({
        where: { id: projectId },
        data: { scratchPrompt: null },
      })
      .catch(() => {});
    throw new ApiError(
      503,
      "Scratch project requires Cursor API to be configured (CURSOR_API_KEY).",
    );
  }
  let scratchRelease = null;
  try {
    scratchRelease = await createReleaseService(
      {
        projectId,
        name: "1.0.0",
        description: "Base Release for Project From Scratch",
      },
      { id: userId },
    );
    const agentResult = await createAgentForProjectRelease({
      projectId,
      releaseId: scratchRelease.id,
      attemptedById: userId,
      prompt: { text: buildScratchAgentPromptText(promptText) },
      model: "composer-1.5",
      deferLaunchpadMerge: false,
      omitTargetFromBody: false,
    });
    if (!agentResult.ok) {
      const msg =
        typeof agentResult.data?.error === "string"
          ? agentResult.data.error
          : "Failed to start scratch Cursor agent";
      throw new ApiError(
        agentResult.status >= 400 && agentResult.status < 600
          ? agentResult.status
          : 502,
        msg,
      );
    }
    await prisma.project
      .update({
        where: { id: projectId },
        data: { scratchPrompt: promptText, fromScratch: true },
      })
      .catch(() => {});
  } catch (e) {
    if (scratchRelease?.id) {
      await prisma.release
        .delete({ where: { id: scratchRelease.id } })
        .catch(() => {});
    }
    await prisma.project
      .update({
        where: { id: projectId },
        data: { scratchPrompt: null },
      })
      .catch(() => {});
    if (e instanceof ApiError) throw e;
    throw new ApiError(
      502,
      `Scratch agent setup failed: ${e?.message || String(e)}`,
    );
  }
}

/**
 * Start the scratch Cursor agent from project details (deferred prompt).
 */
export async function startScratchAgentFromProjectService({ projectId, user, body }) {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, "Invalid project id");
  }
  await assertProjectAccess(id, user);

  const promptRaw = body?.prompt;
  const promptTrimmed =
    typeof promptRaw === "string" ? promptRaw.trim() : "";
  if (!promptTrimmed) {
    throw new ApiError(400, "prompt is required");
  }
  if (promptTrimmed.length > 100000) {
    throw new ApiError(400, "prompt must be at most 100000 characters");
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!project) {
    throw new ApiError(404, "Project not found");
  }

  const releaseCount = await prisma.release.count({
    where: { projectId: id },
  });
  if (releaseCount > 0) {
    throw new ApiError(400, "A release already exists for this project.");
  }

  await runScratchAgentSetup({
    projectId: id,
    userId: user.id,
    promptText: promptTrimmed,
  });

  const refreshed = await getProjectByIdService(id, user);
  return {
    ...refreshed,
    scratchAgentStarted: true,
    scratchReleaseName: "1.0.0",
  };
}

/**
 * After project create: ensure a release exists, then start Migrate Frontend (async via setImmediate in caller).
 */
async function scheduleInitialMigrateFrontendAfterProjectCreate({
  projectId,
  actingUser,
}) {
  try {
    const pid = Number(projectId);
    if (!Number.isInteger(pid) || pid < 1 || !actingUser) return;
    const proj = await prisma.project.findUnique({
      where: { id: pid },
      select: { id: true, developmentRepoUrl: true, gitRepoPath: true },
    });
    if (!proj?.developmentRepoUrl?.trim() || !proj.gitRepoPath?.trim()) return;
    const devParsed = parseScmRepoPath(proj.developmentRepoUrl);
    if (!devParsed || devParsed.provider !== "github") return;
    if (!process.env.CURSOR_API_KEY?.trim()) return;

    let release = await prisma.release.findFirst({
      where: { projectId: proj.id },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (!release) {
      release = await createReleaseService(
        {
          projectId: proj.id,
          name: "1.0.0",
          description:
            "Draft release created automatically for initial UI import from the development repository.",
        },
        actingUser,
      );
    }
    const { startMigrateFrontendForRelease } = await import(
      "./migrateFrontend.service.js"
    );
    await startMigrateFrontendForRelease({
      projectId: proj.id,
      releaseId: release.id,
      user: actingUser,
      targetProjectVersionId: null,
      migrateFrontend: true,
    });
  } catch (err) {
    console.warn(
      "[createProject] importUiFromDevelopmentRepo follow-up:",
      err?.message || err,
    );
  }
}

export const createProjectService = async ({ userId, body, user }) => {
  const {
    name,
    jiraBaseUrl,
    jiraProjectKey,
    jiraUsername,
    jiraApiToken,
    githubUsername,
    githubToken,
    gitRepoPath,
    developmentRepoUrl,
    isScratch: isScratchRaw,
    prompt: scratchPromptRaw,
    importUiFromDevelopmentRepo: importUiFromDevelopmentRepoRaw,
  } = body;

  const isScratch =
    isScratchRaw === true ||
    isScratchRaw === "true" ||
    String(isScratchRaw || "").toLowerCase() === "true";
  const scratchPromptTrimmed =
    typeof scratchPromptRaw === "string" ? scratchPromptRaw.trim() : "";
  const importUiFromDevelopmentRepoRequested =
    importUiFromDevelopmentRepoRaw === true ||
    String(importUiFromDevelopmentRepoRaw || "").toLowerCase() === "true";

  const jiraKeyTrim = (jiraProjectKey && String(jiraProjectKey).trim()) || "";

  const githubConnectionId =
    body.githubConnectionId != null && String(body.githubConnectionId).trim() !== ""
      ? Number(body.githubConnectionId)
      : null;
  const jiraConnectionId =
    body.jiraConnectionId != null && String(body.jiraConnectionId).trim() !== ""
      ? Number(body.jiraConnectionId)
      : null;
  const bitbucketConnectionId =
    body.bitbucketConnectionId != null && String(body.bitbucketConnectionId).trim() !== ""
      ? Number(body.bitbucketConnectionId)
      : null;

  const creatorRow = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { email: true },
  });
  const creatorEmailTrimmed = (creatorRow?.email && String(creatorRow.email).trim()) || "";
  const bodyStakeholderRaw = body.stakeholderEmails;
  const bodyStakeholderTrimmed =
    typeof bodyStakeholderRaw === "string" && bodyStakeholderRaw.trim()
      ? bodyStakeholderRaw.trim()
      : "";

  let assignedUserEmailsDb = null;
  let stakeholderEmailsDb = null;
  try {
    assignedUserEmailsDb = normalizeOptionalEmailListString(body.assignedUserEmails);
    const mergedStakeholderInput = [creatorEmailTrimmed, bodyStakeholderTrimmed]
      .filter(Boolean)
      .join(",");
    stakeholderEmailsDb = mergedStakeholderInput
      ? normalizeOptionalEmailListString(mergedStakeholderInput)
      : null;
  } catch (e) {
    throw new ApiError(400, e.message);
  }
  const isLinux = os.platform() === 'linux';

  try {
    // 1. Project name must be unique (case-insensitive)
    const nameTrimmed = (name && typeof name === "string") ? name.trim() : "";
    if (!nameTrimmed) throw new ApiError(400, "Project name is required");
    const existingProject = await prisma.project.findFirst({
      where: { name: { equals: nameTrimmed, mode: "insensitive" } },
      select: { id: true },
    });
    if (existingProject) {
      throw new ApiError(400, "Project name already exists. Choose a unique name.");
    }

    const hubProjectId =
      body.projectId != null && String(body.projectId).trim() !== ""
        ? String(body.projectId).trim()
        : null;
    if (hubProjectId) {
      const existingHubLink = await prisma.project.findFirst({
        where: { projectId: hubProjectId },
        select: { id: true },
      });
      if (existingHubLink) {
        throw new ApiError(
          400,
          "Project already exists.",
        );
      }
    }

    if (
      Number.isInteger(githubConnectionId) &&
      githubConnectionId > 0 &&
      Number.isInteger(bitbucketConnectionId) &&
      bitbucketConnectionId > 0
    ) {
      throw new ApiError(400, "Choose either GitHub or Bitbucket OAuth for this project, not both.");
    }

    let effGithubUsername = (githubUsername && String(githubUsername).trim()) || "";
    let effGithubToken = (githubToken && String(githubToken).trim()) || "";
    let effBitbucketUsername = "";
    let effBitbucketToken = "";
    if (bitbucketConnectionId) {
      const bbRow = await assertBitbucketConnectionOwned(userId, bitbucketConnectionId);
      const fresh = await ensureFreshBitbucketConnection(bbRow);
      effBitbucketUsername = (fresh.bitbucketUsername || "").trim();
      effBitbucketToken = fresh.accessToken;
      effGithubUsername = "";
      effGithubToken = "";
    } else if (githubConnectionId) {
      const ghRow = await assertGithubConnectionOwned(userId, githubConnectionId);
      const fresh = await ensureFreshGithubConnection(ghRow);
      effGithubUsername = fresh.githubLogin || effGithubUsername;
      effGithubToken = fresh.accessToken;
    }

    let effJiraBase = (jiraBaseUrl && String(jiraBaseUrl).trim()) || "";
    let effJiraUser = (jiraUsername && String(jiraUsername).trim()) || "";
    let effJiraToken = (jiraApiToken && String(jiraApiToken).trim()) || "";
    let jiraOAuthAccess = null;
    let jiraAtlassianCloudId = null;
    if (jiraConnectionId) {
      const jRow = await assertJiraConnectionOwned(userId, jiraConnectionId);
      const fresh = await ensureFreshJiraConnection(jRow);
      effJiraBase = fresh.jiraBaseUrl || effJiraBase;
      effJiraUser = fresh.atlassianAccountEmail || effJiraUser;
      effJiraToken = "";
      jiraOAuthAccess = fresh.accessToken;
      jiraAtlassianCloudId = fresh.atlassianCloudId || null;
    }

    if (!effJiraBase?.trim() || !jiraKeyTrim) {
      throw new ApiError(400, "Jira base URL and project key are required");
    }
    if (!jiraOAuthAccess && (!effJiraUser || !effJiraToken)) {
      throw new ApiError(400, "Jira account email and API token are required unless using Jira OAuth");
    }
    if (bitbucketConnectionId) {
      if (!effBitbucketUsername || !effBitbucketToken) {
        throw new ApiError(400, "Bitbucket connection is incomplete (missing username or token).");
      }
    } else if (!effGithubUsername || !effGithubToken) {
      throw new ApiError(400, "GitHub username and access are required (connect GitHub or provide a token)");
    }

    await validateJiraConnection(
      effJiraBase,
      jiraKeyTrim,
      effJiraUser,
      effJiraToken,
      jiraOAuthAccess,
      jiraAtlassianCloudId,
    );
    if (bitbucketConnectionId) {
      try {
        await getDefaultBitbucketWorkspace(effBitbucketToken);
      } catch (e) {
        throw new ApiError(400, `Bitbucket: ${e.message}`);
      }
    } else {
      await validateGithubConnection(effGithubUsername, effGithubToken);
    }
    // 2. Paths: projects and nginx-configs live under backend (backend/projects, backend/nginx-configs)
    const backendRoot = getBackendRoot();
    const baseSlug = projectRepoSlugFromDisplayName(nameTrimmed);
    const slug = await ensureUniqueProjectSlug(baseSlug);
    const configFileName = `${slug}.conf`;
    const relativeProjectPath = path.join("projects", slug);
    const absoluteProjectPath = path.join(getProjectsDir(), slug);

    const nginxAvailableDir = getNginxConfigsDir();
    // NOTE: On Mac Homebrew, the real 'enabled' dir is /opt/homebrew/etc/nginx/servers/
    const nginxEnabledDir = isLinux
      ? '/etc/nginx/sites-enabled'
      : path.join(backendRoot, 'nginx', 'sites-enabled');

    const absoluteNginxConfigPath = path.join(nginxAvailableDir, configFileName);
    const symlinkPath = path.join(nginxEnabledDir, configFileName);

    // 3. Port & Firewall
    const maxPortProject = await prisma.project.aggregate({ _max: { port: true } });
    const port = (maxPortProject._max.port || 8000) + 1;

    // UFW only on Linux hosts with sudo (skip in Docker — no sudo; ports published by compose)
    if (isLinux && !shouldSkipUfw()) {
      await execAsync(`sudo ufw allow ${port}/tcp`).catch(err =>
        console.warn(`[WARN] Firewall skip: ${err.message}`)
      );
    }

    // 4a. Remote Git repo (GitHub or Bitbucket; create once at project create when needed)
    const githubCreds = {
      githubUsername: effGithubUsername,
      githubToken: effGithubToken,
    };
    let gitRepoUrl = null;
    let persistedGitRepoPath = null;
    if (bitbucketConnectionId && effBitbucketToken) {
      try {
        const requestedGitRepoPath = normalizeGitRepoPathValue(gitRepoPath);
        if (requestedGitRepoPath) {
          const requestedParsed = parseScmRepoPath(requestedGitRepoPath);
          if (requestedParsed?.provider === "bitbucket") {
            const metadata = await getBitbucketRepositoryMetadata(
              requestedParsed.owner,
              requestedParsed.repo,
              effBitbucketToken,
            );
            if (metadata.ok) {
              persistedGitRepoPath = requestedGitRepoPath;
              gitRepoUrl = `https://bitbucket.org/${requestedParsed.owner}/${requestedParsed.repo}`;
            } else {
              console.warn(
                `[createProject] Bitbucket gitRepoPath not accessible, creating repo instead: ${metadata.message || "validation failed"}`,
              );
            }
          }
        }
        if (!persistedGitRepoPath) {
          const ws = await getDefaultBitbucketWorkspace(effBitbucketToken);
          await createBitbucketRepository(ws, slug, effBitbucketToken);
          persistedGitRepoPath = `bitbucket.org/${ws}/${slug}`;
          gitRepoUrl = `https://bitbucket.org/${ws}/${slug}`;
        }
        await inviteDefaultCollaboratorToPath(
          persistedGitRepoPath,
          effBitbucketToken,
        );
      } catch (e) {
        console.warn("[createProject] Bitbucket repo:", e.message);
        throw new ApiError(
          502,
          `Bitbucket setup failed: ${e.message}. Fix credentials or repo name and retry.`,
        );
      }
    } else if (githubCreds.githubUsername && githubCreds.githubToken) {
      try {
        const requestedGitRepoPath = normalizeGitRepoPathValue(gitRepoPath);
        if (requestedGitRepoPath) {
          const requestedParsed = parseGitRepoPath(requestedGitRepoPath);
          const metadata = await getRepositoryMetadata(
            requestedParsed.owner,
            requestedParsed.repo,
            githubCreds.githubToken,
          );
          if (metadata.ok) {
            persistedGitRepoPath = requestedGitRepoPath;
            gitRepoUrl = `https://github.com/${requestedParsed.owner}/${requestedParsed.repo}`;
          } else {
            console.warn(
              `[createProject] Provided gitRepoPath is not accessible, creating repo instead: ${metadata.message || "validation failed"}`,
            );
          }
        }

        if (!persistedGitRepoPath) {
          await createGithubRepo(slug, githubCreds);
          persistedGitRepoPath = `github.com/${githubCreds.githubUsername}/${slug}`;
          gitRepoUrl = `https://github.com/${githubCreds.githubUsername}/${slug}`;
        }

        await inviteDefaultCollaboratorToPath(
          persistedGitRepoPath,
          githubCreds.githubToken,
        );
      } catch (e) {
        console.warn("[createProject] GitHub repo/collaborator:", e.message);
        throw new ApiError(
          502,
          `GitHub setup failed: ${e.message}. Fix credentials or repo name and retry.`,
        );
      }
    }

    let persistedDeveloperRepoUrl = null;
    const requestedDeveloperRepo = normalizeGitRepoPathValue(developmentRepoUrl);
    if (requestedDeveloperRepo) {
      if (!parseScmRepoPath(requestedDeveloperRepo)) {
        throw new ApiError(400, "developmentRepoUrl must be a valid GitHub or Bitbucket repository path");
      }
      const mainNorm = normalizeGitRepoPathValue(persistedGitRepoPath);
      if (mainNorm && requestedDeveloperRepo === mainNorm) {
        throw new ApiError(
          400,
          "developmentRepoUrl must differ from the platform Git repository (gitRepoPath).",
        );
      }
      persistedDeveloperRepoUrl = requestedDeveloperRepo;
    }

    if (persistedDeveloperRepoUrl) {
      const devProv = parseScmRepoPath(persistedDeveloperRepoUrl)?.provider;
      if (devProv === "github" && effGithubToken?.trim() && !bitbucketConnectionId) {
        await inviteDefaultCollaboratorToPath(
          persistedDeveloperRepoUrl,
          effGithubToken,
        );
      }
      if (devProv === "bitbucket" && effBitbucketToken?.trim() && bitbucketConnectionId) {
        await inviteDefaultCollaboratorToPath(
          persistedDeveloperRepoUrl,
          effBitbucketToken,
        );
      }
    }

    // 4. Directory Prep
    await fsExtra.ensureDir(absoluteProjectPath);
    await fsExtra.ensureDir(nginxAvailableDir);
    // If on Mac, we only ensureDir if it's a local mock folder
    if (!isLinux) await fsExtra.ensureDir(nginxEnabledDir);

    // 6. Nginx Config
    const configContent = generateNginxConfigTemplate(slug, port);
    await fsExtra.writeFile(absoluteNginxConfigPath, configContent);

    // 7. Symlink & Restart (skip symlink when nginx includes /app/nginx-configs directly — Docker backend-only nginx)
    try {
      const nginxConfigsDir = getNginxConfigsDir();
      let skipSymlink = false;
      if (isLinux && absoluteNginxConfigPath.startsWith(nginxConfigsDir) && fsExtra.existsSync('/etc/nginx/nginx.conf')) {
        const mainConf = await fsExtra.readFile('/etc/nginx/nginx.conf', 'utf8').catch(() => '');
        skipSymlink = mainConf.includes('/app/nginx-configs');
      }
      if (!skipSymlink) {
        const linkCmd = isLinux
          ? `sudo ln -sf ${absoluteNginxConfigPath} ${symlinkPath}`
          : `ln -sf ${absoluteNginxConfigPath} ${symlinkPath}`;
        await execAsync(linkCmd);
      }
      await reloadNginx();
    } catch (err) {
      console.warn(`[WARN] Nginx reload skipped/failed: ${err.message}`);
    }

    // 8. DB Persistence — name stays the original display value (trim only); slug is derived for URLs / projects/<slug> / public API
    const project = await prisma.$transaction(async (tx) => {
      return await tx.project.create({
        data: {
          name: nameTrimmed,
          description:
            body.description != null && typeof body.description === "string"
              ? body.description.trim() || null
              : null,
          slug,
          createdById: userId,
          githubUsername: bitbucketConnectionId ? null : effGithubUsername || null,
          githubToken:
            (bitbucketConnectionId || githubConnectionId) ? null : effGithubToken || null,
          githubConnectionId: bitbucketConnectionId ? null : githubConnectionId || null,
          bitbucketUsername: bitbucketConnectionId ? effBitbucketUsername || null : null,
          bitbucketToken: null,
          bitbucketConnectionId: bitbucketConnectionId || null,
          jiraBaseUrl: effJiraBase || null,
          jiraProjectKey: jiraKeyTrim,
          jiraUsername: effJiraUser || null,
          jiraApiToken: jiraConnectionId ? null : effJiraToken || null,
          jiraConnectionId: jiraConnectionId || null,
          jiraIssueType:
            body.jiraIssueType != null && String(body.jiraIssueType).trim()
              ? String(body.jiraIssueType).trim()
              : null,
          port,
          projectPath: relativeProjectPath,
          projectId: hubProjectId,
          assignedUserEmails: assignedUserEmailsDb,
          stakeholderEmails: stakeholderEmailsDb,
          gitRepoPath:
            persistedGitRepoPath || path.join(relativeProjectPath, ".git"),
          developmentRepoUrl: persistedDeveloperRepoUrl,
          nginxConfigPath: path.join('nginx-configs', configFileName),
          scratchPrompt:
            isScratch && scratchPromptTrimmed ? scratchPromptTrimmed : null,
          fromScratch: isScratch,
          migrateFrontend: importUiFromDevelopmentRepoRequested,
        },
      });
    });

    void ensureLaunchpadPushWebhooksForProject(project).catch((err) => {
      console.warn(`[launchpad webhook] create ensure failed: ${err?.message || err}`);
    });

    // 9. Start static server on this project's port (so http://localhost:8004/ works)
    startProjectServer(port, absoluteProjectPath);

    if (isScratch && scratchPromptTrimmed) {
      await runScratchAgentSetup({
        projectId: project.id,
        userId,
        promptText: scratchPromptTrimmed,
      });
    }

    const masked = maskProjectSecrets(project);
    const importUiFromDevelopmentRepoScheduled = Boolean(
      importUiFromDevelopmentRepoRequested &&
        !isScratch &&
        user &&
        persistedDeveloperRepoUrl &&
        persistedGitRepoPath &&
        parseScmRepoPath(persistedDeveloperRepoUrl)?.provider === "github" &&
        process.env.CURSOR_API_KEY?.trim(),
    );
    if (importUiFromDevelopmentRepoScheduled) {
      setImmediate(() => {
        void scheduleInitialMigrateFrontendAfterProjectCreate({
          projectId: project.id,
          actingUser: user,
        });
      });
    }
    if (isScratch && scratchPromptTrimmed) {
      return {
        ...masked,
        fromScratch: true,
        scratchAgentStarted: true,
        scratchReleaseName: "1.0.0",
        importUiFromDevelopmentRepoScheduled: false,
      };
    }
    if (isScratch && !scratchPromptTrimmed) {
      return {
        ...masked,
        fromScratch: true,
        scratchAgentStarted: false,
        importUiFromDevelopmentRepoScheduled: false,
      };
    }
    return {
      ...masked,
      importUiFromDevelopmentRepoScheduled,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Project creation failed: ${error.message}`);
  }
};
/**
 * Dynamically finds where Nginx is installed on this specific machine
 */
export const getNginxPaths = async () => {
  const isLinux = os.platform() === 'linux';

  // Find the real binary path (e.g., /usr/local/bin/nginx or /usr/sbin/nginx)
  let binary;
  try {
    const { stdout } = await execAsync('which nginx');
    binary = stdout.trim();
  } catch {
    binary = isLinux ? '/usr/sbin/nginx' : '/usr/local/bin/nginx';
  }

  // Determine the enabled directory (Linux: system; else: under backend for local dev)
  const enabledDir = isLinux
    ? '/etc/nginx/sites-enabled'
    : path.join(getBackendRoot(), 'nginx', 'sites-enabled');

  return { binary, enabledDir, isLinux };
};

export const deleteProjectService = async (projectId, user) => {
  const id = Number(projectId);

  await assertProjectDeleteAccess(id, user);

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw new ApiError(404, "Project not found");

  const { enabledDir: nginxEnabledDir, isLinux } = await getNginxPaths();
  const backendRoot = getBackendRoot();

  const absoluteProjectPath = project.projectPath
    ? path.join(backendRoot, project.projectPath)
    : null;
  const absoluteNginxPath = project.nginxConfigPath
    ? path.join(backendRoot, project.nginxConfigPath)
    : null;
  const projectName = project.nginxConfigPath
    ? path.basename(project.nginxConfigPath, ".conf")
    : project.name?.toLowerCase().replace(/\s+/g, "-") ?? "project";
  const symlinkPath = path.join(nginxEnabledDir, `${projectName}.conf`);

  try {
    /* ----------------------------------------
     * 1. OS-LEVEL CLEANUP (Linux only)
     * -------------------------------------- */
    if (isLinux) {
      await execAsync(
        `sudo /usr/local/bin/project-cleanup.sh ${project.port || ""} "${symlinkPath}"`
      ).catch((err) => console.warn("[DeleteProjectService] cleanup script:", err.message));
    }

    /* ----------------------------------------
     * 2. FILESYSTEM CLEANUP (App-owned files)
     * -------------------------------------- */
    await Promise.all([
      absoluteProjectPath && fsExtra.remove(absoluteProjectPath).catch(() => { }),
      absoluteNginxPath && fsExtra.remove(absoluteNginxPath).catch(() => { }),
      !isLinux && fsExtra.remove(symlinkPath).catch(() => { }),
    ]);

    /* ----------------------------------------
     * 3. DATABASE: project delete cascades releases, versions
     * -------------------------------------- */
    await prisma.project.delete({ where: { id } });

    return { message: "Project deleted successfully", projectName };
  } catch (error) {
    console.error("[DeleteProjectService]", error);
    throw new ApiError(500, `Delete failed: ${error.message}`);
  }
};

/*LIST PROJECTS*/

export async function listProjectsService(user) {
  const { id: userId, role } = user;

  const projects = await prisma.project.findMany({
    where: role === "admin" ? {} : {
      OR: [
        { createdById: userId },
        { assignedUserEmails: { not: null } },
      ],
    },
    orderBy: { createdAt: "desc" },

    include: {
      /**
       * Active version (live)
       */
      versions: {
        where: { isActive: true },
        select: {
          id: true,
          version: true,
          buildUrl: true,
          createdAt: true,
        },
      },

      releases: {
        orderBy: { createdAt: "desc" },
        include: {
          versions: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (role === "admin") return projects.map(maskProjectSecrets);
  const userEmail = await resolveUserEmail(user);
  return projects
    .filter((project) => {
      if (Number(project.createdById) === Number(userId)) return true;
      if (!userEmail) return false;
      const assignedUsers = parseStoredEmailListToSet(project.assignedUserEmails);
      return assignedUsers.has(userEmail);
    })
    .map(maskProjectSecrets);
}
/**
 * GET project by ID or public slug (single entry point).
 * @param {number|null} projectId — numeric id (ignored when `options.slug` is set for public).
 * @param {object|null} user
 * @param {object} [options]
 * @param {boolean} [options.publicView] — ignored; public slug lookups use `options.slug`.
 * @param {string} [options.slug] — look up by slug (minimal project fields); otherwise use `projectId`.
 */
export const getProjectByIdService = async (
  projectId,
  user = null, // ignored
  options = {}
) => {
  const slug =
    typeof options.slug === "string" ? options.slug.trim() : null;

  const isSlugMode = !!slug;

  // ---------------------------
  // WHERE CLAUSE
  // ---------------------------
  let where = null;

  if (isSlugMode) {
    where = { slug };
  } else if (projectId) {
    where = { id: Number(projectId) };
  }

  if (!where) return null;

  const versionsQuery = {
    where: { isActive: true },
    select: {
      id: true,
      version: true,
      buildUrl: true,
      createdAt: true,
      isActive: true,
      releaseId: true,
      migrateFrontend: true,
    },
  };

  const releasesQuery = {
    orderBy: { id: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      lockedBy: true,
      backendAgentId: true,
      backendAgentStatus: true,
      clientReleaseNote: true,
      clientReviewAiSummary: true,
      clientReviewAiSummaryAt: true,
      showClientReviewSummary: true,
      versions: {
        orderBy: { id: "desc" },
        select: {
          id: true,
          version: true,
          buildUrl: true,
          isActive: true,
          createdAt: true,
          releaseId: true,
          migrateFrontend: true,
        },
      },
    },
  };

  // Slug / public: only id + name on Project; full row when fetching by project id.
  if (isSlugMode) {
    const project = await prisma.project.findUnique({
      where,
      select: {
        id: true,
        name: true,
        scratchPrompt: true,
        developmentRepoUrl: true,
        versions: versionsQuery,
        releases: releasesQuery,
      },
    });
    if (!project) return null;
    const hasDevelopmentRepo = Boolean(
      String(project.developmentRepoUrl || "").trim(),
    );
    const { developmentRepoUrl: _devUrl, ...publicProject } = project;
    const withFlag = { ...publicProject, hasDevelopmentRepo };
    if (!withFlag.releases?.length) return withFlag;
    return {
      ...withFlag,
      releases: withFlag.releases.map((r) =>
        r.showClientReviewSummary === false
          ? {
              ...r,
              clientReviewAiSummary: null,
              clientReviewAiSummaryAt: null,
            }
          : r,
      ),
    };
  }

  await assertProjectReadAccess(Number(projectId), user);

  const project = await prisma.project.findUnique({
    where,
    include: {
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      versions: versionsQuery,
      releases: releasesQuery,
    },
  });
  return maskProjectSecrets(project);
};

/**
 * Checkout tag, build, copy build output into projects/{projectPath}, reload nginx, update version buildUrl.
 * Does not change isActive (caller handles DB flags). Used by activate-version API and after release status → active.
 * When `skipProjectAccessCheck` is true, skips assertProjectAccess (caller must enforce trust; e.g. public client-link refresh-build).
 */
export async function deployVersionArtifactsToProjectFolder({
  projectId,
  versionId,
  user,
  skipProjectAccessCheck = false,
}) {
  if (!skipProjectAccessCheck) {
    await assertProjectAccess(projectId, user);
  }

  const version = await prisma.projectVersion.findFirst({
    where: { id: versionId, projectId },
    select: {
      id: true,
      buildUrl: true,
      version: true,
      gitTag: true,
    },
  });

  if (!version) {
    throw new ApiError(404, "Version not found");
  }

  const tag = version.gitTag && version.gitTag.trim();
  if (!tag) {
    throw new ApiError(
      400,
      "Version has no gitTag; cannot checkout. Re-upload or merge from Cursor first.",
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      projectPath: true,
      port: true,
      githubToken: true,
      gitRepoPath: true,
      githubConnectionId: true,
      createdById: true,
      githubUsername: true,
    },
  });
  if (!project?.projectPath?.trim()) {
    throw new ApiError(400, "Project has no projectPath");
  }

  let githubTokenResolved = "";
  try {
    const gh = await resolveGithubCredentialsFromProject(project);
    githubTokenResolved = gh.githubToken?.trim() || "";
  } catch {
    githubTokenResolved = "";
  }

  const backendRoot = getBackendRoot();
  const projectsDir = getProjectsDir();
  const gitDir = path.join(projectsDir, ".git");
  const projectRoot = path.join(backendRoot, project.projectPath);
  const worktreeDir = path.join(
    backendRoot,
    "_tmp_builds",
    `deploy_${projectId}_${Date.now()}`,
  );

  const lock = await prisma.project.updateMany({
    where: { id: projectId, isUploading: false },
    data: { isUploading: true },
  });
  if (lock.count === 0) {
    throw new ApiError(409, "Upload or activate already in progress for this project");
  }

  try {
    let buildOutputPath;

    if (fs.existsSync(gitDir)) {
      await fs.ensureDir(path.dirname(worktreeDir));
      await fs.remove(worktreeDir).catch(() => { });
      await fs.ensureDir(worktreeDir);
      runCommand(`git --git-dir="${gitDir}" worktree prune`, backendRoot);
      deleteLocalGitTag(gitDir, tag);
      const fetchTagIntoLocalRepo = (gDir, t, proj, tokenStr) => {
        if (proj.gitRepoPath?.trim() && tokenStr?.trim()) {
          const parsed = parseGitRepoPath(proj.gitRepoPath.trim());
          if (parsed) {
            const { owner, repo } = parsed;
            const token = tokenStr.trim();
            const fetchUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
            try {
              execFileSync("git", ["--git-dir", gDir, "fetch", fetchUrl, `refs/tags/${t}:refs/tags/${t}`], {
                cwd: backendRoot,
                encoding: "utf8",
                timeout: 120000,
              });
              return true;
            } catch {
              try {
                execFileSync("git", ["--git-dir", gDir, "fetch", fetchUrl, "tag", t], {
                  cwd: backendRoot,
                  encoding: "utf8",
                  timeout: 120000,
                });
                return true;
              } catch {
                return false;
              }
            }
          }
        }
        return false;
      };
      if (!fetchTagIntoLocalRepo(gitDir, tag, project, githubTokenResolved)) {
        try {
          runCommand(
            `git --git-dir="${gitDir}" fetch origin "refs/tags/${tag}:refs/tags/${tag}"`,
            backendRoot,
          );
        } catch {
          try {
            runCommand(`git --git-dir="${gitDir}" fetch origin tag "${tag}"`, backendRoot);
          } catch (_) { /* tag may already exist locally */ }
        }
      }
      try {
        runCommand(
          `git --git-dir="${gitDir}" rev-parse --verify "refs/tags/${tag}"`,
          backendRoot,
        );
      } catch {
        const hint = project.gitRepoPath
          ? "Ensure the tag exists on the project's GitHub repo and that gitRepoPath + githubToken are set."
          : "Ensure the tag exists on the remote and that projects/.git remote \"origin\" points to the correct repo, or set the project's gitRepoPath + githubToken.";
        throw new ApiError(400, `Tag "${tag}" not found. ${hint}`);
      }
      runCommand(
        `git --git-dir="${gitDir}" worktree add "${worktreeDir}" "${tag}"`,
        backendRoot,
      );
      const sourceRoot = findProjectRoot(worktreeDir);
      buildOutputPath = await runBuildSequence(sourceRoot);
    } else if (githubTokenResolved?.trim() && project.gitRepoPath?.trim()) {
      const parsed = parseGitRepoPath(project.gitRepoPath);
      if (!parsed) {
        throw new ApiError(400, "Invalid gitRepoPath; cannot clone for deploy");
      }
      const { owner, repo } = parsed;
      const token = githubTokenResolved.trim();
      const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
      await fs.ensureDir(worktreeDir);
      try {
        execFileSync("git", ["clone", cloneUrl, "."], {
          cwd: worktreeDir,
          encoding: "utf8",
          stdio: "pipe",
          timeout: 300000,
        });
        try {
          execFileSync(
            "git",
            ["fetch", "origin", `refs/tags/${tag}:refs/tags/${tag}`],
            { cwd: worktreeDir, encoding: "utf8", stdio: "pipe", timeout: 120000 },
          );
        } catch {
          execFileSync("git", ["fetch", "origin", "tag", tag], {
            cwd: worktreeDir,
            encoding: "utf8",
            stdio: "pipe",
            timeout: 120000,
          });
        }
        execFileSync("git", ["checkout", tag], {
          cwd: worktreeDir,
          encoding: "utf8",
          stdio: "pipe",
          timeout: 60000,
        });
        const sourceRoot = findProjectRoot(worktreeDir);
        buildOutputPath = await runBuildSequence(sourceRoot);
      } catch (e) {
        await fs.remove(worktreeDir).catch(() => { });
        throw e;
      }
    } else {
      throw new ApiError(
        503,
        "No local git repo and no GitHub credentials; deploy a release first or set gitRepoPath + githubToken.",
      );
    }

    await fs.ensureDir(path.dirname(projectRoot));
    await fs.emptyDir(projectRoot);
    await fs.copy(buildOutputPath, projectRoot);

    if (fs.existsSync(gitDir) && fs.existsSync(worktreeDir)) {
      try {
        runCommand(
          `git --git-dir="${gitDir}" worktree remove "${worktreeDir}" --force`,
          backendRoot,
        );
      } catch {
        await fs.remove(worktreeDir).catch(() => { });
      }
    } else {
      await fs.remove(worktreeDir).catch(() => { });
    }

    await reloadNginxRelease();

    const domain = config.getBuildUrlHost();
    const liveBuildUrl =
      project.port != null
        ? `${config.getBuildUrlProtocol()}://${domain}:${project.port}`
        : version.buildUrl;

    await prisma.projectVersion.update({
      where: { id: versionId },
      data: { buildUrl: liveBuildUrl },
    });

    return {
      version: version.version,
      buildUrl: liveBuildUrl,
      tag,
    };
  } finally {
    await fs.remove(worktreeDir).catch(() => { });
    await prisma.project.update({
      where: { id: projectId },
      data: { isUploading: false },
    });
  }
}

/**
 * Deploy whatever version is currently marked isActive for the project (e.g. after release status → active sync).
 */
export async function deployActiveVersionToProjectFolder({ projectId, user }) {
  const row = await prisma.projectVersion.findFirst({
    where: { projectId, isActive: true },
    select: { id: true },
  });
  if (!row) return null;
  return deployVersionArtifactsToProjectFolder({
    projectId,
    versionId: row.id,
    user,
  });
}

/**
 * Activate a project version: checkout version tag, build, copy dist/build into
 * projects/{projectPath} (same as upload release), reload nginx, then set isActive in DB.
 */
export async function activateProjectVersionService({
  projectId,
  versionId,
  user,
}) {
  await assertProjectAccess(projectId, user);

  const version = await prisma.projectVersion.findFirst({
    where: { id: versionId, projectId },
    select: {
      id: true,
      isActive: true,
      buildUrl: true,
      version: true,
      gitTag: true,
      releaseId: true,
    },
  });

  if (!version) {
    throw new ApiError(404, "Version not found");
  }
  if (version.isActive) {
    throw new ApiError(400, "Version is already active");
  }

  const activeRelease = await prisma.release.findFirst({
    where: { projectId, status: ReleaseStatus.active },
    select: { id: true },
  });
  if (!version.releaseId || !activeRelease || version.releaseId !== activeRelease.id) {
    throw new ApiError(
      400,
      "Set a release to active first; only versions on that release can go live.",
    );
  }

  const deployed = await deployVersionArtifactsToProjectFolder({
    projectId,
    versionId,
    user,
  });

  await prisma.$transaction(async (tx) => {
    await tx.projectVersion.updateMany({
      where: { projectId },
      data: { isActive: false },
    });
    await tx.projectVersion.update({
      where: { id: versionId },
      data: { isActive: true },
    });
  });

  return {
    message: "Version activated; projects folder updated from tag",
    version: deployed.version,
    buildUrl: deployed.buildUrl,
    tag: deployed.tag,
  };
}

/**
 * Activate a release (POST /projects/:id/releases/:releaseId/activate).
 * Delegates to release.service status rules (single active release, lock-before-switch, etc.).
 */
export async function setReleaseStatusService({ projectId, releaseId, user, reason }) {
  await assertProjectAccess(projectId, user);

  const release = await prisma.release.findFirst({
    where: { id: releaseId, projectId },
    select: { id: true },
  });
  if (!release) {
    throw new ApiError(404, "Release not found");
  }

  await applyReleaseStatus(releaseId, ReleaseStatus.active, user, { reason });
}
/*GET LIVE URL - reflects projects/ folder (updated on upload release and on activate version from tag) */
export async function getProjectLiveUrlService({ projectId, user }) {
  await assertProjectReadAccess(projectId, user);

  const activeVersion = await prisma.projectVersion.findFirst({
    where: {
      projectId,
      isActive: true,
    },
    select: {
      buildUrl: true,
      version: true,
    },
  });

  if (!activeVersion) {
    throw new ApiError(404, "No live build found for this project");
  }

  return activeVersion;
}
/*list project versions*/
export async function listProjectVersionsService({ projectId, user }) {
  await assertProjectReadAccess(projectId, user);

  return prisma.projectVersion.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      uploader: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
}


const PROJECT_UPDATE_KEYS = [
  "description",
  "slug",
  "jiraUsername",
  "jiraBaseUrl",
  "jiraProjectKey",
  "jiraApiToken",
  "jiraConnectionId",
  "githubUsername",
  "githubToken",
  "githubConnectionId",
  "bitbucketUsername",
  "bitbucketToken",
  "bitbucketConnectionId",
  "gitRepoPath",
  "developmentRepoUrl",
  "assignedUserEmails",
  "stakeholderEmails",
];

export const updateProjectDetailsService = async ({ projectId, user, body }) => {
  await assertProjectAccess(projectId, user);

  const existingProject = await prisma.project.findUnique({
    where: { id: Number(projectId) },
  });

  if (!existingProject) {
    throw new ApiError(404, "Project not found");
  }

  const data = {};
  for (const key of PROJECT_UPDATE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const raw = body[key];
      if (key === "slug") {
        if (raw === null || raw === "") {
          data.slug = null;
        } else if (typeof raw === "string") {
          const normalized = projectRepoSlugFromDisplayName(raw.trim());
          data.slug = await ensureUniqueProjectSlug(
            normalized,
            Number(projectId),
          );
        } else {
          throw new ApiError(400, "slug must be a string or null");
        }
        continue;
      }
      if (key === "assignedUserEmails" || key === "stakeholderEmails") {
        if (raw === null || raw === "") {
          data[key] = null;
        } else if (typeof raw === "string") {
          try {
            data[key] = normalizeOptionalEmailListString(raw);
          } catch (e) {
            throw new ApiError(400, e.message);
          }
        } else {
          throw new ApiError(400, `${key} must be a string or null`);
        }
        continue;
      }
      if (key === "gitRepoPath") {
        if (raw === null || raw === "") {
          throw new ApiError(400, "gitRepoPath cannot be empty");
        }
        const normalized = normalizeGitRepoPathValue(raw);
        if (!normalized) {
          throw new ApiError(400, "gitRepoPath must be a valid GitHub or Bitbucket repository path");
        }
        data.gitRepoPath = normalized;
        continue;
      }
      if (key === "developmentRepoUrl") {
        if (raw === null || raw === "") {
          data.developmentRepoUrl = null;
        } else if (typeof raw === "string") {
          const normalized = normalizeGitRepoPathValue(raw);
          if (!normalized) {
            throw new ApiError(400, "developmentRepoUrl must be a valid GitHub or Bitbucket repository path");
          }
          data.developmentRepoUrl = normalized;
        } else {
          throw new ApiError(400, "developmentRepoUrl must be a string or null");
        }
        continue;
      }
      if (key === "githubConnectionId" || key === "jiraConnectionId" || key === "bitbucketConnectionId") {
        if (raw === null || raw === "") {
          data[key] = null;
        } else {
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 1) {
            throw new ApiError(400, `${key} must be a positive integer or null`);
          }
          data[key] = n;
        }
        continue;
      }
      if (raw === null || raw === "") {
        data[key] = null;
      } else if (typeof raw === "string") {
        const t = raw.trim();
        data[key] = t === "" ? null : t;
      } else {
        data[key] = raw;
      }
    }
  }

  if (Object.keys(data).length === 0) {
    throw new ApiError(400, "No updatable fields provided");
  }

  if (data.githubConnectionId !== undefined && data.githubConnectionId != null) {
    const row = await prisma.userOAuthConnection.findFirst({
      where: { id: data.githubConnectionId, provider: "github" },
    });
    if (!row) throw new ApiError(400, "Invalid GitHub connection");
    if (row.userId !== existingProject.createdById) {
      throw new ApiError(
        400,
        "GitHub connection must belong to the user who created this project.",
      );
    }
  }
  if (data.bitbucketConnectionId !== undefined && data.bitbucketConnectionId != null) {
    const row = await prisma.userOAuthConnection.findFirst({
      where: { id: data.bitbucketConnectionId, provider: "bitbucket" },
    });
    if (!row) throw new ApiError(400, "Invalid Bitbucket connection");
    if (row.userId !== existingProject.createdById) {
      throw new ApiError(
        400,
        "Bitbucket connection must belong to the user who created this project.",
      );
    }
  }
  if (data.jiraConnectionId !== undefined && data.jiraConnectionId != null) {
    const row = await prisma.userOAuthConnection.findFirst({
      where: { id: data.jiraConnectionId, provider: "jira_atlassian" },
    });
    if (!row) throw new ApiError(400, "Invalid Jira connection");
    if (row.userId !== existingProject.createdById) {
      throw new ApiError(
        400,
        "Jira connection must belong to the user who created this project.",
      );
    }
  }

  const merged = { ...existingProject, ...data };

  if (merged.githubConnectionId && merged.bitbucketConnectionId) {
    throw new ApiError(
      400,
      "Project cannot use both GitHub and Bitbucket OAuth. Remove one connection.",
    );
  }

  const hasJiraSetup =
    merged.jiraBaseUrl &&
    merged.jiraProjectKey &&
    (merged.jiraConnectionId || (merged.jiraUsername && merged.jiraApiToken));
  if (hasJiraSetup) {
    try {
      const jc = await resolveJiraCredentialsFromProject(merged);
      if (jc.auth === "bearer") {
        await validateJiraConnection(
          merged.jiraBaseUrl,
          merged.jiraProjectKey,
          null,
          null,
          jc.accessToken,
          jc.atlassianCloudId,
        );
      } else if (jc.email && jc.apiToken) {
        await validateJiraConnection(
          merged.jiraBaseUrl,
          merged.jiraProjectKey,
          jc.email,
          jc.apiToken,
          null,
          null,
        );
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
    }
  }

  const hasGithubSetup =
    merged.githubConnectionId || (merged.githubUsername && merged.githubToken);
  const hasBitbucketSetup =
    merged.bitbucketConnectionId || (merged.bitbucketUsername && merged.bitbucketToken);
  if (hasGithubSetup && hasBitbucketSetup) {
    throw new ApiError(
      400,
      "Project cannot use both GitHub and Bitbucket credentials. Clear one host.",
    );
  }
  if (hasGithubSetup) {
    const g = await resolveGithubCredentialsFromProject(merged);
    await validateGithubConnection(g.githubUsername, g.githubToken);
  }
  if (hasBitbucketSetup) {
    const scm = await resolveScmCredentialsFromProject(merged);
    if (scm.provider !== "bitbucket") {
      throw new ApiError(400, "Invalid Bitbucket configuration for this project.");
    }
    try {
      await getDefaultBitbucketWorkspace(scm.token);
    } catch (e) {
      throw new ApiError(400, `Bitbucket: ${e.message}`);
    }
  }

  const nextGitRepoPath =
    data.gitRepoPath !== undefined ? data.gitRepoPath : existingProject.gitRepoPath;
  const oldGitRepoPath = normalizeGitRepoPathValue(existingProject.gitRepoPath);
  const nextNormalizedGitRepoPath = normalizeGitRepoPathValue(nextGitRepoPath);
  if (data.gitRepoPath !== undefined && !nextNormalizedGitRepoPath) {
    throw new ApiError(400, "gitRepoPath must be a valid GitHub or Bitbucket repository path");
  }

  let effectiveGitToken = null;
  if (data.gitRepoPath !== undefined && nextNormalizedGitRepoPath) {
    try {
      const scm = await resolveScmCredentialsFromProject(merged);
      effectiveGitToken = scm.token?.trim() || null;
    } catch (e) {
      throw new ApiError(
        400,
        e?.message || "Repository credentials are required to validate gitRepoPath changes",
      );
    }
    if (!effectiveGitToken) {
      throw new ApiError(400, "A repository token is required to validate gitRepoPath changes");
    }
  }
  if (data.gitRepoPath !== undefined && nextNormalizedGitRepoPath) {
    const scm = await resolveScmCredentialsFromProject(merged);
    const parsedNextRepo = parseScmRepoPath(nextNormalizedGitRepoPath);
    if (!parsedNextRepo || parsedNextRepo.provider !== scm.provider) {
      throw new ApiError(
        400,
        "gitRepoPath must match your connected code host (GitHub vs Bitbucket).",
      );
    }
    if (scm.provider === "github") {
      const metadata = await getRepositoryMetadata(
        parsedNextRepo.owner,
        parsedNextRepo.repo,
        effectiveGitToken,
      );
      if (!metadata.ok) {
        throw new ApiError(
          400,
          `Cannot access destination repository: ${metadata.message || "validation failed"}`,
        );
      }
    } else {
      const metadata = await getBitbucketRepositoryMetadata(
        parsedNextRepo.owner,
        parsedNextRepo.repo,
        effectiveGitToken,
      );
      if (!metadata.ok) {
        throw new ApiError(
          400,
          `Cannot access destination repository: ${metadata.message || "validation failed"}`,
        );
      }
    }
  }

  if (data.developmentRepoUrl !== undefined && data.developmentRepoUrl !== null) {
    const devNorm = normalizeGitRepoPathValue(data.developmentRepoUrl);
    if (!devNorm) {
      throw new ApiError(400, "developmentRepoUrl must be a valid GitHub or Bitbucket repository path");
    }
    const mainNorm = normalizeGitRepoPathValue(merged.gitRepoPath);
    if (mainNorm && devNorm === mainNorm) {
      throw new ApiError(
        400,
        "developmentRepoUrl must differ from the platform Git repository (gitRepoPath).",
      );
    }
    let devScmToken = null;
    try {
      const scm = await resolveScmCredentialsFromProject(merged);
      devScmToken = scm.token?.trim() || null;
      const parsedDev = parseScmRepoPath(devNorm);
      if (!parsedDev || parsedDev.provider !== scm.provider) {
        throw new ApiError(
          400,
          "developmentRepoUrl must match your connected code host (GitHub vs Bitbucket).",
        );
      }
      if (!devScmToken) {
        throw new ApiError(400, "A repository token is required to validate developmentRepoUrl changes");
      }
      if (scm.provider === "github") {
        const metadata = await getRepositoryMetadata(
          parsedDev.owner,
          parsedDev.repo,
          devScmToken,
        );
        if (!metadata.ok) {
          throw new ApiError(
            400,
            `Cannot access developer repository: ${metadata.message || "validation failed"}`,
          );
        }
      } else {
        const metadata = await getBitbucketRepositoryMetadata(
          parsedDev.owner,
          parsedDev.repo,
          devScmToken,
        );
        if (!metadata.ok) {
          throw new ApiError(
            400,
            `Cannot access developer repository: ${metadata.message || "validation failed"}`,
          );
        }
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(
        400,
        e?.message || "Repository credentials are required to validate developmentRepoUrl changes",
      );
    }
  }

  const gitRepoChanged =
    data.gitRepoPath !== undefined &&
    oldGitRepoPath &&
    nextNormalizedGitRepoPath &&
    oldGitRepoPath !== nextNormalizedGitRepoPath;

  const oldMainParsed = parseScmRepoPath(oldGitRepoPath || "");
  const newMainParsed = parseScmRepoPath(nextNormalizedGitRepoPath || "");
  const migrationSupported =
    Boolean(oldMainParsed) &&
    Boolean(newMainParsed) &&
    oldMainParsed.provider === newMainParsed.provider &&
    gitRepoChanged;

  const oldDevNorm = normalizeGitRepoPathValue(existingProject.developmentRepoUrl);
  const nextDevNorm =
    data.developmentRepoUrl !== undefined
      ? data.developmentRepoUrl === null
        ? null
        : normalizeGitRepoPathValue(data.developmentRepoUrl)
      : oldDevNorm;
  const devRepoMigrationNeeded =
    data.developmentRepoUrl !== undefined &&
    Boolean(oldDevNorm) &&
    Boolean(nextDevNorm) &&
    oldDevNorm !== nextDevNorm;
  const oldDevParsed = oldDevNorm ? parseScmRepoPath(oldDevNorm) : null;
  const newDevParsed = nextDevNorm ? parseScmRepoPath(nextDevNorm) : null;
  const devMigrationSupported =
    devRepoMigrationNeeded &&
    Boolean(oldDevParsed) &&
    Boolean(newDevParsed) &&
    oldDevParsed.provider === newDevParsed.provider;

  if (gitRepoChanged && !migrationSupported) {
    throw new ApiError(
      400,
      "Changing gitRepoPath between different code hosts is not supported. Use GitHub→GitHub or Bitbucket→Bitbucket only.",
    );
  }
  if (devRepoMigrationNeeded && !devMigrationSupported) {
    throw new ApiError(
      400,
      "Changing developmentRepoUrl between different code hosts is not supported. Use GitHub→GitHub or Bitbucket→Bitbucket only.",
    );
  }

  let effectiveDevMigrationToken = null;
  if (devMigrationSupported) {
    try {
      const scm = await resolveScmCredentialsFromProject(merged);
      effectiveDevMigrationToken = scm.token?.trim() || null;
    } catch (e) {
      throw new ApiError(
        400,
        e?.message || "Repository credentials are required to migrate developmentRepoUrl",
      );
    }
    if (!effectiveDevMigrationToken) {
      throw new ApiError(400, "A repository token is required to migrate developmentRepoUrl");
    }
  }

  const needsRepoMigrationLock =
    migrationSupported || devMigrationSupported;

  let migrationLockHeld = false;
  if (needsRepoMigrationLock) {
    const lock = await prisma.project.updateMany({
      where: { id: Number(projectId), isUploading: false },
      data: { isUploading: true },
    });
    if (lock.count === 0) {
      throw new ApiError(409, "Upload or migration already in progress for this project");
    }
    migrationLockHeld = true;
    try {
      if (migrationSupported) {
        const versions = await prisma.projectVersion.findMany({
          where: { projectId: Number(projectId) },
          select: { gitTag: true },
        });
        const requiredTags = listProjectVersionTags(versions);
        migrateProjectRepositoryRefs({
          oldGitRepoPath,
          newGitRepoPath: nextNormalizedGitRepoPath,
          githubToken: effectiveGitToken,
          requiredTags,
          backendRoot: getBackendRoot(),
          projectId: Number(projectId),
        });
        refreshSharedGitCacheRemote(
          nextNormalizedGitRepoPath,
          effectiveGitToken,
          getBackendRoot(),
        );
      }
      if (devMigrationSupported) {
        migrateProjectRepositoryRefs({
          oldGitRepoPath: oldDevNorm,
          newGitRepoPath: nextDevNorm,
          githubToken: effectiveDevMigrationToken,
          requiredTags: [],
          backendRoot: getBackendRoot(),
          projectId: Number(projectId),
        });
      }
    } catch (e) {
      throw e;
    } finally {
      if (migrationLockHeld) {
        await prisma.project.update({
          where: { id: Number(projectId) },
          data: { isUploading: false },
        });
      }
    }
  }

  let inviteScm = null;
  try {
    inviteScm = await resolveScmCredentialsFromProject(merged);
  } catch {
    inviteScm = null;
  }
  const inviteToken = inviteScm?.token?.trim() || null;
  const inviteProvider = inviteScm?.provider || null;
  if (inviteToken && inviteProvider) {
    if (
      data.gitRepoPath !== undefined &&
      nextNormalizedGitRepoPath &&
      parseScmRepoPath(nextNormalizedGitRepoPath)?.provider === inviteProvider &&
      oldGitRepoPath !== nextNormalizedGitRepoPath
    ) {
      await inviteDefaultCollaboratorToPath(
        nextNormalizedGitRepoPath,
        inviteToken,
      );
    }
    if (
      data.developmentRepoUrl !== undefined &&
      nextDevNorm &&
      parseScmRepoPath(nextDevNorm)?.provider === inviteProvider &&
      String(oldDevNorm || "") !== String(nextDevNorm || "")
    ) {
      await inviteDefaultCollaboratorToPath(nextDevNorm, inviteToken);
    }
  }

  const updatedProject = await prisma.project.update({
    where: { id: Number(projectId) },
    data,
  });
  if (data.gitRepoPath !== undefined && nextNormalizedGitRepoPath) {
    void ensureLaunchpadPushWebhooksForProject(updatedProject).catch((err) => {
      console.warn(
        `[launchpad webhook] update ensure failed for project ${updatedProject.id}: ${err?.message || err}`,
      );
    });
  }
  return maskProjectSecrets(updatedProject);
};
export const getJiraTicketsService = async (projectId, user) => {
  await assertProjectReadAccess(projectId, user);

  const projectDetails = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      jiraBaseUrl: true,
      jiraProjectKey: true,
      jiraApiToken: true,
      jiraUsername: true,
      jiraConnectionId: true,
      createdById: true,
    },
  });

  const hasJira =
    projectDetails?.jiraBaseUrl &&
    projectDetails?.jiraProjectKey &&
    (projectDetails.jiraConnectionId ||
      (projectDetails.jiraUsername && projectDetails.jiraApiToken));
  if (!hasJira) {
    throw new ApiError(400, "Jira configuration missing for this project");
  }

  const jc = await resolveJiraCredentialsFromProject(projectDetails);
  const ticketCfg = jiraIntegrationConfigFromResolved(jc, projectDetails);
  const result = await fetchProjectJiraTickets(ticketCfg);

  if (!result.success) {
    throw new ApiError(502, `Failed to fetch Jira tickets: ${result.error}`);
  }

  return result.issues;
};



/**
 * Delete stale preview dirs under _preview/ after PREVIEW_TTL_MS.
 * Uses .preview-meta.json { createdAt } next to each project dir when present; else dir mtime.
 * Call periodically and at start of switchProjectVersion.
 */
export async function cleanupStalePreviews(force = false) {
  const backendRoot = getBackendRoot();
  const previewRoot = path.join(backendRoot, "_preview");
  if (!fs.existsSync(previewRoot)) return;
  const now = Date.now();
  if (!force) {
    const stampPath = path.join(previewRoot, PREVIEW_LAST_CLEANUP_FILE);
    try {
      if (await fs.pathExists(stampPath)) {
        const last = Number(await fs.readFile(stampPath, "utf8"));
        if (Number.isFinite(last) && now - last < PREVIEW_CLEANUP_MIN_INTERVAL_MS) {
          return;
        }
      }
    } catch (_) { /* run cleanup */ }
  }
  try {
    const entries = await fs.readdir(previewRoot);
    for (const name of entries) {
      if (!name.startsWith("project_")) continue;
      const dirPath = path.join(previewRoot, name);
      const stat = await fs.stat(dirPath).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;

      let createdAt = null;
      const serveDir = path.join(dirPath, "serve");
      const metaPath = path.join(dirPath, PREVIEW_META_FILE);
      if (await fs.pathExists(metaPath)) {
        try {
          const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
          if (meta && typeof meta.createdAt === "number") createdAt = meta.createdAt;
        } catch (_) { /* ignore */ }
      }
      if (createdAt == null) {
        const serveStat = await fs.stat(serveDir).catch(() => null);
        if (serveStat && serveStat.isDirectory()) {
          createdAt = serveStat.mtimeMs || serveStat.mtime.getTime();
        } else {
          createdAt = stat.mtimeMs || stat.mtime.getTime();
        }
      }
      if (now - createdAt > PREVIEW_TTL_MS) {
        await fs.remove(dirPath).catch((e) => console.warn("[cleanupStalePreviews]", dirPath, e.message));
      }
    }
    // Remove _preview itself if now empty (optional tidy)
    const left = await fs.readdir(previewRoot).catch(() => []);
    if (left.length === 0) {
      await fs.remove(previewRoot).catch(() => { });
    }
  } catch (e) {
    console.warn("[cleanupStalePreviews]", e.message);
  }
  try {
    await fs.writeFile(
      path.join(previewRoot, PREVIEW_LAST_CLEANUP_FILE),
      String(now),
      "utf8",
    );
  } catch (_) { /* ignore */ }
}

/**
 * Switch version: temporary preview only. Checkouts tag, builds, copies to serve, then removes
 * worktree so only serve/ (build output) is kept. Does NOT touch projects/ (live).
 * Old preview for this project is removed at start; stale previews (other projects, >1hr) are cleaned.
 */
export const switchProjectVersion = async (
  projectId,
  versionIdOrTag,
  isPermanent = false
) => {
  return withPreviewBuildLock(projectId, async () => {
    const project = await prisma.project.findUnique({
      where: { id: Number(projectId) },
      select: {
        id: true,
        name: true,
        projectPath: true,
        port: true,
        gitRepoPath: true,
        githubToken: true,
        githubConnectionId: true,
        createdById: true,
        githubUsername: true,
      },
    });
    if (!project) {
      throw new ApiError(404, "Project not found");
    }
    if (!project.port) {
      throw new ApiError(400, "Project has no port; cannot serve preview.");
    }

    let ghTokenPreview = "";
    try {
      ghTokenPreview = (await resolveGithubCredentialsFromProject(project)).githubToken?.trim() || "";
    } catch {
      ghTokenPreview = "";
    }

    let tag;
    let versionLabel;
    const idNum = Number(versionIdOrTag);
    const byId = Number.isInteger(idNum) && String(idNum) === String(versionIdOrTag);
    if (byId) {
      const versionRow = await prisma.projectVersion.findFirst({
        where: { id: idNum, projectId: Number(projectId) },
        select: { gitTag: true, version: true },
      });
      if (!versionRow) {
        throw new ApiError(404, "Version not found");
      }
      tag = versionRow.gitTag && versionRow.gitTag.trim();
      if (!tag) {
        throw new ApiError(400, "Version has no git tag");
      }
      versionLabel = versionRow.version;
    } else {
      tag = String(versionIdOrTag);
      const versionRow = await prisma.projectVersion.findFirst({
        where: { projectId, gitTag: tag },
        select: { version: true },
      });
      versionLabel = versionRow?.version ?? tag;
    }

    const backendRoot = getBackendRoot();
    const projectsDir = getProjectsDir();

    const gitDir = path.join(projectsDir, ".git");
    const hasSharedGit = fs.existsSync(gitDir);

    const previewDir = path.join(backendRoot, "_preview", `project_${projectId}`);
    const previewRepo = path.join(previewDir, "repo");
    const previewServe = path.join(previewDir, "serve");
    const metaPath = path.join(previewDir, PREVIEW_META_FILE);

    // Cache hit: same tag already built under serve/ — skip worktree + npm + build
    try {
      if (await fs.pathExists(previewServe)) {
        const serveEntries = await fs.readdir(previewServe).catch(() => []);
        if (serveEntries.length > 0 && (await fs.pathExists(metaPath))) {
          const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
          if (meta && meta.tag === tag) {
            await fs.writeFile(
              metaPath,
              JSON.stringify({ createdAt: Date.now(), tag }),
              "utf8",
            );
            const domain = config.getBuildUrlHost();
            const projectUrl = `${config.getBuildUrlProtocol()}://${domain}:${project.port}`;
            return {
              message: "Preview ready (cached). Same URL; refresh to see it.",
              version: versionLabel,
              buildUrl: `${projectUrl}?preview=1`,
              cached: true,
            };
          }
        }
      }
    } catch (_) { /* cache miss; continue with full build */ }

    try {
      await cleanupStalePreviews();

      await fs.remove(previewDir).catch(() => { });
      await fs.ensureDir(previewDir);

      if (hasSharedGit) {
        runCommand(`git --git-dir="${gitDir}" worktree prune`, backendRoot);
        deleteLocalGitTag(gitDir, tag);
        // Fetch tag: prefer project's repo (e.g. projects/Launchpad → binalc-web/launchpad) when set
        const fetchFromProjectRepo = () => {
          if (!project.gitRepoPath?.trim() || !ghTokenPreview?.trim()) return false;
          const parsed = parseGitRepoPath(project.gitRepoPath.trim());
          if (!parsed) return false;
          const { owner, repo } = parsed;
          const token = ghTokenPreview.trim();
          const fetchUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
          const gitArgs = (refspec) => ["--git-dir", gitDir, "fetch", fetchUrl, refspec];
          try {
            execFileSync("git", gitArgs(`refs/tags/${tag}:refs/tags/${tag}`), {
              cwd: backendRoot,
              encoding: "utf8",
              timeout: 120000,
            });
            return true;
          } catch {
            try {
              execFileSync("git", [...gitArgs("tag"), tag], {
                cwd: backendRoot,
                encoding: "utf8",
                timeout: 120000,
              });
              return true;
            } catch {
              return false;
            }
          }
        };
        const fetchedFromProject = fetchFromProjectRepo();
        if (!fetchedFromProject) {
          try {
            runCommand(
              `git --git-dir="${gitDir}" fetch origin "refs/tags/${tag}:refs/tags/${tag}"`,
              backendRoot,
            );
          } catch {
            try {
              runCommand(
                `git --git-dir="${gitDir}" fetch origin tag "${tag}"`,
                backendRoot,
              );
            } catch (_) {
              // Tag may already exist locally (e.g. from ZIP upload)
            }
          }
        }
        // Ensure tag exists locally so we give a clear error instead of "invalid reference"
        try {
          runCommand(
            `git --git-dir="${gitDir}" rev-parse --verify "refs/tags/${tag}"`,
            backendRoot,
          );
        } catch {
          const hint = project.gitRepoPath
            ? "Ensure the tag exists on the project's GitHub repo and that gitRepoPath + githubToken are set for this project."
            : "Ensure the tag exists on the remote and that projects/.git remote \"origin\" points to the correct repository, or set the project's gitRepoPath + githubToken.";
          throw new ApiError(
            400,
            `Tag "${tag}" not found. ${hint}`
          );
        }
        runCommand(`git --git-dir="${gitDir}" worktree add "${previewRepo}" "${tag}"`, backendRoot);
      } else {
        if (!ghTokenPreview?.trim() || !project.gitRepoPath?.trim()) {
          throw new ApiError(
            503,
            "Preview unavailable: set gitRepoPath and GitHub credentials on the project, or upload a release once to initialize the server git cache (projects/.git)."
          );
        }
        const parsed = parseGitRepoPath(project.gitRepoPath.trim());
        if (!parsed) {
          throw new ApiError(400, "Invalid gitRepoPath; cannot clone for preview.");
        }
        const { owner, repo } = parsed;
        const token = ghTokenPreview.trim();
        const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
        await fs.ensureDir(previewRepo);
        try {
          execFileSync("git", ["clone", cloneUrl, "."], {
            cwd: previewRepo,
            encoding: "utf8",
            stdio: "pipe",
            timeout: 300000,
          });
          try {
            execFileSync(
              "git",
              ["fetch", "origin", `refs/tags/${tag}:refs/tags/${tag}`],
              { cwd: previewRepo, encoding: "utf8", stdio: "pipe", timeout: 120000 },
            );
          } catch {
            execFileSync("git", ["fetch", "origin", "tag", tag], {
              cwd: previewRepo,
              encoding: "utf8",
              stdio: "pipe",
              timeout: 120000,
            });
          }
          execFileSync("git", ["checkout", tag], {
            cwd: previewRepo,
            encoding: "utf8",
            stdio: "pipe",
            timeout: 60000,
          });
        } catch (e) {
          await fs.remove(previewRepo).catch(() => {});
          throw e;
        }
      }

      const sourceRoot = findProjectRoot(previewRepo);
      const buildOutputPath = await runBuildSequence(sourceRoot, {
        fastInstall: true,
      });
      await fs.ensureDir(previewServe);
      await fs.emptyDir(previewServe);
      await fs.copy(buildOutputPath, previewServe);
      // Marker for TTL cleanup (1 hour); kept beside serve/ so it is not served as static
      await fs.writeFile(
        path.join(previewDir, PREVIEW_META_FILE),
        JSON.stringify({ createdAt: Date.now(), tag }),
        "utf8"
      );

      try {
        if (hasSharedGit) {
          runCommand(
            `git --git-dir="${gitDir}" worktree remove "${previewRepo}" --force`,
            backendRoot
          );
        } else {
          await fs.remove(previewRepo).catch(() => {});
        }
      } catch (e) {
        await fs.remove(previewRepo).catch(() => {});
      }

      const domain = config.getBuildUrlHost();
      const projectUrl = `${config.getBuildUrlProtocol()}://${domain}:${project.port}`;
      const previewUrl = `${projectUrl}?preview=1`;
      return {
        message: "Temporary preview ready. Same URL; refresh the page to see live (projects/) again.",
        version: versionLabel,
        buildUrl: previewUrl,
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      try {
        if (hasSharedGit) {
          runCommand(
            `git --git-dir="${gitDir}" worktree remove "${previewRepo}" --force`,
            backendRoot
          );
        } else {
          await fs.remove(previewRepo).catch(() => {});
        }
      } catch (_) {}
      await fs.remove(previewDir).catch(() => { });
      console.error("[switchProjectVersion] Preview failed:", err.message);
      throw new ApiError(
        500,
        err.message || "Failed to build preview (checkout + build). Live app unchanged."
      );
    }
  });
};

/**
 * Build and serve a temporary preview from a git ref (commit SHA / branch / tag).
 * Does not change live deployment; writes build output under _preview/project_<id>/serve.
 */
export async function buildProjectPreviewFromGitRef({ projectId, gitRef, label = null }) {
  const ref = typeof gitRef === "string" ? gitRef.trim() : "";
  if (!ref) {
    throw new ApiError(400, "Git ref is required");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) {
    throw new ApiError(400, "Invalid git ref format");
  }

  return withPreviewBuildLock(projectId, async () => {

    const project = await prisma.project.findUnique({
      where: { id: Number(projectId) },
      select: {
        id: true,
        port: true,
        gitRepoPath: true,
        githubToken: true,
        githubConnectionId: true,
        createdById: true,
        githubUsername: true,
      },
    });
    if (!project) throw new ApiError(404, "Project not found");
    if (!project.port) throw new ApiError(400, "Project has no port; cannot serve preview.");
    let ghTokRef = "";
    try {
      ghTokRef = (await resolveGithubCredentialsFromProject(project)).githubToken?.trim() || "";
    } catch {
      ghTokRef = "";
    }
    if (!ghTokRef?.trim() || !project.gitRepoPath?.trim()) {
      throw new ApiError(400, "Project is missing GitHub credentials for preview.");
    }

    const parsed = parseGitRepoPath(project.gitRepoPath.trim());
    if (!parsed) throw new ApiError(400, "Invalid gitRepoPath; cannot build preview from ref.");

    const backendRoot = getBackendRoot();
    const previewDir = path.join(backendRoot, "_preview", `project_${project.id}`);
    const previewRepo = path.join(previewDir, "repo");
    const previewServe = path.join(previewDir, "serve");
    const metaPath = path.join(previewDir, PREVIEW_META_FILE);
    const metaRef = ref.toLowerCase();

    try {
      if (await fs.pathExists(previewServe)) {
        const serveEntries = await fs.readdir(previewServe).catch(() => []);
        if (serveEntries.length > 0 && (await fs.pathExists(metaPath))) {
          const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
          if (meta && meta.ref === metaRef) {
            await fs.writeFile(
              metaPath,
              JSON.stringify({ createdAt: Date.now(), ref: metaRef }),
              "utf8",
            );
            const domain = config.getBuildUrlHost();
            const projectUrl = `${config.getBuildUrlProtocol()}://${domain}:${project.port}`;
            return {
              message: "Preview ready (cached).",
              buildUrl: `${projectUrl}?preview=1`,
              cached: true,
              ref,
              label: label || ref,
            };
          }
        }
      }
    } catch (_) {
      // Cache read failures should not block a fresh preview build.
    }

    try {
      await cleanupStalePreviews();
      await fs.remove(previewDir).catch(() => { });
      await fs.ensureDir(previewDir);

      const cloneUrl = `https://x-access-token:${ghTokRef.trim()}@github.com/${parsed.owner}/${parsed.repo}.git`;
      runCommand(`git clone --no-checkout "${cloneUrl}" "${previewRepo}"`, backendRoot);
      try {
        runCommand(`git -C "${previewRepo}" fetch --depth 1 origin "${ref}"`, backendRoot);
        runCommand(`git -C "${previewRepo}" checkout --detach FETCH_HEAD`, backendRoot);
      } catch {
        runCommand(`git -C "${previewRepo}" checkout --detach "${ref}"`, backendRoot);
      }

      const sourceRoot = findProjectRoot(previewRepo);
      const buildOutputPath = await runBuildSequence(sourceRoot, { fastInstall: true });
      await fs.ensureDir(previewServe);
      await fs.emptyDir(previewServe);
      await fs.copy(buildOutputPath, previewServe);

      await fs.writeFile(
        metaPath,
        JSON.stringify({ createdAt: Date.now(), ref: metaRef }),
        "utf8",
      );

      await fs.remove(previewRepo).catch(() => { });
      const domain = config.getBuildUrlHost();
      const projectUrl = `${config.getBuildUrlProtocol()}://${domain}:${project.port}`;
      return {
        message: "Temporary preview ready.",
        buildUrl: `${projectUrl}?preview=1`,
        cached: false,
        ref,
        label: label || ref,
      };
    } catch (err) {
      await fs.remove(previewDir).catch(() => { });
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        500,
        err?.message || "Failed to build preview from git ref.",
      );
    }
  });
}

function execGit(args, cwd) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.error) {
    throw new ApiError(500, r.error.message || "Git failed");
  }
  if (r.status !== 0) {
    const err = [r.stderr, r.stdout].filter(Boolean).join("\n").trim();
    throw new ApiError(
      502,
      err || `Git exited with status ${r.status}: git ${args.join(" ")}`,
    );
  }
  return r.stdout || "";
}

function gitMergeBaseIsAncestor(cwd, ancestor, descendant) {
  const r = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd,
    encoding: "utf8",
  });
  return r.status === 0;
}

/** Remote short branch names whose tips contain `commitSha` (baseline is an ancestor of tip). */
function listRemoteBranchesContainingCommit(workDir, commitSha) {
  const sha = typeof commitSha === "string" ? commitSha.trim() : "";
  if (!sha) return [];
  const r = spawnSync("git", ["branch", "-r", "--contains", sha], {
    cwd: workDir,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.status !== 0) return [];
  const out = (r.stdout || "").trim();
  if (!out) return [];
  const seen = new Set();
  const names = [];
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t || t.includes("->")) continue;
    const slash = t.indexOf("/");
    if (slash < 1) continue;
    const short = t.slice(slash + 1).trim();
    if (!short || short === "HEAD") continue;
    if (seen.has(short)) continue;
    seen.add(short);
    names.push(short);
  }
  return names;
}

/** Preference order for trying branches that `git branch -r --contains` reported. */
function orderRevertBranchCandidates(containing, preferredBranch) {
  const set = new Set(containing);
  const pref =
    typeof preferredBranch === "string" ? preferredBranch.trim() : "";
  const out = [];
  if (pref && set.has(pref)) out.push(pref);
  if (set.has("main") && !out.includes("main")) out.push("main");
  if (set.has("launchpad") && !out.includes("launchpad")) out.push("launchpad");
  for (const x of [...set].sort()) {
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

/** Fetch and checkout a remote branch; returns false if the branch is missing or checkout fails. */
function tryFetchAndCheckoutBranch(workDir, branch) {
  const b = typeof branch === "string" ? branch.trim() : "";
  if (!b) return false;
  const fetchRef = spawnSync(
    "git",
    ["fetch", "origin", `${b}:refs/heads/${b}`],
    { cwd: workDir, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );
  if (fetchRef.status !== 0) {
    const fetchLoose = spawnSync(
      "git",
      ["fetch", "origin", b],
      { cwd: workDir, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
    );
    if (fetchLoose.status !== 0) return false;
  }
  const co = spawnSync("git", ["checkout", b], {
    cwd: workDir,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return co.status === 0;
}

function gitDiffQuiet(cwd, a, b) {
  const r = spawnSync("git", ["diff", "--quiet", a, b], { cwd });
  return r.status === 0;
}

function revertOneCommitInClone(cwd, sha) {
  const line = execGit(["rev-list", "--parents", "-n", "1", sha], cwd).trim();
  const parts = line.split(/\s+/).filter(Boolean);
  const parentCount = parts.length - 1;
  if (parentCount > 1) {
    execGit(["revert", "-m", "1", "--no-edit", sha], cwd);
  } else if (parentCount === 1) {
    execGit(["revert", "--no-edit", sha], cwd);
  } else {
    throw new ApiError(500, "Unexpected commit without parent in revert range.");
  }
}

/**
 * Non-destructive restore: resolves baseline tag to a commit, runs `git fetch origin`, discovers
 * remote branches whose tips contain that commit (`git branch -r --contains`), then tries
 * branches in preference order (client line, `main`, `launchpad`, then others) and uses the
 * first whose tip is **ahead** of the baseline (skips branches already exactly at the baseline
 * so e.g. `main` can be reverted when `launchpad` only sits on the tag).
 *
 * @param {{ projectId: number, activeReleaseId: number, baselineProjectVersionId: number, reason: string, user: object }} opts
 */
export async function revertActiveReleaseToBaselineProjectVersionService({
  projectId,
  activeReleaseId,
  baselineProjectVersionId,
  reason,
  user,
}) {
  await assertProjectAccess(projectId, user);
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  if (!trimmedReason) {
    throw new ApiError(400, "reason is required.");
  }
  const pid = Number(projectId);
  const activeRid = Number(activeReleaseId);
  const baselineVid = Number(baselineProjectVersionId);
  if (!Number.isFinite(pid) || !Number.isFinite(activeRid) || !Number.isFinite(baselineVid)) {
    throw new ApiError(400, "Invalid project or version id.");
  }

  const activeRelease = await prisma.release.findFirst({
    where: { id: activeRid, projectId: pid, status: ReleaseStatus.active },
    select: { id: true, name: true },
  });
  if (!activeRelease) {
    throw new ApiError(
      400,
      "Release must be the project's active release to apply a revert-based revision.",
    );
  }

  const baseline = await prisma.projectVersion.findFirst({
    where: { id: baselineVid, projectId: pid },
    include: {
      release: { select: { id: true, name: true, status: true, projectId: true } },
    },
  });
  if (!baseline?.release) {
    throw new ApiError(404, "Baseline revision not found for this project.");
  }
  if (baseline.release.projectId !== pid) {
    throw new ApiError(400, "Baseline revision does not belong to this project.");
  }
  const baselineTag = (baseline.gitTag || "").trim();
  if (!baselineTag) {
    throw new ApiError(400, "Baseline revision has no git tag.");
  }

  const project = await prisma.project.findUnique({
    where: { id: pid },
    select: {
      id: true,
      name: true,
      projectPath: true,
      port: true,
      gitRepoPath: true,
      createdById: true,
      githubConnectionId: true,
      bitbucketConnectionId: true,
      githubUsername: true,
      githubToken: true,
      bitbucketUsername: true,
      bitbucketToken: true,
    },
  });
  if (!project) {
    throw new ApiError(404, "Project not found.");
  }

  let gitLine;
  try {
    gitLine = await resolveGitSourceForNewClientChatAgent(project, false, activeRid);
  } catch (e) {
    const code = e?.code;
    const msg =
      typeof e?.message === "string"
        ? e.message
        : "Could not resolve Git line for this project.";
    if (code === "REPO_UNRESOLVED" || code === "SCM_NOT_CONFIGURED") {
      throw new ApiError(400, msg);
    }
    if (e instanceof ApiError) throw e;
    throw new ApiError(500, msg);
  }

  const preferredBranch =
    String(gitLine.sourceRef || "").trim() || "main";
  const parsed = gitLine.parsed;
  if (!parsed) {
    throw new ApiError(400, "Could not resolve repository owner/slug for this project.");
  }

  const scm = await resolveScmCredentialsFromProject(project);
  if (parsed.provider !== scm.provider) {
    throw new ApiError(
      400,
      "gitRepoPath must match the connected SCM host (GitHub vs Bitbucket).",
    );
  }
  const validatedProjectName = projectRepoSlugFromDisplayName(project.name);
  const remoteOwner = parsed.owner || scm.username;
  const remoteRepo = parsed.repo || validatedProjectName;
  const cloneUrl =
    scm.provider === "github"
      ? `https://x-access-token:${scm.token}@github.com/${remoteOwner}/${remoteRepo}.git`
      : `https://x-token-auth:${scm.token}@bitbucket.org/${remoteOwner}/${remoteRepo}.git`;

  const lock = await prisma.project.updateMany({
    where: { id: pid, isUploading: false },
    data: { isUploading: true },
  });
  if (lock.count === 0) {
    throw new ApiError(409, "Upload or another git operation is already in progress for this project.");
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `revert_${pid}_`));
  let newTag;
  let newVersionLabel;
  let newVersionId = null;

  try {
    execGit(["clone", cloneUrl, "."], workDir);
    const gitName = (scm.username || "Platform").replace(/"/g, "").slice(0, 60);
    const gitEmail = `${(scm.username || "worker").replace(/@/g, ".")}@${scm.provider === "bitbucket" ? "bitbucket" : "github"}-revert.local`;
    execGit(["config", "user.name", gitName], workDir);
    execGit(["config", "user.email", gitEmail], workDir);
    execGit(["fetch", "origin", "--tags"], workDir);
    execGit(["fetch", "origin"], workDir);

    const revParseBase = spawnSync(
      "git",
      ["rev-parse", `${baselineTag}^{commit}`],
      { cwd: workDir, encoding: "utf8" },
    );
    if (revParseBase.status !== 0) {
      throw new ApiError(
        400,
        `Baseline tag "${baselineTag}" was not found on the remote repository.`,
      );
    }
    const baseCommit = (revParseBase.stdout || "").trim();

    const containingBranches = listRemoteBranchesContainingCommit(workDir, baseCommit);
    if (containingBranches.length === 0) {
      throw new ApiError(
        400,
        `No remote branch on origin contains baseline "${baselineTag}" (${baseCommit.slice(0, 7)}…). ` +
          "Push the tag to this repository and ensure at least one branch tip includes that commit, then retry.",
      );
    }
    const orderedCandidates = orderRevertBranchCandidates(
      containingBranches,
      preferredBranch,
    );
    let revertBranch = null;
    for (const b of orderedCandidates) {
      if (!tryFetchAndCheckoutBranch(workDir, b)) continue;
      const headCommit = execGit(["rev-parse", "HEAD"], workDir).trim();
      if (headCommit === baseCommit) continue;
      if (!gitMergeBaseIsAncestor(workDir, baseCommit, "HEAD")) continue;
      revertBranch = b;
      break;
    }
    if (!revertBranch) {
      throw new ApiError(
        400,
        "No branch has commits after this baseline: every branch that contains the tag already points at that revision. " +
          "Choose an older baseline, or merge so the branch you want to roll back (e.g. main) is ahead of that revision.",
      );
    }

    const revListOut = execGit(
      ["rev-list", "--topo-order", `${baseCommit}..HEAD`],
      workDir,
    ).trim();
    const shas = revListOut ? revListOut.split("\n").filter(Boolean) : [];
    if (shas.length === 0) {
      if (!gitDiffQuiet(workDir, baseCommit, "HEAD")) {
        throw new ApiError(
          400,
          "History has no commits in range but the tree differs from baseline; inspect the repository.",
        );
      }
    } else {
      for (const sha of shas) {
        revertOneCommitInClone(workDir, sha);
      }
      if (!gitDiffQuiet(workDir, baseCommit, "HEAD")) {
        throw new ApiError(
          500,
          "After reverting, the working tree still differs from the baseline. Resolve conflicts manually in a clone.",
        );
      }
    }

    newVersionLabel = await autoGenerateVersion(activeRid);
    newTag = `proj-${pid}-rel-${activeRid}-${newVersionLabel}`;
    execGit(
      [
        "tag",
        "-a",
        newTag,
        "-m",
        `Revert chain to match release "${baseline.release.name}" revision ${baseline.version}`,
      ],
      workDir,
    );

    execGit(["push", "origin", `HEAD:${revertBranch}`], workDir);
    execGit(["push", "origin", newTag], workDir);

    const domain = config.getBuildUrlHost();
    const protocol = config.getBuildUrlProtocol();
    const buildUrlPlaceholder =
      project.port != null ? `${protocol}://${domain}:${project.port}` : "";

    const changedByEmail = await resolveUserEmail(user);
    const created = await prisma.$transaction(async (tx) => {
      await tx.releaseChangeLog.create({
        data: {
          releaseId: activeRid,
          reason: trimmedReason,
          changedById: user?.id ?? null,
          changedByEmail: changedByEmail || null,
          changes: {
            action: "revert_active_to_baseline",
            baselineProjectVersionId: baselineVid,
            baselineReleaseName: baseline.release.name,
            baselineVersionLabel: baseline.version,
            baselineGitTag: baselineTag,
            newGitTag: newTag,
            newVersionLabel,
            workflowBranch: revertBranch,
            preferredWorkflowBranch: preferredBranch,
            branchesContainingBaseline: containingBranches,
          },
        },
      });
      return tx.projectVersion.create({
        data: {
          projectId: pid,
          releaseId: activeRid,
          version: newVersionLabel,
          gitTag: newTag,
          buildUrl: buildUrlPlaceholder || "pending",
          isActive: false,
          uploadedBy: user.id,
        },
      });
    });
    newVersionId = created.id;
  } finally {
    await fs.remove(workDir).catch(() => { });
    await prisma.project.update({
      where: { id: pid },
      data: { isUploading: false },
    });
  }

  if (newVersionId == null) {
    throw new ApiError(500, "Revert did not complete; no revision was created.");
  }

  const activated = await activateProjectVersionService({
    projectId: pid,
    versionId: newVersionId,
    user,
  });

  scheduleRegenerateClientReviewSummary(activeRid);

  return {
    message: "Active release updated with a new revision from revert commits.",
    version: activated.version,
    buildUrl: activated.buildUrl,
    tag: activated.tag,
    gitTag: newTag,
    versionLabel: newVersionLabel,
  };
}
