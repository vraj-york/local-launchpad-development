import { PrismaClient, ReleaseStatus } from "@prisma/client";
import { resolveScmCredentialsFromProject } from "./integrationCredential.service.js";
import path from "path";
import fs from "fs-extra";
import extract from "extract-zip";
import { execSync, spawn, exec } from "child_process";
import fetch from "node-fetch";
import ApiError from "../utils/apiError.js";
import config from "../config/index.js";
import { getBackendRoot } from "../utils/instanceRoot.js";
import {
  projectRepoSlugFromDisplayName,
  toDate,
  assertReleaseNameIsNextIncrement,
} from "../utils/projectValidation.utils.js";
import { getRepositoryMetadata, parseGitRepoPath } from "./github.service.js";
import { parseScmRepoPath } from "../utils/scmPath.js";
import {
  getBitbucketRepositoryMetadata,
  createBitbucketRepository,
} from "./bitbucket.service.js";
import { parseStoredEmailListToSet } from "../utils/emailList.utils.js";
import { promisify } from "util";
import os from "os";
import { execa } from "execa";
import { scheduleRegenerateClientReviewSummary } from "./releaseReviewSummary.service.js";
import { signalNginxReload } from "../utils/nginxBinary.js";

const execAsync = promisify(exec);
const prisma = new PrismaClient();

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

async function assertProjectReadPermission(projectId, user) {
  const project = await prisma.project.findUnique({
    where: { id: Number(projectId) },
    select: { id: true, createdById: true, assignedUserEmails: true },
  });
  if (!project) throw new ApiError(404, "Project not found");
  const { id: userId, role } = user || {};
  if (role === "admin") return project;
  if (Number(project.createdById) === Number(userId)) return project;
  const email = await resolveUserEmail(user);
  const assignedUsers = parseStoredEmailListToSet(project.assignedUserEmails);
  if (email && assignedUsers.has(email)) return project;
  throw new ApiError(403, "Forbidden");
}

function datesEqual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

function dateToIsoOrNull(d) {
  if (d == null) return null;
  return new Date(d).toISOString();
}

async function appendReleaseChangeLog(tx, {
  releaseId,
  reason,
  changedById,
  changedByEmail,
  changes,
}) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!trimmed) {
    throw new ApiError(400, "reason is required for this change.");
  }
  if (!changes || typeof changes !== "object" || Object.keys(changes).length === 0) {
    throw new ApiError(500, "Internal: changelog must include at least one field change.");
  }
  await tx.releaseChangeLog.create({
    data: {
      releaseId,
      reason: trimmed,
      changedById: changedById ?? null,
      changedByEmail: changedByEmail ?? null,
      changes,
    },
  });
}

// Project locks to prevent concurrent uploads
const projectLocks = new Map();

// Rate limiting for GitHub API
const githubApiCalls = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_CALLS_PER_WINDOW = 10;

// --- Helper Functions (Private) ---

function sanitizeCommand(command) {
  const dangerousChars = /[;&|`$(){}[\]\\]/g;
  if (dangerousChars.test(command)) {
    throw new ApiError(400, "Command contains potentially dangerous characters");
  }
  return command;
}

export function findProjectRoot(dir) {
  const ignoreList = [
    ".git",
    ".cursor", // Cursor IDE rules/config — never the npm app root (avoids wrong root e.g. .cursor/rules)
    ".gitignore",
    ".gitattributes",
    ".npmignore",
    "README.md",
    "LICENSE",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    "node_modules",
    "build",
    "dist",
  ];

  const packageJsonPath = path.join(dir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    return dir;
  }

  const items = fs.readdirSync(dir);
  const directories = items.filter((item) => {
    const itemPath = path.join(dir, item);
    const isDirectory = fs.statSync(itemPath).isDirectory();
    const shouldIgnore = ignoreList.includes(item);
    return isDirectory && !shouldIgnore;
  });

  if (directories.length === 1) {
    const subDir = path.join(dir, directories[0]);
    const subPackageJson = path.join(subDir, "package.json");
    if (fs.existsSync(subPackageJson)) {
      return subDir;
    }
    return findProjectRoot(subDir);
  }

  for (const subDir of directories) {
    const subDirPath = path.join(dir, subDir);
    const found = findProjectRoot(subDirPath);
    if (found) return found;
  }

  return dir;
}

async function findHtmlEntry(projectRoot) {
  const candidates = [
    path.join(projectRoot, "index.html"), // Vite
    path.join(projectRoot, "public", "index.html"), // CRA
  ];

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return file;
    }
  }

  return null;
}
async function withProjectLock(projectName, operation) {
  if (projectLocks.has(projectName)) {
    throw new ApiError(
      "Project is currently being processed. Please try again in a moment.",
    );
  }

  projectLocks.set(projectName, true);
  try {
    return await operation();
  } finally {
    projectLocks.delete(projectName);
  }
}

/** Call after deleting a project so the lock map does not retain the name. */
export function clearProjectLock(projectName) {
  projectLocks.delete(projectName);
}

function checkRateLimit() {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;

  for (const [timestamp] of githubApiCalls) {
    if (timestamp < windowStart) {
      githubApiCalls.delete(timestamp);
    }
  }

  if (githubApiCalls.size >= MAX_CALLS_PER_WINDOW) {
    throw new ApiError(
      "GitHub API rate limit exceeded. Please try again later.",
    );
  }

  githubApiCalls.set(now, true);
}

export async function createGithubRepo(repoName, credentials = {}) {
  checkRateLimit();

  const username = credentials.githubUsername?.trim();
  const token = credentials.githubToken?.trim();

  if (!token || !username) {
    throw new ApiError(
      "GitHub credentials not configured. Set githubUsername and githubToken on the project.",
    );
  }

  const response = await fetch(`https://api.github.com/user/repos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "GitHub-Zip-Worker/1.0",
    },
    body: JSON.stringify({
      name: repoName,
      private: false,
      description: `Auto-generated repository for ${repoName}`,
      // Creates default branch (main) with initial README commit so clone/push has a base
      auto_init: true,
    }),
  });

  const responseBody = await response.text();

  if (response.status === 201) {
    // Repo created successfully
    return;
  }
  if (response.status === 422) {
    // 422 = validation failed: often "repo already exists" - if so, treat as success and continue to push
    const creds = { githubUsername: username, githubToken: token };
    const exists = await checkRepoExists(repoName, creds);
    if (exists) return;

    let errDetail = responseBody;
    try {
      const parsed = JSON.parse(responseBody);
      const msg = parsed.message || "";
      const errors = parsed.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        const parts = errors.map(
          (e) => e.message || e.code || JSON.stringify(e),
        );
        errDetail = [msg, ...parts].filter(Boolean).join("; ");
      } else if (msg) {
        errDetail = msg;
      }
      // If GitHub says name/repo "already exists", repo might exist but GET failed (e.g. token scope) - don't throw, allow push to be tried
      const lower = (
        msg + (errors || []).map((e) => (e && e.message) || "").join(" ")
      ).toLowerCase();
      if (
        lower.includes("already exists") ||
        lower.includes("name already exists")
      ) {
        return;
      }
    } catch (_) {
      /* use responseBody */
    }
    const hint =
      "If the repo already exists under this account, ensure the token has repo access and try again; otherwise use a different repo name.";
    throw new ApiError(
      400,
      `GitHub repo creation failed (422): ${errDetail}. ${hint}`,
    );
  }
  if (response.status === 401) {
    throw new ApiError(
      "GitHub authentication failed. Check the project's githubToken.",
    );
  }
  if (response.status === 403) {
    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    if (rateLimitRemaining === "0") {
      throw new ApiError(
        "GitHub API rate limit exceeded. Please try again later.",
      );
    }
    throw new ApiError(
      'GitHub API access forbidden. Please check your token has "repo" scope.',
    );
  }
  if (!response.ok) {
    throw new ApiError(
      `GitHub repo creation failed (${response.status}): ${responseBody}`,
    );
  }
}

/**
 * Add a collaborator to a repo (GitHub emails them an invitation if pending).
 * @param {string} owner - GitHub username/org
 * @param {string} repo - repo name
 * @param {string} collaborator - GitHub username (email not supported by REST; use username before @ if value looks like email)
 * @param {string} token
 * @param {string} permission - pull | push | admin
 */
export async function addGithubCollaborator(
  owner,
  repo,
  collaborator,
  token,
  permission = "push",
) {
  if (!collaborator || !token || !owner || !repo) return;
  let username = collaborator.trim();
  if (username.includes("@") && !username.includes(" ")) {
    username = username.split("@")[0];
  }
  checkRateLimit();
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "GitHub-Zip-Worker/1.0",
    },
    body: JSON.stringify({ permission }),
  });
  if (response.status === 204 || response.status === 201) {
    return true;
  }
  const text = await response.text();
  if (response.status === 404) {
    console.warn(
      `[addGithubCollaborator] User ${username} not found or no access: ${text}`,
    );
    return false;
  }
  if (response.status === 422) {
    console.warn(`[addGithubCollaborator] ${text}`);
    return false;
  }
  if (!response.ok) {
    console.warn(
      `[addGithubCollaborator] ${response.status}: ${text}`,
    );
  }
  return response.ok;
}

export async function checkRepoExists(repoName, credentials = {}) {
  checkRateLimit();

  const username = credentials.githubUsername?.trim();
  const token = credentials.githubToken?.trim();

  const response = await fetch(
    `https://api.github.com/repos/${username}/${repoName}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "GitHub-Zip-Worker/1.0",
      },
    },
  );

  return response.status === 200;
}

function runCommand(command, cwd, options = {}) {
  const sanitizedCommand = sanitizeCommand(command);

  const defaultOptions = {
    cwd,
    encoding: "utf-8",
    // 1. Ensure shell is true so Node handles the command string correctly
    shell: true,
    env: {
      ...process.env,
      NODE_PATH: `${cwd}/node_modules`,
      // 2. Fallback to a blank string if process.env.PATH is undefined
      PATH: `${process.env.PATH || ""}:${cwd}/node_modules/.bin`,
    },
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
  };

  const finalOptions = { ...defaultOptions, ...options };

  try {
    return execSync(sanitizedCommand, finalOptions);
  } catch (error) {
    console.error(`Command failed: ${sanitizedCommand} - ${error.message}`);

    if (error.code === "TIMEOUT") {
      throw new ApiError(
        `Command timed out after ${finalOptions.timeout}ms: ${sanitizedCommand}`,
      );
    } else if (error.message.includes("maxBuffer")) {
      throw new ApiError(
        `Command output too large (>10MB): ${sanitizedCommand}`,
      );
    }

    throw error;
  }
}

// --- Service Functions ---

/**
 * List releases for a project — all statuses (draft, active, locked).
 * Do not filter to active+locked only; drafts must appear for create/edit flows.
 */
export const listReleasesService = async (projectId, user) => {
  await assertProjectReadPermission(projectId, user);

  return prisma.release.findMany({
    where: { projectId },
    include: {
      creator: {
        select: { id: true, name: true, email: true },
      },
      versions: {
        orderBy: { createdAt: "desc" },
        include: {
          uploader: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};

/**
 * Get single release by ID
 */
export const getReleaseByIdService = async (releaseId, user) => {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          assignedManagerId: true,
        },
      },
      versions: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { version: true, createdAt: true },
      },
    },
  });

  if (!release) {
    throw new ApiError(404, "Release not found");
  }
  await assertProjectReadPermission(release.project.id, user);
  return release;
};

/**
 * Audit history for a release (newest first).
 */
export const getReleaseChangelogService = async (releaseId, user) => {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: {
      projectId: true,
    },
  });
  if (!release) throw new ApiError(404, "Release not found");
  await assertProjectReadPermission(release.projectId, user);

  return prisma.releaseChangeLog.findMany({
    where: { releaseId },
    orderBy: { createdAt: "desc" },
    include: {
      changedBy: { select: { id: true, name: true, email: true } },
    },
  });
};

/**
 * Create a new release
 */
export const createReleaseService = async (data, user) => {
  const {
    projectId,
    name,
    description,
    roadmapItemId,
    isMvp,
    releaseDate: releaseDateInput,
    actualReleaseDate: actualReleaseDateInput,
    actualReleaseNotes: actualReleaseNotesInput,
    startDate: startDateInput,
    clientReleaseNote: clientNoteInput,
  } = data;
  const { id: userId } = user;

  // Check access
  await assertProjectReadPermission(projectId, user);

  // Allow creating new releases in draft mode even when previous release is not locked

  const releaseNameTrimmed = name && typeof name === "string" ? name.trim() : "";
  if (!releaseNameTrimmed) {
    throw new ApiError(400, "Release name is required");
  }

  await assertReleaseNameIsNextIncrement(projectId, releaseNameTrimmed, prisma);

  // Release name must be unique within this project (case-insensitive)
  const existingRelease = await prisma.release.findFirst({
    where: {
      projectId,
      name: { equals: releaseNameTrimmed, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (existingRelease) {
    throw new ApiError(400, "Release name already exists for this project. Choose a unique name.");
  }

  // Verify roadmap item if provided
  if (roadmapItemId) {
    const roadmapItem = await prisma.roadmapItem.findUnique({
      where: { id: roadmapItemId },
      include: { roadmap: true },
    });
    if (!roadmapItem) {
      throw new ApiError(404, "Roadmap item not found");
    }
    // Ensure roadmap item belongs to the same project
    if (roadmapItem.roadmap.projectId !== projectId) {
      throw new ApiError(400, "Roadmap item does not belong to this project");
    }
  }

  const shipDate =
    releaseDateInput != null && releaseDateInput !== ""
      ? toDate(releaseDateInput, "releaseDate")
      : null;
  const actualShipDate =
    actualReleaseDateInput != null && actualReleaseDateInput !== ""
      ? toDate(actualReleaseDateInput, "actualReleaseDate")
      : null;
  const startDate =
    startDateInput != null && startDateInput !== ""
      ? toDate(startDateInput, "startDate")
      : null;

  const clientReleaseNote =
    typeof clientNoteInput === "string" && clientNoteInput.trim()
      ? clientNoteInput.trim()
      : null;
  const actualReleaseNotes =
    typeof actualReleaseNotesInput === "string" && actualReleaseNotesInput.trim()
      ? actualReleaseNotesInput.trim()
      : null;

  return prisma.$transaction(async (tx) => {
    const release = await tx.release.create({
      data: {
        projectId,
        name: releaseNameTrimmed,
        description: description?.trim() || null,
        status: ReleaseStatus.draft,
        isMvp: Boolean(isMvp),
        releaseDate: shipDate,
        actualReleaseDate: actualShipDate,
        actualReleaseNotes,
        startDate,
        clientReleaseNote,
        createdBy: userId,
      },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Link roadmap item if provided
    if (roadmapItemId) {
      await tx.roadmapItem.update({
        where: { id: roadmapItemId },
        data: { releaseId: release.id },
      });
    }

    return release;
  });
};

/**
 * Single place that enforces: at most one project version is live (isActive), and only when its
 * release has status `active` — the latest version in that release wins. Call from release status / lock transitions only
 * (not after manual activate-version or upload; those set isActive deliberately).
 */
export async function syncProjectActiveVersionForProject(tx, projectId) {
  const activeRelease = await tx.release.findFirst({
    where: { projectId, status: ReleaseStatus.active },
    select: { id: true },
  });
  await tx.projectVersion.updateMany({
    where: { projectId },
    data: { isActive: false },
  });
  if (activeRelease) {
    const latest = await tx.projectVersion.findFirst({
      where: { projectId, releaseId: activeRelease.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (latest) {
      await tx.projectVersion.update({
        where: { id: latest.id },
        data: { isActive: true },
      });
    }
  }
}

/** Clear isActive on all project versions tied to this release (only isActive is updated). */
async function deactivateProjectVersionsForRelease(tx, releaseId) {
  await tx.projectVersion.updateMany({
    where: { releaseId },
    data: { isActive: false },
  });
}

/**
 * Set release status: draft | active | locked | skip.
 * — Only one release per project may be active; setting a release to active demotes any other active release in the project to draft (locked releases are unchanged).
 * — A locked release cannot change status via this endpoint (idempotent `locked` is a no-op).
 * — After activation, sync sets the newly active release’s latest version as the project-active build.
 */
const RELEASE_STATUS_VALUES = Object.values(ReleaseStatus);

export const setReleaseStatusService = async (releaseId, status, user, options = {}) => {
  const { id: userId } = user;
  const reasonRaw = options?.reason;
  const releaseStatus = status && String(status).toLowerCase();
  if (!RELEASE_STATUS_VALUES.includes(releaseStatus)) {
    throw new ApiError(400, `status must be one of: ${RELEASE_STATUS_VALUES.join(", ")}`);
  }

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: {
      id: true,
      projectId: true,
      status: true,
      project: { select: { assignedManagerId: true } },
    },
  });
  if (!release) throw new ApiError(404, "Release not found");
  await assertProjectReadPermission(release.projectId, user);

  const isLockedState = release.status === ReleaseStatus.locked;

  // Locked releases: no status changes via this endpoint.
  if (isLockedState && releaseStatus !== ReleaseStatus.locked) {
    throw new ApiError(
      400,
      "A locked release cannot change status.",
    );
  }

  if (isLockedState && releaseStatus === ReleaseStatus.locked) {
    return prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        versions: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
  }

  if (releaseStatus === ReleaseStatus.active && release.status === ReleaseStatus.active) {
    return prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        versions: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
  }

  if (releaseStatus === ReleaseStatus.draft && release.status === ReleaseStatus.draft) {
    return prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        versions: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
  }

  if (releaseStatus === ReleaseStatus.skip && release.status === ReleaseStatus.skip) {
    return prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        versions: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
  }

  const isLockTransition = releaseStatus === ReleaseStatus.locked;
  const reasonTrim =
    typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  if (!isLockTransition && !reasonTrim) {
    throw new ApiError(400, "reason is required when changing release status.");
  }

  const statusChangePayload = {
    status: { from: release.status, to: releaseStatus },
  };

  await prisma.$transaction(async (tx) => {
    if (releaseStatus === ReleaseStatus.locked) {
      await tx.release.update({
        where: { id: releaseId },
        data: {
          status: ReleaseStatus.locked,
        },
      });
      await syncProjectActiveVersionForProject(tx, release.projectId);
      return;
    }

    if (releaseStatus === ReleaseStatus.active) {
      await tx.release.updateMany({
        where: {
          projectId: release.projectId,
          id: { not: releaseId },
          status: ReleaseStatus.active,
        },
        data: {
          status: ReleaseStatus.draft,
        },
      });

      await tx.release.update({
        where: { id: releaseId },
        data: {
          status: ReleaseStatus.active,
        },
      });
      await appendReleaseChangeLog(tx, {
        releaseId,
        reason: reasonTrim,
        changedById: userId,
        changes: statusChangePayload,
      });
      await syncProjectActiveVersionForProject(tx, release.projectId);
      return;
    }

    if (releaseStatus === ReleaseStatus.skip) {
      await tx.release.updateMany({
        where: {
          projectId: release.projectId,
          id: { not: releaseId },
          status: ReleaseStatus.active,
        },
        data: {
          status: ReleaseStatus.draft,
        },
      });
      await tx.release.update({
        where: { id: releaseId },
        data: {
          status: ReleaseStatus.skip,
        },
      });
      await appendReleaseChangeLog(tx, {
        releaseId,
        reason: reasonTrim,
        changedById: userId,
        changes: statusChangePayload,
      });
      await syncProjectActiveVersionForProject(tx, release.projectId);
      return;
    }

    // draft
    await tx.release.update({
      where: { id: releaseId },
      data: {
        status: ReleaseStatus.draft,
      },
    });
    await appendReleaseChangeLog(tx, {
      releaseId,
      reason: reasonTrim,
      changedById: userId,
      changes: statusChangePayload,
    });
    await syncProjectActiveVersionForProject(tx, release.projectId);
  });

  if (releaseStatus === ReleaseStatus.active) {
    const { deployActiveVersionToProjectFolder } = await import("./project.service.js");
    await deployActiveVersionToProjectFolder({
      projectId: release.projectId,
      user,
    });
    scheduleRegenerateClientReviewSummary(releaseId);
  }

  return prisma.release.findUnique({
    where: { id: releaseId },
    include: {
      versions: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
};

/**
 * Lock a release (one-way). Clears isActive on all versions for this release only.
 * Unlock is not supported.
 */
export const lockReleaseService = async (releaseId, locked, user) => {
  const { id: userId } = user;

  if (locked !== true) {
    throw new ApiError(400, "Unlocking a release is not allowed.");
  }

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: {
      id: true,
      projectId: true,
      status: true,
      project: { select: { assignedManagerId: true } },
    },
  });

  if (!release) {
    throw new ApiError(404, "Release not found");
  }
  await assertProjectReadPermission(release.projectId, user);

  if (release.status === ReleaseStatus.locked) {
    throw new ApiError(400, "Release is already locked");
  }

  const [projectFull, releaseRow] = await Promise.all([
    prisma.project.findUnique({ where: { id: release.projectId } }),
    prisma.release.findUnique({
      where: { id: releaseId },
      select: { name: true },
    }),
  ]);
  if (!projectFull) {
    throw new ApiError(404, "Project not found");
  }

  const { syncDeveloperRepoSubmoduleForReleaseLock } = await import(
    "./developerRepoSubmodule.service.js"
  );
  await syncDeveloperRepoSubmoduleForReleaseLock({
    releaseId,
    project: projectFull,
    releaseName: releaseRow?.name,
  });

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.release.update({
      where: { id: releaseId },
      data: {
        status: ReleaseStatus.locked,
      },
    });
    await deactivateProjectVersionsForRelease(tx, releaseId);
    return row;
  });
  return updated;
};

/**
 * Partial update: name, description, isMvp, releaseDate, actualReleaseDate, actualReleaseNotes, startDate,
 * clientReleaseNote, clientReviewAiSummary, showClientReviewSummary, clientReviewAiGenerationContext.
 * Locked releases may only update client-link fields (release note, what-to-review text, AI context, visibility).
 * Requires non-empty reason when any non–client-facing field actually changes.
 */
export const updateReleaseService = async (releaseId, data, user) => {
  const { id: userId } = user;
  const {
    name,
    description,
    isMvp,
    releaseDate: releaseDateInput,
    actualReleaseDate: actualReleaseDateInput,
    actualReleaseNotes: actualReleaseNotesInput,
    startDate: startDateInput,
    reason: reasonRaw,
    clientReleaseNote: clientNoteInput,
    clientReviewAiSummary: clientReviewAiSummaryInput,
    showClientReviewSummary: showClientReviewSummaryInput,
    clientReviewAiGenerationContext: clientReviewAiGenerationContextInput,
  } = data;

  const current = await prisma.release.findUnique({
    where: { id: releaseId },
    select: {
      id: true,
      projectId: true,
      status: true,
      name: true,
      description: true,
      isMvp: true,
      releaseDate: true,
      actualReleaseDate: true,
      actualReleaseNotes: true,
      startDate: true,
      clientReleaseNote: true,
      clientReviewAiSummary: true,
      showClientReviewSummary: true,
      clientReviewAiGenerationContext: true,
      project: { select: { assignedManagerId: true } },
    },
  });
  if (!current) throw new ApiError(404, "Release not found");
  await assertProjectReadPermission(current.projectId, user);

  const locked = current.status === ReleaseStatus.locked;

  const wantsClientNote = clientNoteInput !== undefined;
  const wantsClientReviewSummary = clientReviewAiSummaryInput !== undefined;
  const wantsShowClientReviewSummary = showClientReviewSummaryInput !== undefined;
  const wantsClientReviewAiGenerationContext =
    clientReviewAiGenerationContextInput !== undefined;
  const wantsClientLinkPatch =
    wantsClientNote ||
    wantsClientReviewSummary ||
    wantsShowClientReviewSummary ||
    wantsClientReviewAiGenerationContext;

  const wantsOther =
    name !== undefined ||
    description !== undefined ||
    isMvp !== undefined ||
    releaseDateInput !== undefined ||
    actualReleaseDateInput !== undefined ||
    actualReleaseNotesInput !== undefined ||
    startDateInput !== undefined;

  if (!wantsClientLinkPatch && !wantsOther) {
    throw new ApiError(400, "No updatable fields provided");
  }

  if (locked && wantsOther) {
    throw new ApiError(
      400,
      "Cannot update a locked release except client link fields (release note, what to review, AI context, visibility).",
    );
  }

  const updateData = {};
  const changes = {};

  if (wantsClientNote) {
    const next =
      clientNoteInput == null || clientNoteInput === ""
        ? null
        : String(clientNoteInput).trim() || null;
    const prev = current.clientReleaseNote ?? null;
    if (next !== prev) {
      updateData.clientReleaseNote = next;
      changes.clientReleaseNote = { from: prev, to: next };
    }
  }

  if (wantsClientReviewSummary) {
    const next =
      clientReviewAiSummaryInput == null || clientReviewAiSummaryInput === ""
        ? null
        : String(clientReviewAiSummaryInput).trim() || null;
    const prev = current.clientReviewAiSummary ?? null;
    if (next !== prev) {
      updateData.clientReviewAiSummary = next;
      changes.clientReviewAiSummary = { from: prev, to: next };
    }
  }

  if (wantsShowClientReviewSummary) {
    const next = Boolean(showClientReviewSummaryInput);
    const prev = Boolean(current.showClientReviewSummary);
    if (next !== prev) {
      updateData.showClientReviewSummary = next;
      changes.showClientReviewSummary = { from: prev, to: next };
    }
  }

  if (wantsClientReviewAiGenerationContext) {
    const next =
      clientReviewAiGenerationContextInput == null ||
      clientReviewAiGenerationContextInput === ""
        ? null
        : String(clientReviewAiGenerationContextInput).trim() || null;
    const prev = current.clientReviewAiGenerationContext ?? null;
    if (next !== prev) {
      updateData.clientReviewAiGenerationContext = next;
      changes.clientReviewAiGenerationContext = { from: prev, to: next };
    }
  }

  if (!locked && name !== undefined) {
    const releaseNameTrimmed =
      name && typeof name === "string" ? name.trim() : "";
    if (!releaseNameTrimmed) {
      throw new ApiError(400, "Release name cannot be empty");
    }
    const existingRelease = await prisma.release.findFirst({
      where: {
        projectId: current.projectId,
        id: { not: releaseId },
        name: { equals: releaseNameTrimmed, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existingRelease) {
      throw new ApiError(
        400,
        "Release name already exists for this project. Choose a unique name.",
      );
    }
    if (releaseNameTrimmed !== current.name) {
      updateData.name = releaseNameTrimmed;
      changes.name = { from: current.name, to: releaseNameTrimmed };
    }
  }

  if (!locked && description !== undefined) {
    const nextDesc =
      description == null || description === ""
        ? null
        : String(description).trim() || null;
    const prevDesc = current.description ?? null;
    if (nextDesc !== prevDesc) {
      updateData.description = nextDesc;
      changes.description = { from: prevDesc, to: nextDesc };
    }
  }

  if (!locked && isMvp !== undefined) {
    const nextMvp = Boolean(isMvp);
    if (nextMvp !== current.isMvp) {
      updateData.isMvp = nextMvp;
      changes.isMvp = { from: current.isMvp, to: nextMvp };
    }
  }

  if (!locked && releaseDateInput !== undefined) {
    const nextDate =
      releaseDateInput === null || releaseDateInput === ""
        ? null
        : toDate(releaseDateInput, "releaseDate");
    if (!datesEqual(nextDate, current.releaseDate)) {
      updateData.releaseDate = nextDate;
      changes.releaseDate = {
        from: dateToIsoOrNull(current.releaseDate),
        to: dateToIsoOrNull(nextDate),
      };
    }
  }

  if (!locked && actualReleaseDateInput !== undefined) {
    const nextActual =
      actualReleaseDateInput === null || actualReleaseDateInput === ""
        ? null
        : toDate(actualReleaseDateInput, "actualReleaseDate");
    if (!datesEqual(nextActual, current.actualReleaseDate)) {
      updateData.actualReleaseDate = nextActual;
      changes.actualReleaseDate = {
        from: dateToIsoOrNull(current.actualReleaseDate),
        to: dateToIsoOrNull(nextActual),
      };
    }
  }

  if (!locked && actualReleaseNotesInput !== undefined) {
    const nextNotes =
      actualReleaseNotesInput == null || actualReleaseNotesInput === ""
        ? null
        : String(actualReleaseNotesInput).trim() || null;
    const prevNotes = current.actualReleaseNotes ?? null;
    if (nextNotes !== prevNotes) {
      updateData.actualReleaseNotes = nextNotes;
      changes.actualReleaseNotes = { from: prevNotes, to: nextNotes };
    }
  }

  if (!locked && startDateInput !== undefined) {
    const nextStart =
      startDateInput === null || startDateInput === ""
        ? null
        : toDate(startDateInput, "startDate");
    if (!datesEqual(nextStart, current.startDate)) {
      updateData.startDate = nextStart;
      changes.startDate = {
        from: dateToIsoOrNull(current.startDate),
        to: dateToIsoOrNull(nextStart),
      };
    }
  }

  if (Object.keys(updateData).length === 0) {
    return prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
    });
  }

  const reasonTrim =
    typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  const clientLinkChangeKeys = new Set([
    "clientReleaseNote",
    "clientReviewAiSummary",
    "showClientReviewSummary",
    "clientReviewAiGenerationContext",
  ]);
  const onlyClientChanges =
    Object.keys(changes).length > 0 &&
    Object.keys(changes).every((k) => clientLinkChangeKeys.has(k));
  if (!onlyClientChanges && !reasonTrim) {
    throw new ApiError(400, "reason is required when changing release fields.");
  }

  const logReason =
    reasonTrim ||
    (onlyClientChanges
      ? "Updated client link fields (release note / what to review / AI context)"
      : reasonTrim);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.release.update({
      where: { id: releaseId },
      data: updateData,
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
    });
    await appendReleaseChangeLog(tx, {
      releaseId,
      reason: logReason,
      changedById: userId,
      changes,
    });
    return updated;
  });

  const shouldRegenAiSummary =
    "clientReleaseNote" in changes ||
    "clientReviewAiGenerationContext" in changes ||
    "name" in changes ||
    "description" in changes ||
    "actualReleaseNotes" in changes;
  if (shouldRegenAiSummary) {
    scheduleRegenerateClientReviewSummary(releaseId);
  }

  return row;
};

/**
 * Next upload revision for a release: R1, R2, R3, … (only R-prefixed rows count).
 * Legacy semver rows (e.g. 1.0.0) are ignored for the counter.
 */
export const autoGenerateVersion = async (releaseId) => {
  const rows = await prisma.projectVersion.findMany({
    where: { releaseId },
    select: { version: true },
  });

  let maxN = 0;
  const re = /^R(\d+)$/i;
  for (const row of rows) {
    const m = String(row.version || "").match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > maxN) maxN = n;
    }
  }

  return `R${maxN + 1}`;
};

/**
 * Runs npm install and npm run build within the provided temp directory.
 * Streams output to the main console for real-time debugging.
 */
/**
 * @param {string} buildContextPath
 * @param {{ fastInstall?: boolean }} opts - fastInstall uses offline-preferring install (preview/switch only)
 */
/** Next 15+ may use Turbopack for `next build`; nested apps under backend/_preview or _tmp_builds pick up backend/package-lock.json and mis-detect workspace root. `next build --webpack` avoids that. */
function shouldUseNextWebpackBuild(pkg) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (!deps.next) return false;
  const m = String(deps.next).match(/(\d+)/);
  const major = m ? parseInt(m[1], 10) : 0;
  return major >= 15;
}

function isNextProject(pkg) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return Boolean(deps.next);
}

/** True if next.config source already requests static HTML export. */
function configFileHasStaticExport(content) {
  return /\boutput\s*:\s*['"]export['"]/.test(String(content || ""));
}

/**
 * Heuristic injection for next.config.ts / .mts when we cannot use an import wrapper.
 * Matches common create-next-app shapes; returns null if we cannot safely patch.
 */
function tryInjectStaticExportIntoNextConfigTsLike(content) {
  if (configFileHasStaticExport(content)) return content;

  const inject =
    "\n  output: 'export',\n  images: { unoptimized: true }," +
    "\n  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),";

  const patterns = [
    /(const\s+nextConfig\s*:\s*NextConfig\s*=\s*\{)/,
    /(const\s+nextConfig\s*=\s*\{)/,
    /(export\s+default\s*\{)/,
  ];

  for (const re of patterns) {
    if (!re.test(content)) continue;
    let next = content.replace(re, `$1${inject}`);
    if (next === content) continue;
    if (
      !/import\s+(?:\*\s+as\s+)?path\s+from\s+['"](node:)?path['"]/.test(next)
    ) {
      next = `import path from "path";\n${next}`;
    }
    if (!/import\s+{\s*fileURLToPath\s*}\s+from\s+['"]url['"]/.test(next)) {
      next = `import { fileURLToPath } from "url";\n${next}`;
    }
    return next;
  }
  return null;
}

/**
 * Launchpad preview copies static files (like Vite dist/). Next needs `out/` from static export.
 * We temporarily merge `output: 'export'` into next.config (mjs/js/cjs/ts) and restore after build.
 */
async function nextConfigJsLooksEsm(absBuild, pkg) {
  if (pkg.type === "module") return true;
  const p = path.join(absBuild, "next.config.js");
  if (!(await fs.pathExists(p))) return false;
  const head = (await fs.readFile(p, "utf8")).slice(0, 1200);
  return /^\s*import\s/m.test(head) || /^\s*export\s/m.test(head);
}

function buildNextConfigEsmWrapper(relBackupImportPath) {
  return (
    `/** @generated Launchpad preview — merges output: 'export' (restored after build). */\n` +
    `import path from 'path';\n` +
    `import { fileURLToPath } from 'url';\n` +
    `import userConfig from '${relBackupImportPath}';\n` +
    `const __lpRoot = path.dirname(fileURLToPath(import.meta.url));\n` +
    `async function mergeConfig(phase, ...args) {\n` +
    `  let base;\n` +
    `  if (typeof userConfig === 'function') {\n` +
    `    base = await userConfig(phase, ...args);\n` +
    `  } else {\n` +
    `    base = userConfig;\n` +
    `  }\n` +
    `  if (!base || typeof base !== 'object') {\n` +
    `    return {\n` +
    `      output: 'export',\n` +
    `      outputFileTracingRoot: __lpRoot,\n` +
    `      images: { unoptimized: true },\n` +
    `    };\n` +
    `  }\n` +
    `  return {\n` +
    `    ...base,\n` +
    `    output: 'export',\n` +
    `    outputFileTracingRoot: __lpRoot,\n` +
    `    images: {\n` +
    `      ...(base.images || {}),\n` +
    `      unoptimized: true,\n` +
    `    },\n` +
    `  };\n` +
    `}\n` +
    `export default mergeConfig;\n`
  );
}

function buildNextConfigCjsWrapper(relBackupRequirePath) {
  return (
    `/** @generated Launchpad preview — merges output: 'export' (restored after build). */\n` +
    `const path = require('path');\n` +
    `module.exports = async function mergeConfig(phase, ...args) {\n` +
    `  const __lpRoot = path.dirname(__filename);\n` +
    `  const user = require('${relBackupRequirePath}');\n` +
    `  const base = typeof user === 'function' ? await user(phase, ...args) : user;\n` +
    `  if (!base || typeof base !== 'object') {\n` +
    `    return {\n` +
    `      output: 'export',\n` +
    `      outputFileTracingRoot: __lpRoot,\n` +
    `      images: { unoptimized: true },\n` +
    `    };\n` +
    `  }\n` +
    `  return {\n` +
    `    ...base,\n` +
    `    output: 'export',\n` +
    `    outputFileTracingRoot: __lpRoot,\n` +
    `    images: {\n` +
    `      ...(base.images || {}),\n` +
    `      unoptimized: true,\n` +
    `    },\n` +
    `  };\n` +
    `};\n`
  );
}

/**
 * @returns {Promise<null | (() => Promise<void>)>}
 */
async function prepareNextStaticExportForPreview(absBuild, pkg) {
  if (!isNextProject(pkg)) return null;

  const candidates = [
    "next.config.mjs",
    "next.config.js",
    "next.config.ts",
    "next.config.mts",
    "next.config.cjs",
  ];
  let foundPath = null;
  for (const c of candidates) {
    const p = path.join(absBuild, c);
    if (await fs.pathExists(p)) {
      foundPath = p;
      break;
    }
  }

  if (!foundPath) {
    const minimalPath = path.join(absBuild, "next.config.mjs");
    await fs.writeFile(
      minimalPath,
      `/** Temporary Launchpad preview config (removed after build). */\n` +
      `import path from 'path';\n` +
      `import { fileURLToPath } from 'url';\n` +
      `const __lpRoot = path.dirname(fileURLToPath(import.meta.url));\n` +
      `export default { output: 'export', images: { unoptimized: true }, outputFileTracingRoot: __lpRoot };\n`,
      "utf8",
    );
    let restored = false;
    return async () => {
      if (restored) return;
      restored = true;
      await fs.remove(minimalPath).catch(() => { });
    };
  }

  const content = await fs.readFile(foundPath, "utf8");
  if (configFileHasStaticExport(content)) {
    return null;
  }

  const ext = path.extname(foundPath);
  const baseName = path.basename(foundPath);
  const backupName = `next.config.launchpad-original${ext}`;
  const backupPath = path.join(absBuild, backupName);

  if (ext === ".ts" || ext === ".mts" || ext === ".cts") {
    const patched = tryInjectStaticExportIntoNextConfigTsLike(content);
    if (!patched) {
      console.warn(
        `[runBuildSequence] ${baseName} has no output: 'export' and could not be auto-patched. ` +
        `Use a const nextConfig = { ... } or export default { ... } shape, or add output: 'export' manually.`,
      );
      return null;
    }
    await fs.remove(backupPath).catch(() => { });
    await fs.copy(foundPath, backupPath);
    await fs.writeFile(foundPath, patched, "utf8");
    let restored = false;
    return async () => {
      if (restored) return;
      restored = true;
      try {
        await fs.move(backupPath, foundPath, { overwrite: true });
      } catch (e) {
        console.warn(
          `[runBuildSequence] Failed to restore Next config from ${backupName}:`,
          e?.message || e,
        );
      }
    };
  }

  await fs.remove(backupPath).catch(() => { });
  await fs.copy(foundPath, backupPath);

  const relBackup = `./${backupName}`;
  let wrapper;
  if (ext === ".mjs") {
    wrapper = buildNextConfigEsmWrapper(relBackup);
  } else if (ext === ".cjs") {
    wrapper = buildNextConfigCjsWrapper(relBackup);
  } else if (ext === ".js") {
    const esm = await nextConfigJsLooksEsm(absBuild, pkg);
    wrapper = esm ? buildNextConfigEsmWrapper(relBackup) : buildNextConfigCjsWrapper(relBackup);
  } else {
    await fs.remove(backupPath).catch(() => { });
    return null;
  }

  await fs.writeFile(foundPath, wrapper, "utf8");

  let restored = false;
  return async () => {
    if (restored) return;
    restored = true;
    try {
      await fs.move(backupPath, foundPath, { overwrite: true });
    } catch (e) {
      console.warn(
        `[runBuildSequence] Failed to restore Next config from ${backupName}:`,
        e?.message || e,
      );
    }
  };
}

/**
 * Resolve the folder to copy for static preview / deploy.
 * - Vite → dist/
 * - CRA → build/
 * - Next.js static export → out/ (requires `output: "export"` in next.config so `next build` emits static HTML)
 * - Default `next build` only creates .next/ (server/runtime bundle), not a static site — we cannot serve that like dist/.
 */
async function resolveStaticSiteOutputDir(absBuild, pkg) {
  const distDir = path.join(absBuild, "dist");
  const buildDir = path.join(absBuild, "build");
  const outDir = path.join(absBuild, "out");
  const dotNextDir = path.join(absBuild, ".next");

  if (await fs.pathExists(distDir)) return distDir;
  if (await fs.pathExists(buildDir)) return buildDir;
  if (await fs.pathExists(outDir)) return outDir;

  if (isNextProject(pkg) && (await fs.pathExists(dotNextDir))) {
    throw new Error(
      "Next.js build produced `.next/` but no static export folder. " +
      "Default `next build` writes the app under `.next/` (not `dist/`). " +
      "For Launchpad preview we copy static files like a Vite `dist/`. " +
      "Add `output: 'export'` to `next.config.js` or `next.config.mjs` so `next build` also generates `out/`, then rebuild. " +
      "See: https://nextjs.org/docs/app/building-your-application/deploying/static-exports",
    );
  }

  throw new Error(
    "Build output folder not found. Expected one of: dist/ (Vite), build/ (CRA), or out/ (Next.js static export).",
  );
}

export const runBuildSequence = async (buildContextPath, opts = {}) => {
  const absBuild = path.resolve(buildContextPath);
  const pkgPath = path.join(absBuild, "package.json");
  if (!(await fs.pathExists(pkgPath))) {
    throw new Error(`package.json missing at ${buildContextPath}`);
  }

  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
  } catch {
    pkg = {};
  }

  const restoreNextConfig = await prepareNextStaticExportForPreview(absBuild, pkg);

  try {
    // Always include devDependencies so build tools (vite, webpack, etc.) are installed.
    // Backend container sets NODE_ENV=production; npm omits devDeps unless we override.
    const installArgs = opts.fastInstall
      ? [
        "install",
        "--include=dev",
        "--prefer-offline",
        "--no-audit",
        "--no-fund",
        "--loglevel",
        "error",
      ]
      : ["install", "--include=dev"];

    // Force devDependencies: NODE_ENV=production alone can still skip devDeps on some npm versions.
    const installEnv = {
      ...process.env,
      NODE_ENV: "development",
      NPM_CONFIG_PRODUCTION: "false",
    };
    await execa("npm", installArgs, {
      cwd: absBuild,
      stdio: "inherit",
      env: installEnv,
    });

    // Ensure node_modules/.bin is on PATH when script is "vite build" (shell looks up vite).
    // Must match installEnv: container has NODE_ENV=production; npm can omit .bin from script
    // PATH when production, so vite/webpack stay "not found" (exit 127) even after install.
    const binPath = path.join(absBuild, "node_modules", ".bin");
    const pathSep = process.platform === "win32" ? ";" : ":";
    // Production build: matches `next build` / Vite production expectations; avoids Next.js
    // "non-standard NODE_ENV" warning and duplicate React issues when NODE_ENV was "development".
    const buildEnv = {
      ...process.env,
      NODE_ENV: "production",
      NPM_CONFIG_PRODUCTION: "false",
      PATH: `${binPath}${pathSep}${process.env.PATH || ""}`,
    };

    const useNextWebpack = shouldUseNextWebpackBuild(pkg);
    const npmBuildCmd = useNextWebpack
      ? ["run", "build", "--", "--webpack"]
      : ["run", "build"];
    await execa("npm", npmBuildCmd, {
      cwd: absBuild,
      stdio: "inherit",
      env: buildEnv,
    });

    return resolveStaticSiteOutputDir(absBuild, pkg);
  } finally {
    if (restoreNextConfig) {
      try {
        await restoreNextConfig();
      } catch (e) {
        console.warn(
          "[runBuildSequence] Failed to restore Next.js config after preview build:",
          e?.message || e,
        );
      }
    }
  }
};

export const reloadNginx = async () => {
  try {
    await signalNginxReload();
    return true;
  } catch (error) {
    console.error(`[NGINX RELOAD ERROR]: ${error.message}`);
    // On Local Mac, we don't want to crash the whole app if Nginx isn't running
    if (os.platform() !== 'darwin') throw error;
  }
};
export const uploadReleaseVersionService = async (
  releaseId,
  file,
  roadmapItemIds,
  user,
) => {
  const { id: userId } = user;

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: { project: true },
  });

  if (!release) {
    throw new ApiError(404, "Release not found");
  }

  if (release.status === ReleaseStatus.locked) {
    throw new ApiError(
      400,
      "Cannot upload a version to a locked release. Unlock the release first.",
    );
  }

  const project = release.project;

  const projectRoot = path.join(getBackendRoot(), project.projectPath);
  const projectFolder = path.dirname(projectRoot);

  const tempRoot = path.join(
    getBackendRoot(),
    "_tmp_builds",
    `project_${project.id}_${Date.now()}`,
  );
  await fs.ensureDir(tempRoot);

  const lock = await prisma.project.updateMany({
    where: {
      id: project.id,
      isUploading: false,
    },
    data: {
      isUploading: true,
    },
  });

  if (lock.count === 0) {
    throw new ApiError(409, "Upload already in progress for this project");
  }

  try {
    /* -------------------- 1️⃣ Extract whole ZIP -------------------- */

    await extract(file.path, { dir: tempRoot });

    const items = (await fs.readdir(tempRoot)).filter(
      (i) => !["__MACOSX", ".DS_Store"].includes(i),
    );

    let extractRoot = tempRoot;

    if (items.length === 1) {
      const nested = path.join(tempRoot, items[0]);
      if ((await fs.stat(nested)).isDirectory()) {
        extractRoot = nested;
      }
    }

    /* -------------------- 2️⃣ Validate: package.json required -------------------- */

    const sourceRoot = findProjectRoot(extractRoot);
    const hasPackageJson = await fs.pathExists(
      path.join(sourceRoot, "package.json"),
    );

    if (!hasPackageJson) {
      throw new ApiError(400, "Invalid ZIP: package.json required");
    }

    /* -------------------- 3️⃣ Generate build: npm install + npm run build -------------------- */

    const buildOutputPath = await runBuildSequence(sourceRoot);

    /* -------------------- 4️⃣ Revision (R1, R2, … server-only) -------------------- */

    const version = await autoGenerateVersion(releaseId);

    /* -------------------- 5️⃣ Git: tag and push all data except .gitignore content -------------------- */

    const tag = `proj-${project.id}-rel-${releaseId}-${version}`;

    const scm = await resolveScmCredentialsFromProject(project);
    const validatedProjectName = projectRepoSlugFromDisplayName(project.name);
    const parsedScm = parseScmRepoPath(project.gitRepoPath || "");
    const remoteOwner = parsedScm?.owner || scm.username;
    const remoteRepo = parsedScm?.repo || validatedProjectName;

    const gitWorkingDir = sourceRoot;
    const permanentGitDir = path.join(projectFolder, ".git");
    const localGitDir = path.join(gitWorkingDir, ".git");

    /* Move git history into temp working directory */
    if (fs.existsSync(permanentGitDir)) {
      fs.moveSync(permanentGitDir, localGitDir, { overwrite: true });
    }

    const remoteUrl =
      scm.provider === "github"
        ? `https://x-access-token:${scm.token}@github.com/${remoteOwner}/${remoteRepo}.git`
        : `https://x-token-auth:${scm.token}@bitbucket.org/${remoteOwner}/${remoteRepo}.git`;
    /* Initialize repo if first time */
    if (!fs.existsSync(localGitDir)) {
      runCommand("git init", gitWorkingDir);
      runCommand("git branch -m main", gitWorkingDir);
      const gitUserName = scm.username?.trim() || "Zip Worker";
      const gitUserEmail = scm.username?.trim()
        ? `${scm.username.trim()}@${scm.provider === "bitbucket" ? "bitbucket" : "github"}-zip.local`
        : "worker@zip.com";
      runCommand(`git config user.name "${gitUserName}"`, gitWorkingDir);
      runCommand(`git config user.email "${gitUserEmail}"`, gitWorkingDir);

      const repoMeta =
        scm.provider === "github"
          ? await getRepositoryMetadata(remoteOwner, remoteRepo, scm.token)
          : await getBitbucketRepositoryMetadata(remoteOwner, remoteRepo, scm.token);
      const repoExists = repoMeta.ok;
      if (!repoExists) {
        if (scm.provider === "github") {
          if (remoteOwner !== scm.username) {
            throw new ApiError(
              `Destination repository ${remoteOwner}/${remoteRepo} does not exist or is not accessible.`,
            );
          }
          await createGithubRepo(remoteRepo, {
            githubUsername: scm.username,
            githubToken: scm.token,
          });
        } else {
          try {
            await createBitbucketRepository(remoteOwner, remoteRepo, scm.token);
          } catch (e) {
            throw new ApiError(
              502,
              `Bitbucket repo setup failed: ${e.message || "unknown error"}`,
            );
          }
        }
      }

      runCommand(`git remote add origin ${remoteUrl}`, gitWorkingDir);
    } else {
      runCommand(`git remote set-url origin ${remoteUrl}`, gitWorkingDir);
    }

    /* .gitignore: push all data except ignored (node_modules, dist, build, .env, etc.) */
    const defaultGitignore =
      "node_modules\n.DS_Store\n.env\ndist\nbuild\nout\n.env.local\n.env.*.local\n*.log\n.cache";
    const gitignorePath = path.join(gitWorkingDir, ".gitignore");
    const existingIgnore = (await fs.pathExists(gitignorePath))
      ? await fs.readFile(gitignorePath, "utf-8").catch(() => "")
      : "";
    const gitignoreContent = existingIgnore.trim()
      ? existingIgnore
      : defaultGitignore;
    await fs.writeFile(gitignorePath, gitignoreContent);

    /* Commit: git add . respects .gitignore */
    runCommand("git add .", gitWorkingDir);
    try {
      runCommand(`git commit -m "Release ${version}"`, gitWorkingDir);
    } catch {
      /* no changes */
    }

    try {
      runCommand(`git tag -a ${tag} -m "Release ${version}"`, gitWorkingDir);
    } catch {
      /* tag may already exist */
    }

    /* Push: always force — upload is source of truth; no pull/merge step. */
    runCommand("git push origin main --force", gitWorkingDir);
    runCommand(`git push origin ${tag} --force`, gitWorkingDir);

    fs.moveSync(localGitDir, permanentGitDir, { overwrite: true });

    /* -------------------- 🔟 Deploy: store only build/dist into projects/project name -------------------- */

    await fs.emptyDir(projectRoot);
    await fs.copy(buildOutputPath, projectRoot);

    /* -------------------- 11️⃣ Reload Nginx -------------------- */

    await reloadNginx();

    const domain = config.getBuildUrlHost();
    const protocol = config.getBuildUrlProtocol();
    const buildUrl = `${protocol}://${domain}:${project.port}`;

    /* -------------------- 12️⃣ DB Update -------------------- */
    // Only the active release can have the uploaded version as project-active; draft releases get isActive: false on ProjectVersion.
    const makeVersionActive = release.status === ReleaseStatus.active;

    await prisma.$transaction(async (tx) => {
      if (makeVersionActive) {
        await tx.projectVersion.updateMany({
          where: { projectId: project.id },
          data: { isActive: false },
        });
      }
      await tx.projectVersion.create({
        data: {
          projectId: project.id,
          releaseId,
          version,
          buildUrl,
          isActive: makeVersionActive,
          gitTag: tag,
          zipFilePath: tag, // legacy column; same value so DB row stays consistent
          uploadedBy: userId,
        },
      });
    });

    scheduleRegenerateClientReviewSummary(releaseId);

    return {
      message: "Upload successful",
      version,
      url: buildUrl,
    };
  } finally {
    await fs.remove(tempRoot).catch(() => { });
    await fs.remove(file.path).catch(() => { });

    await prisma.project.update({
      where: { id: project.id },
      data: { isUploading: false },
    });
  }
};

/**
 * Get release info for header display (public)
 */
export const getReleaseInfoService = async (releaseId) => {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      versions: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { version: true, createdAt: true },
      },
    },
  });

  if (!release) {
    throw new ApiError(404, "Release not found");
  }

  return {
    id: release.id,
    name: release.name,
    project: release.project,
    version: release.versions[0]?.version || "1.0.0",
    lastUpdated: release.versions[0]?.createdAt || null,
    status: release.status,
    locked: release.status === ReleaseStatus.locked,
    lockedBy: release.lockedBy,
  };
};

const PUBLIC_LOCK_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Public lock a release (one-way). Clears isActive on all versions for this release only.
 * Unlock is not supported. Caller supplies `lockedBy` email.
 */
export const publicLockReleaseService = async (releaseId, lockedBy) => {
  const email =
    typeof lockedBy === "string" ? lockedBy.trim().toLowerCase() : "";
  if (!email) {
    throw new ApiError(400, "lockedBy email is required.");
  }
  if (!PUBLIC_LOCK_EMAIL_RE.test(email)) {
    throw new ApiError(400, "lockedBy must be a valid email address.");
  }

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          stakeholderEmails: true,
        },
      },
    },
  });

  if (!release) {
    throw new ApiError(404, "Release not found");
  }

  const stakeholderSet = parseStoredEmailListToSet(
    release.project?.stakeholderEmails,
  );
  if (stakeholderSet.size === 0) {
    throw new ApiError(
      403,
      "Public release lock is not available until project stakeholders are configured.",
    );
  }
  if (!stakeholderSet.has(email)) {
    throw new ApiError(
      403,
      "This email is not authorized",
    );
  }

  if (release.status === ReleaseStatus.locked) {
    throw new ApiError(400, "Release is already locked");
  }

  const projectFull = await prisma.project.findUnique({
    where: { id: release.project.id },
  });
  if (!projectFull) {
    throw new ApiError(404, "Project not found");
  }

  const { syncDeveloperRepoSubmoduleForReleaseLock } = await import(
    "./developerRepoSubmodule.service.js"
  );
  await syncDeveloperRepoSubmoduleForReleaseLock({
    releaseId,
    project: projectFull,
    releaseName: release.name,
  });

  const updatedRelease = await prisma.$transaction(async (tx) => {
    const row = await tx.release.update({
      where: { id: releaseId },
      data: {
        status: ReleaseStatus.locked,
        lockedBy: email,
      },
      select: {
        id: true,
        name: true,
        status: true,
        projectId: true,
        lockedBy: true,
      },
    });
    await deactivateProjectVersionsForRelease(tx, releaseId);
    return row;
  });

  return {
    message: "Release locked successfully",
    releaseId: updatedRelease.id,
    releaseName: updatedRelease.name,
    locked: updatedRelease.status === ReleaseStatus.locked,
    lockedBy: updatedRelease.lockedBy,
  };
};

