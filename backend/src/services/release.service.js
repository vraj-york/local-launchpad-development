import { PrismaClient, ReleaseStatus } from "@prisma/client";
import path from "path";
import fs from "fs-extra";
import extract from "extract-zip";
import { execSync, spawn, exec } from "child_process";
import crypto from "crypto";
import fetch from "node-fetch";
import ApiError from "../utils/apiError.js";
import config from "../config/index.js";
import { getBackendRoot } from "../utils/instanceRoot.js";
import { generateReleaseHeader } from "../utils/headerUtils.js";
import { promisify } from "util";
import os from "os";
import { execa } from "execa";

const execAsync = promisify(exec);
const prisma = new PrismaClient();

// Environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;

// Project locks to prevent concurrent uploads
const projectLocks = new Map();

// Rate limiting for GitHub API
const githubApiCalls = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_CALLS_PER_WINDOW = 10;

// --- Helper Functions (Private) ---

function validateProjectName(name) {
  if (!name || typeof name !== "string") {
    throw new ApiError("Invalid project name: must be a non-empty string");
  }
  if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
    throw new ApiError(
      "Project name contains invalid characters. Only alphanumeric, hyphens, and underscores allowed.",
    );
  }
  if (name.length > 100) {
    throw new ApiError(
      "Project name too long. Maximum 100 characters allowed.",
    );
  }
  if (name.length < 1) {
    throw new ApiError("Project name too short. Minimum 1 character required.");
  }
  return name;
}

function sanitizeCommand(command) {
  const dangerousChars = /[;&|`$(){}[\]\\]/g;
  if (dangerousChars.test(command)) {
    throw new ApiError("Command contains potentially dangerous characters");
  }
  return command;
}

export function findProjectRoot(dir) {
  const ignoreList = [
    ".git",
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

/**
 * Resolve GitHub credentials for a project: use project's githubUsername/githubToken when both set, else env.
 * @param {Object} project - Project with optional githubUsername, githubToken
 * @returns {{ githubUsername: string, githubToken: string }}
 */
function getProjectGitHubCredentials(project) {
  const username = project?.githubUsername?.trim() || GITHUB_USERNAME;
  const token = project?.githubToken?.trim() || GITHUB_TOKEN;
  if (!username || !token) {
    throw new ApiError(
      "GitHub credentials not configured. Set project GitHub (githubUsername, githubToken) or env GITHUB_USERNAME and GITHUB_TOKEN.",
    );
  }
  return { githubUsername: username, githubToken: token };
}

export async function createGithubRepo(repoName, credentials = {}) {
  checkRateLimit();

  const username = credentials.githubUsername || GITHUB_USERNAME;
  const token = credentials.githubToken || GITHUB_TOKEN;

  if (!token || !username) {
    throw new ApiError(
      "GitHub credentials not configured. Please set GITHUB_TOKEN and GITHUB_USERNAME environment variables or project GitHub details.",
    );
  }

  const response = await fetch(`https://api.github.com/user/repos`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
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
      "GitHub authentication failed. Please check your GITHUB_TOKEN.",
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
      Authorization: `token ${token}`,
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

  const username = credentials.githubUsername || GITHUB_USERNAME;
  const token = credentials.githubToken || GITHUB_TOKEN;

  const response = await fetch(
    `https://api.github.com/repos/${username}/${repoName}`,
    {
      headers: {
        Authorization: `token ${token}`,
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
 * List releases for a project
 */
export const listReleasesService = async (projectId, user) => {
  const { id: userId, role } = user;

  // Check project access
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ApiError(404, "Project not found");

  let hasAccess = false;
  if (role === "admin") hasAccess = true;
  else if (role === "manager" && project.assignedManagerId === userId)
    hasAccess = true;

  if (!hasAccess) throw new ApiError(403, "Forbidden");

  return prisma.release.findMany({
    where: { projectId },
    include: {
      creator: {
        select: { id: true, name: true, email: true },
      },
      versions: {
        orderBy: { createdAt: "desc" },
        include: {
          roadmapItems: true,
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
export const getReleaseByIdService = async (releaseId) => {
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
        select: { version: true, createdAt: true, roadmapItems: true },
      },
    },
  });

  if (!release) {
    throw new ApiError(404, "Release not found");
  }
  return release;
};

/**
 * Create a new release
 */
export const createReleaseService = async (data, user) => {
  const { projectId, name, description, roadmapItemId } = data;
  const { id: userId, role } = user;

  // Check access
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ApiError(404, "Project not found");

  let hasAccess = false;
  if (role === "admin") hasAccess = true;
  else if (role === "manager" && project.assignedManagerId === userId)
    hasAccess = true;

  if (!hasAccess) throw new ApiError(403, "Forbidden");

  // Allow creating new releases in draft mode even when previous release is not locked

  const releaseNameTrimmed = name && typeof name === "string" ? name.trim() : "";
  if (!releaseNameTrimmed) {
    throw new ApiError(400, "Release name is required");
  }

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

  return prisma.$transaction(async (tx) => {
    const release = await tx.release.create({
      data: {
        projectId,
        name: releaseNameTrimmed,
        description: description?.trim() || null,
        status: ReleaseStatus.draft,
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
 * Set release status: draft | active | locked.
 * At a time only one release per project is "active". When setting to active:
 * other active releases are marked draft; locked releases are unchanged.
 */
const RELEASE_STATUS_VALUES = Object.values(ReleaseStatus);

export const setReleaseStatusService = async (releaseId, status, user) => {
  const { id: userId, role } = user;
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
      isLocked: true,
      project: { select: { assignedManagerId: true } },
    },
  });
  if (!release) throw new ApiError(404, "Release not found");

  const hasPermission =
    role === "admin" ||
    (role === "manager" && release.project.assignedManagerId === userId);
  if (!hasPermission) throw new ApiError(403, "Forbidden");

  await prisma.$transaction(async (tx) => {
    if (releaseStatus === ReleaseStatus.locked) {
      await tx.release.update({
        where: { id: releaseId },
        data: { status: ReleaseStatus.locked, isLocked: true },
      });
      return;
    }

    if (releaseStatus === ReleaseStatus.active) {
      // Only other active releases become draft; locked releases stay locked
      await tx.release.updateMany({
        where: {
          projectId: release.projectId,
          id: { not: releaseId },
          status: ReleaseStatus.active,
        },
        data: { status: ReleaseStatus.draft, isActive: false },
      });
      await tx.release.update({
        where: { id: releaseId },
        data: { status: ReleaseStatus.active, isActive: true },
      });
      const latestInRelease = await tx.projectVersion.findFirst({
        where: { releaseId, projectId: release.projectId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latestInRelease) {
        await tx.projectVersion.updateMany({
          where: { projectId: release.projectId },
          data: { isActive: false },
        });
        await tx.projectVersion.update({
          where: { id: latestInRelease.id },
          data: { isActive: true },
        });
      }
      return;
    }

    // draft
    await tx.release.update({
      where: { id: releaseId },
      data: { status: ReleaseStatus.draft, isActive: false },
    });
  });

  return prisma.release.findUnique({
    where: { id: releaseId },
    include: {
      versions: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
};

/**
 * Lock or unlock a release (kept for backward compat). Syncs status: locked → status locked, unlocked → status draft.
 */
export const lockReleaseService = async (releaseId, locked, user) => {
  const { id: userId, role } = user;

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: {
      id: true,
      isLocked: true,
      projectId: true,
      status: true,
      project: { select: { assignedManagerId: true } },
    },
  });

  if (!release) {
    throw new ApiError(404, "Release not found");
  }

  const hasPermission =
    role === "admin" ||
    (role === "manager" && release.project.assignedManagerId === userId);
  if (!hasPermission) {
    throw new ApiError(403, "Forbidden");
  }

  if (release.isLocked && locked === true) {
    throw new ApiError(400, "Release is already locked");
  }
  if (!release.isLocked && locked === false) {
    throw new ApiError(400, "Release is already unlocked");
  }

  const newStatus = locked ? ReleaseStatus.locked : ReleaseStatus.draft;
  const updated = await prisma.release.update({
    where: { id: releaseId },
    data: {
      isLocked: locked,
      status: newStatus,
      ...(locked ? {} : { isActive: false }),
    },
  });
  return updated;
};

/**
 * Parse semver string to [major, minor, patch] for comparison.
 * @returns {[number, number, number]|null}
 */
function parseSemver(v) {
  if (!v || typeof v !== "string") return null;
  const parts = v.trim().split(".").map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  return [parts[0], parts[1] ?? 0, parts[2] ?? 0];
}


/**
 * Generates the next semantic version for the same release.
 * Uses the highest existing version for this release and bumps patch (+1).
 * First upload to a release gets 1.0.0; each further upload to that release gets +1 (1.0.1, 1.0.2, ...).
 */
export const autoGenerateVersion = async (releaseId) => {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: { id: true },
  });
  if (!release) return "1.0.0";

  const versions = await prisma.projectVersion.findMany({
    where: { releaseId },
    select: { version: true },
  });
  const base = maxSemver(versions.map((r) => r.version).filter(Boolean));
  if (!base) return "1.0.0";
  return semverPatchBump(base);
};

/**
 * Runs npm install and npm run build within the provided temp directory.
 * Streams output to the main console for real-time debugging.
 */
/**
 * @param {string} buildContextPath
 * @param {{ fastInstall?: boolean }} opts - fastInstall uses offline-preferring install (preview/switch only)
 */
export const runBuildSequence = async (buildContextPath, opts = {}) => {
  const pkgPath = path.join(buildContextPath, "package.json");
  if (!(await fs.pathExists(pkgPath))) {
    throw new Error(`package.json missing at ${buildContextPath}`);
  }

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
    cwd: buildContextPath,
    stdio: "inherit",
    env: installEnv,
  });

  // Ensure node_modules/.bin is on PATH when script is "vite build" (shell looks up vite).
  // Must match installEnv: container has NODE_ENV=production; npm can omit .bin from script
  // PATH when production, so vite/webpack stay "not found" (exit 127) even after install.
  const binPath = path.join(buildContextPath, "node_modules", ".bin");
  const pathSep = process.platform === "win32" ? ";" : ":";
  const buildEnv = {
    ...process.env,
    NODE_ENV: "development",
    NPM_CONFIG_PRODUCTION: "false",
    PATH: `${binPath}${pathSep}${process.env.PATH || ""}`,
  };
  await execa("npm", ["run", "build"], {
    cwd: buildContextPath,
    stdio: "inherit",
    env: buildEnv,
  });

  // return actual build output folder
  if (await fs.pathExists(path.join(buildContextPath, "dist"))) {
    return path.join(buildContextPath, "dist");
  }

  if (await fs.pathExists(path.join(buildContextPath, "build"))) {
    return path.join(buildContextPath, "build");
  }

  throw new Error("Build output folder not found (dist/build)");
};

export const reloadNginx = async () => {
  try {
    const { stdout } = await execAsync('which nginx');
    const nginxBin = stdout.trim();
    try {
      await execAsync(`${nginxBin} -s reload`);
    } catch {
      await execAsync(`sudo ${nginxBin} -s reload`);
    }
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
  versionInput,
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

  // Upload allowed for draft and active; not for locked
  const releaseStatus = release.status ?? (release.isLocked ? ReleaseStatus.locked : ReleaseStatus.draft);
  if (releaseStatus === ReleaseStatus.locked) {
    throw new ApiError(400, "Locked release cannot upload. Change status to draft or active first.");
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

    /* -------------------- 4️⃣ Version -------------------- */

    const version = versionInput || (await autoGenerateVersion(releaseId));

    /* -------------------- 5️⃣ Git: tag and push all data except .gitignore content -------------------- */

    const tag = `proj-${project.id}-rel-${releaseId}-v${version}`;

    const githubCreds = getProjectGitHubCredentials(project);
    const validatedProjectName = validateProjectName(project.name);

    const gitWorkingDir = sourceRoot;
    const permanentGitDir = path.join(projectFolder, ".git");
    const localGitDir = path.join(gitWorkingDir, ".git");

    /* Move git history into temp working directory */
    if (fs.existsSync(permanentGitDir)) {
      fs.moveSync(permanentGitDir, localGitDir, { overwrite: true });
    }

    const remoteUrl = `https://${githubCreds.githubUsername}:${githubCreds.githubToken}@github.com/${githubCreds.githubUsername}/${validatedProjectName}.git`;
    /* Initialize repo if first time */
    if (!fs.existsSync(localGitDir)) {
      runCommand("git init", gitWorkingDir);
      runCommand("git branch -m main", gitWorkingDir);
      const gitUserName = project.githubUsername?.trim() || "Zip Worker";
      const gitUserEmail = project.githubUsername?.trim()
        ? `${project.githubUsername.trim()}@github-zip.com`
        : "worker@zip.com";
      runCommand(`git config user.name "${gitUserName}"`, gitWorkingDir);
      runCommand(`git config user.email "${gitUserEmail}"`, gitWorkingDir);

      const repoExists = await checkRepoExists(
        validatedProjectName,
        githubCreds,
      );
      if (!repoExists) {
        await createGithubRepo(validatedProjectName, githubCreds);
      }

      runCommand(`git remote add origin ${remoteUrl}`, gitWorkingDir);
    } else {
      /* Ensure remote URL uses this project's GitHub credentials for push */
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
      console.log("No changes detected.");
    }

    try {
      runCommand(`git tag -a ${tag} -m "Release ${version}"`, gitWorkingDir);
    } catch {
      console.log("Tag already exists");
    }

    try {
      runCommand("git push origin main", gitWorkingDir);
      runCommand(`git push origin ${tag}`, gitWorkingDir);
    } catch {
      runCommand("git push origin main --force", gitWorkingDir);
      runCommand(`git push origin ${tag} --force`, gitWorkingDir);
    }

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
    // Only the active release can have the uploaded version as project-active; draft releases get isActive: false.
    const makeVersionActive = releaseStatus === ReleaseStatus.active;

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
 * Get release info for header display (generates lock token)
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

  // Generate a unique lock token for this release
  const lockToken = crypto.randomBytes(32).toString("hex");

  return {
    id: release.id,
    name: release.name,
    project: release.project,
    version: release.versions[0]?.version || "1.0.0",
    lastUpdated: release.versions[0]?.createdAt || null,
    status: release.status ?? (release.isLocked ? ReleaseStatus.locked : ReleaseStatus.draft),
    locked: release.isLocked || false,
    lockToken: lockToken,
  };
};

/**
 * Public lock/unlock a release
 */
export const publicLockReleaseService = async (releaseId, locked, token) => {
  // Validate required parameters
  if (typeof locked !== "boolean") {
    throw new ApiError(
      400,
      "Invalid 'locked' parameter. Must be true or false.",
    );
  }

  if (!token || typeof token !== "string") {
    throw new ApiError(400, "Token is required for public lock operations.");
  }

  // Check if release exists
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!release) {
    throw new ApiError(404, "Release not found");
  }

  if (release.isLocked && locked === true) {
    throw new ApiError(400, "Release is already locked");
  }
  if (!release.isLocked && locked === false) {
    throw new ApiError(400, "Release is already unlocked");
  }

  const updatedRelease = await prisma.release.update({
    where: { id: releaseId },
    data: {
      isLocked: locked,
      status: locked ? ReleaseStatus.locked : ReleaseStatus.draft,
      ...(locked ? {} : { isActive: false }),
    },
    select: {
      id: true,
      name: true,
      isLocked: true,
      status: true,
    },
  });

  return {
    message: `Release ${locked ? "locked" : "unlocked"} successfully`,
    releaseId: updatedRelease.id,
    releaseName: updatedRelease.name,
    locked: updatedRelease.isLocked,
  };
};

// services/releasePreview.service.ts

export const getReleasePreviewUrl = async (versionId, user) => {
  const version = await prisma.projectVersion.findUnique({
    where: { id: versionId },
    include: {
      project: {
        select: {
          assignedManagerId: true,
        },
      },
    },
  });

  if (!version) {
    throw new ApiError(404, "Version not found");
  }

  const hasAccess =
    user.role === "admin" || user.id === version.project.assignedManagerId;

  if (!hasAccess) {
    throw new ApiError(403, "Forbidden");
  }

  if (!version.buildUrl) {
    throw new ApiError(400, "Build not available");
  }

  return version.buildUrl;
};