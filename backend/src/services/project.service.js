import { PrismaClient, ReleaseStatus } from "@prisma/client";

const prisma = new PrismaClient();
import ApiError from "../utils/apiError.js";
import { createRoadmapWithItems } from "./roadmap.service.js";
import { fetchProjectJiraTickets } from "../utils/jiraIntegration.js";
import config from "../config/index.js";
import { getBackendRoot, getProjectsDir, getNginxConfigsDir, getNginxBaseDomain, getNginxUpstreamHost, getProjectLiveAbsolutePath } from "../utils/instanceRoot.js";
import axios from "axios";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { execSync, execFileSync } from "child_process";
import fsExtra from "fs-extra";
import os from 'os';
import fs from "fs-extra";
import { startProjectServer } from "../projectServers.js";
import {
  runBuildSequence,
  reloadNginx as reloadNginxRelease,
  createGithubRepo,
  addGithubCollaborator,
  findProjectRoot,
  setReleaseStatusService as applyReleaseStatus,
} from "./release.service.js";
import { parseGitRepoPath } from "./github.service.js";
import { projectRepoSlugFromDisplayName } from "../utils/projectValidation.utils.js";
import { normalizeOptionalEmailListString } from "../utils/emailList.utils.js";

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

const execAsync = promisify(exec);

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
    where: { id: projectId },
    select: { id: true, assignedManagerId: true },
  });

  if (!project) {
    throw new ApiError(404, "Project not found");
  }

  const { role, id: userId } = user;

  const hasAccess =
    role === "admin" ||
    (role === "manager" && project.assignedManagerId === userId);

  if (!hasAccess) {
    throw new ApiError(403, "Forbidden");
  }

  return project;
}

/** Allow admin, project creator, or assigned manager to delete. */
export async function assertProjectDeleteAccess(projectId, user) {
  const project = await prisma.project.findUnique({
    where: { id: Number(projectId) },
    select: { id: true, createdById: true, assignedManagerId: true },
  });
  if (!project) throw new ApiError(404, "Project not found");
  const { role, id: userId } = user;
  const allowed =
    role === "admin" ||
    project.createdById === userId ||
    (role === "manager" && project.assignedManagerId === userId);
  if (!allowed) throw new ApiError(403, "Forbidden");
  return project;
}

const validateGithubConnection = async (username, token) => {
  try {
    // We check the user profile; it's the lightest way to verify a token
    await axios.get(`https://api.github.com/users/${username}`, {
      headers: { Authorization: `token ${token}` },
    });
  } catch (error) {
    throw new ApiError(400, "Invalid GitHub credentials or username.");
  }
};

const validateJiraConnection = async (baseUrl, projectKey, email, apiToken) => {
  try {
    // 1. Jira requires: base64(email:apiToken)
    const authString = Buffer.from(`${email}:${apiToken}`).toString('base64');

    const url = `${baseUrl.replace(/\/$/, "")}/rest/api/2/project/${projectKey}`;

    await axios.get(url, {
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json',
        'X-Atlassian-Token': 'no-check' // Optional: prevents some XSRF issues
      },
    });
  } catch (error) {
    // Log the actual response from Jira to see exactly why it failed (401, 403, or 404)

    throw new ApiError(400, `Jira Validation Failed: ${error.response?.data?.errorMessages?.[0] || "Check credentials"}`);
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
    const { stdout } = await execAsync('which nginx');
    const nginxBin = stdout.trim();
    // Docker/backend-as-root: no sudo. Host Linux: sudo usually required.
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

/**
 * Regenerate nginx config for all projects that have a port.
 * (Reserved for future use; SSL wildcard behaviour has been reverted.)
 */
export const regenerateAllProjectNginxConfigs = async () => {
  // No-op: SSL wildcard reverted; configs are created on project create only.
};

export const createProjectService = async ({ userId, body }) => {
  const {
    name,
    assignedManagerId,
    jiraBaseUrl,
    jiraProjectKey,
    jiraUsername,
    jiraApiToken,
    githubUsername,
    githubToken,
  } = body;

  let assignedUserEmailsDb = null;
  let stakeholderEmailsDb = null;
  try {
    assignedUserEmailsDb = normalizeOptionalEmailListString(body.assignedUserEmails);
    stakeholderEmailsDb = normalizeOptionalEmailListString(body.stakeholderEmails);
  } catch (e) {
    throw new ApiError(400, e.message);
  }
  const isLinux = os.platform() === 'linux';
  const nginxBinary = isLinux ? '/usr/sbin/nginx' : '/opt/homebrew/bin/nginx';

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

    // 2. Validate Manager
    const managerExists = await prisma.user.findFirst({
      where: { id: Number(assignedManagerId), role: "manager" },
      select: { id: true },
    });
    if (!managerExists) throw new ApiError(400, "Assigned manager not found");
    await Promise.all([
      validateJiraConnection(jiraBaseUrl, jiraProjectKey, jiraUsername, jiraApiToken),
      validateGithubConnection(githubUsername, githubToken)
    ]);
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

    // 4a. GitHub repo (create once at project create; upload release skips create if repo exists)
    const githubCreds = {
      githubUsername: githubUsername?.trim(),
      githubToken: githubToken?.trim(),
    };
    let gitRepoUrl = null;
    if (githubCreds.githubUsername && githubCreds.githubToken) {
      try {
        await createGithubRepo(slug, githubCreds);
        gitRepoUrl = `https://github.com/${githubCreds.githubUsername}/${slug}`;
        // Collaborator + invitation email (GitHub notifies invitee)
        const defaultCollaborator =
          process.env.GITHUB_DEFAULT_COLLABORATOR || "kalrav@york.ie";
        const invited = await addGithubCollaborator(
          githubCreds.githubUsername,
          slug,
          defaultCollaborator,
          githubCreds.githubToken,
          "push",
        );
        if (!invited) {
          console.warn(
            "[createProject] Collaborator invite skipped or failed; repo created. Set GITHUB_DEFAULT_COLLABORATOR to a valid GitHub username.",
          );
        }
      } catch (e) {
        console.warn("[createProject] GitHub repo/collaborator:", e.message);
        throw new ApiError(
          502,
          `GitHub setup failed: ${e.message}. Fix credentials or repo name and retry.`,
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
          ...body,
          name: nameTrimmed,
          slug,
          assignedManagerId: Number(assignedManagerId),
          createdById: userId,
          port,
          projectPath: relativeProjectPath,
          projectId: hubProjectId,
          assignedUserEmails: assignedUserEmailsDb,
          stakeholderEmails: stakeholderEmailsDb,
          // Remote clone URL when GitHub repo was created; else local .git path for legacy
          gitRepoPath:
            gitRepoUrl || path.join(relativeProjectPath, ".git"),
          nginxConfigPath: path.join('nginx-configs', configFileName),
        },
      });
    });

    // 9. Start static server on this project's port (so http://localhost:8004/ works)
    startProjectServer(port, absoluteProjectPath);

    return project;
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
     * 3. DATABASE: remove ProjectAccess first (no cascade), then project (cascades releases, roadmaps, versions)
     * -------------------------------------- */
    await prisma.projectAccess.deleteMany({ where: { projectId: id } });
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

  let whereClause;

  if (role === "admin") {
    whereClause = {};
  } else if (role === "manager") {
    whereClause = { assignedManagerId: userId };
  } else {
    throw new ApiError(403, "Forbidden");
  }

  return prisma.project.findMany({
    where: whereClause,
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

      /**
       * Roadmaps with items
       */
      roadmaps: {
        orderBy: { timelineStart: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          tshirtSize: true,
          timelineStart: true,
          timelineEnd: true,

          items: {
            orderBy: { startDate: "asc" },
            select: {
              id: true,
              title: true,
              description: true,
              type: true,
              status: true,
              priority: true,
              startDate: true,
              endDate: true,
            },
          },
        },
      },
    },
  });
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
    },
  };

  const releasesQuery = {
    orderBy: { id: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      lockedBy: true,
      clientReleaseNote: true,
      versions: {
        orderBy: { id: "desc" },
        select: {
          id: true,
          version: true,
          buildUrl: true,
          isActive: true,
          createdAt: true,
          releaseId: true,
        },
      },
    },
  };

  // Slug / public: only id + name on Project; full row when fetching by project id.
  if (isSlugMode) {
    return prisma.project.findUnique({
      where,
      select: {
        id: true,
        name: true,
        versions: versionsQuery,
        releases: releasesQuery,
      },
    });
  }

  return prisma.project.findUnique({
    where,
    include: {
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      assignedManager: {
        select: { id: true, name: true, email: true },
      },
      versions: versionsQuery,
      releases: releasesQuery,
    },
  });
};

/**
 * Checkout tag, build, copy build output into projects/{projectPath}, reload nginx, update version buildUrl.
 * Does not change isActive (caller handles DB flags). Used by activate-version API and after release status → active.
 */
export async function deployVersionArtifactsToProjectFolder({
  projectId,
  versionId,
  user,
}) {
  await assertProjectAccess(projectId, user);

  const version = await prisma.projectVersion.findFirst({
    where: { id: versionId, projectId },
    select: {
      id: true,
      buildUrl: true,
      version: true,
      gitTag: true,
      zipFilePath: true,
    },
  });

  if (!version) {
    throw new ApiError(404, "Version not found");
  }

  const tag =
    (version.gitTag && version.gitTag.trim()) ||
    (version.zipFilePath && version.zipFilePath.trim());
  if (!tag) {
    throw new ApiError(
      400,
      "Version has no gitTag (or legacy zipFilePath); cannot checkout. Re-upload or merge from Cursor first.",
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
    },
  });
  if (!project?.projectPath?.trim()) {
    throw new ApiError(400, "Project has no projectPath");
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
      const fetchTagIntoLocalRepo = (gDir, t, proj) => {
        if (proj.gitRepoPath?.trim() && proj.githubToken?.trim()) {
          const parsed = parseGitRepoPath(proj.gitRepoPath.trim());
          if (parsed) {
            const { owner, repo } = parsed;
            const token = proj.githubToken.trim();
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
      if (!fetchTagIntoLocalRepo(gitDir, tag, project)) {
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
    } else if (project.githubToken?.trim() && project.gitRepoPath?.trim()) {
      const parsed = parseGitRepoPath(project.gitRepoPath);
      if (!parsed) {
        throw new ApiError(400, "Invalid gitRepoPath; cannot clone for deploy");
      }
      const { owner, repo } = parsed;
      const token = project.githubToken.trim();
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
      zipFilePath: true,
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
  await assertProjectAccess(projectId, user);

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
  await assertProjectAccess(projectId, user);

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
  "githubUsername",
  "githubToken",
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

  const jEmail =
    data.jiraUsername !== undefined ? data.jiraUsername : existingProject.jiraUsername;
  const jBase = data.jiraBaseUrl !== undefined ? data.jiraBaseUrl : existingProject.jiraBaseUrl;
  const jKey = data.jiraProjectKey !== undefined ? data.jiraProjectKey : existingProject.jiraProjectKey;
  const jToken = data.jiraApiToken !== undefined ? data.jiraApiToken : existingProject.jiraApiToken;

  if (jEmail && jBase && jKey && jToken) {
    await validateJiraConnection(jBase, jKey, jEmail, jToken);
  }

  const ghUser =
    data.githubUsername !== undefined ? data.githubUsername : existingProject.githubUsername;
  const ghTok = data.githubToken !== undefined ? data.githubToken : existingProject.githubToken;
  if (ghUser && ghTok) {
    await validateGithubConnection(ghUser, ghTok);
  }

  return prisma.project.update({
    where: { id: Number(projectId) },
    data,
  });
};
export const getJiraTicketsService = async (projectId, user) => {
  // 1️⃣ Access check
  const project = await assertProjectAccess(projectId, user);

  // 2️⃣ Get full project details including Jira config
  const projectDetails = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      jiraBaseUrl: true,
      jiraProjectKey: true,
      jiraApiToken: true,
      jiraUsername: true, // This is expected to be the email/username
    },
  });

  if (
    !projectDetails.jiraBaseUrl ||
    !projectDetails.jiraProjectKey ||
    !projectDetails.jiraApiToken ||
    !projectDetails.jiraUsername
  ) {
    throw new ApiError(400, "Jira configuration missing for this project");
  }

  // 3️⃣ Fetch tickets
  const result = await fetchProjectJiraTickets({
    baseUrl: projectDetails.jiraBaseUrl,
    projectKey: projectDetails.jiraProjectKey,
    apiToken: projectDetails.jiraApiToken,
    email: projectDetails.jiraUsername,
  });

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
  const project = await prisma.project.findUnique({
    where: { id: Number(projectId) },
    select: { id: true, name: true, projectPath: true, port: true, gitRepoPath: true, githubToken: true },
  });
  if (!project) {
    throw new ApiError(404, "Project not found");
  }
  if (!project.port) {
    throw new ApiError(400, "Project has no port; cannot serve preview.");
  }

  let tag;
  let versionLabel;
  const idNum = Number(versionIdOrTag);
  const byId = Number.isInteger(idNum) && String(idNum) === String(versionIdOrTag);
  if (byId) {
    const versionRow = await prisma.projectVersion.findFirst({
      where: { id: idNum, projectId: Number(projectId) },
      select: { gitTag: true, zipFilePath: true, version: true },
    });
    if (!versionRow) {
      throw new ApiError(404, "Version not found");
    }
    tag =
      (versionRow.gitTag && versionRow.gitTag.trim()) ||
      (versionRow.zipFilePath && versionRow.zipFilePath.trim());
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
  if (!fs.existsSync(gitDir)) {
    throw new ApiError(
      503,
      "Preview unavailable: git repo not found. Deploy at least one release first."
    );
  }

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

    runCommand(`git --git-dir="${gitDir}" worktree prune`, backendRoot);
    deleteLocalGitTag(gitDir, tag);
    // Fetch tag: prefer project's repo (e.g. projects/Launchpad → binalc-web/launchpad) when set
    const fetchFromProjectRepo = () => {
      if (!project.gitRepoPath?.trim() || !project.githubToken?.trim()) return false;
      const parsed = parseGitRepoPath(project.gitRepoPath.trim());
      if (!parsed) return false;
      const { owner, repo } = parsed;
      const token = project.githubToken.trim();
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
      runCommand(
        `git --git-dir="${gitDir}" worktree remove "${previewRepo}" --force`,
        backendRoot
      );
    } catch (e) {
      await fs.remove(previewRepo).catch(() => { });
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
      runCommand(
        `git --git-dir="${gitDir}" worktree remove "${previewRepo}" --force`,
        backendRoot
      );
    } catch (_) { }
    await fs.remove(previewDir).catch(() => { });
    console.error("[switchProjectVersion] Preview failed:", err.message);
    throw new ApiError(
      500,
      err.message || "Failed to build preview (checkout + build). Live app unchanged."
    );
  }
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

  const project = await prisma.project.findUnique({
    where: { id: Number(projectId) },
    select: { id: true, port: true, gitRepoPath: true, githubToken: true },
  });
  if (!project) throw new ApiError(404, "Project not found");
  if (!project.port) throw new ApiError(400, "Project has no port; cannot serve preview.");
  if (!project.githubToken?.trim() || !project.gitRepoPath?.trim()) {
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

    const token = project.githubToken.trim();
    const cloneUrl = `https://x-access-token:${token}@github.com/${parsed.owner}/${parsed.repo}.git`;
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
}


