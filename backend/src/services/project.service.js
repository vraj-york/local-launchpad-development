import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
import ApiError from "../utils/apiError.js";
import { createRoadmapWithItems } from "./roadmap.service.js";
import { fetchProjectJiraTickets } from "../utils/jiraIntegration.js";
import { getBackendRoot, getProjectsDir, getNginxConfigsDir, getNginxBaseDomain, getNginxUpstreamHost } from "../utils/instanceRoot.js";
import axios from "axios";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { execSync } from "child_process";
import fsExtra from "fs-extra";
import os from 'os';
import { execa } from "execa";
import fs from "fs-extra";
import { startProjectServer } from "../projectServers.js";
import {
  runBuildSequence,
  createGithubRepo,
  addGithubCollaborator,
  checkRepoExists,
} from "./release.service.js";
import { configDotenv } from "dotenv";

const execAsync = promisify(exec);

function runCommand(command, cwd, options = {}) {
  return execSync(command, {
    cwd,
    encoding: "utf-8",
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
}

/** Find directory containing package.json (for worktree build) */
function findProjectRoot(dir) {
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) return dir;
  try {
    const items = fs.readdirSync(dir);
    for (const name of items) {
      if (["node_modules", "build", "dist", ".git"].includes(name)) continue;
      const sub = path.join(dir, name);
      if (!fs.statSync(sub).isDirectory()) continue;
      const found = findProjectRoot(sub);
      if (found) return found;
    }
  } catch (_) { }
  return dir;
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

async function restartNginx() {
  try {
    // Force the absolute path to the executable
    const nginxBin = '/opt/homebrew/bin/nginx';
    const restartCmd = `sudo ${nginxBin} -s reload`;

    const { stdout, stderr } = await execAsync(restartCmd);

    if (stderr) console.warn('[WARN] Nginx stderr:', stderr);
    return true;
  } catch (error) {
    // If it still fails, it's likely the password prompt blocking the sync execution
    console.error('[ERROR] Nginx restart failed. Is NOPASSWD configured?');
    return false;
  }
}
/**
 * Automatically opens a specific port on the Linux firewall (UFW).
 * @param {number} port - The project's assigned port (e.g., 8001)
 */
export const allowPortThroughFirewall = async (port) => {
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
export const createProjectService = async ({ userId, body }) => {
  const { name, assignedManagerId, jiraBaseUrl, jiraProjectKey, jiraUsername, jiraApiToken, githubUsername, githubToken } = body;
  const isLinux = os.platform() === 'linux';
  const nginxBinary = isLinux ? '/usr/sbin/nginx' : '/opt/homebrew/bin/nginx';

  try {
    // 1. Validate Manager
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
    const projectName = name.toLowerCase().replace(/\s+/g, '-');
    const configFileName = `${projectName}.conf`;
    const relativeProjectPath = path.join("projects", projectName);
    const absoluteProjectPath = path.join(getProjectsDir(), projectName);

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

    // --- FIX: Only run UFW on Linux ---
    if (isLinux) {
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
        await createGithubRepo(projectName, githubCreds);
        gitRepoUrl = `https://github.com/${githubCreds.githubUsername}/${projectName}`;
        // Collaborator + invitation email (GitHub notifies invitee)
        const defaultCollaborator =
          process.env.GITHUB_DEFAULT_COLLABORATOR || "kalrav@york.ie";
        const invited = await addGithubCollaborator(
          githubCreds.githubUsername,
          projectName,
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
    const configContent = generateNginxConfigTemplate(projectName, port);
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

    // 8. DB Persistence
    const project = await prisma.$transaction(async (tx) => {
      return await tx.project.create({
        data: {
          ...body,
          assignedManagerId: Number(assignedManagerId),
          createdById: userId,
          port,
          projectPath: relativeProjectPath,
          // Remote clone URL when GitHub repo was created; else local .git path for legacy
          gitRepoPath:
            gitRepoUrl || path.join(relativeProjectPath, ".git"),
          nginxConfigPath: path.join('nginx-configs', configFileName)
        },
      });
    });

    // 9. Start static server on this project's port (so http://localhost:8004/ works)
    startProjectServer(port, absoluteProjectPath);

    return project;
  } catch (error) {
    // 9. Cleanup
    throw new ApiError(500, `Project creation failed: ${error.message}`);
  }
};
export const createProjectService_old = async ({ userId, body }) => {
  const {
    name,
    assignedManagerId,
    // ... other fields
  } = body;

  /**
     * 1. Validate assigned manager exists
     */
  const managerExists = await prisma.user.findFirst({
    where: {
      id: Number(assignedManagerId),
      role: "manager",
    },
    select: { id: true },
  });

  if (!managerExists) {
    throw new ApiError(400, "Assigned manager not found");
  }

  /**
   * 2. Validate External Connections
   * Perform these before opening the DB transaction to keep it lean.
   */
  await Promise.all([
    // validateJiraConnection(jiraBaseUrl, jiraProjectKey, jiraUsername, jiraApiToken)
  ]);
  const projectName = name.toLowerCase().replace(/\s+/g, '-');

  // --- PATH CONFIGURATION (always under backend, never frontend) ---
  // 1. Define the relative paths for the Database
  const relativeProjectPath = path.join("projects", projectName);
  const relativeGitRepoPath = path.join(relativeProjectPath, ".git");

  // 2. Define the absolute paths for the OS (fsExtra / execSync)
  const absoluteProjectPath = path.join(getProjectsDir(), projectName);
  const absoluteNginxDir = getNginxConfigsDir();
  const nginxConfigFileName = `${projectName}.conf`;
  const absoluteNginxConfigPath = path.join(absoluteNginxDir, nginxConfigFileName);

  // 3. Port Allocation
  const maxPortProject = await prisma.project.aggregate({ _max: { port: true } });
  const port = (maxPortProject._max.port || 8000) + 1;

  try {
    // 5. Directory Creation (Use ABSOLUTE paths)
    await fsExtra.ensureDir(absoluteProjectPath);
    await fsExtra.ensureDir(absoluteNginxDir);

    // 6. Git Initialization (Use ABSOLUTE path)
    execSync("git init", { cwd: absoluteProjectPath });

    // 7. Nginx Configuration
    const nginxTemplate = `server {
    listen 80;
    server_name ${projectName}.example.com;
    
    location / {
        proxy_pass http://localhost:${port};
        // ... rest of template
    }
}`;
    await fsExtra.writeFile(absoluteNginxConfigPath, nginxTemplate);

    // 8. Database Persistence (Use RELATIVE paths)
    return await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          ...body,
          assignedManagerId: Number(assignedManagerId),
          createdById: userId,
          port,
          // Store relative strings in DB
          projectPath: relativeProjectPath,
          gitRepoPath: relativeGitRepoPath,
          nginxConfigPath: path.join('nginx-configs', nginxConfigFileName)
        },
      });

      return project;
    });
  } catch (error) {
    // Cleanup on failure (Use ABSOLUTE paths)
    if (await fsExtra.pathExists(absoluteProjectPath)) await fsExtra.remove(absoluteProjectPath);
    if (await fsExtra.pathExists(absoluteNginxConfigPath)) await fsExtra.remove(absoluteNginxConfigPath);
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
 * GET project by ID (with roadmap + items)
 */
export const getProjectByIdService = async (projectId, user = null) => {
  // 1. Define the base query that applies to everyone
  const whereClause = {
    id: projectId,
  };

  /**
  * 2️ Role-based access
  */
  if (user?.id) {
    if (user.role === "manager") {
      // Manager → only own created projects
      whereClause.assignedManagerId = user.id;
    }
  }

  /* 3️ Include releases ONLY if user exists
  */
  const include = {
    createdBy: {
      select: { id: true, name: true, email: true },
    },
    assignedManager: {
      select: { id: true, name: true, email: true },
    },
    versions: {
      where: { isActive: true },
      select: { id: true, version: true, buildUrl: true, createdAt: true }
    },
    //  Roadmaps
    roadmaps: {
      orderBy: { id: "asc" },
      include: {
        items: {
          orderBy: { id: "asc" },
          include: {
            projectVersions: {
              include: {
                release: true,
              },
            },
          }
        },
      },
    },
  };

  if (user?.id) {
    include.releases = {
      orderBy: { id: "desc" },
      include: {
        versions: { orderBy: { id: "desc" } },
      },
    };
  }
  const project = await prisma.project.findFirst({
    where: whereClause,
    include
  });
  return project;
};

/**
 * Activate a project version: updates DB (isActive) only.
 * projects/ folder is only updated at upload time.
 */
export async function activateProjectVersionService({
  projectId,
  versionId,
  user,
}) {
  await assertProjectAccess(projectId, user);

  let versionRow;
  await prisma.$transaction(async (tx) => {
    const version = await tx.projectVersion.findFirst({
      where: { id: versionId, projectId },
      select: { id: true, isActive: true, buildUrl: true, version: true },
    });

    if (!version) {
      throw new ApiError(404, "Version not found");
    }

    if (version.isActive) {
      throw new ApiError(400, "Version is already active");
    }

    await tx.projectVersion.updateMany({
      where: { projectId },
      data: { isActive: false },
    });

    await tx.projectVersion.update({
      where: { id: versionId },
      data: { isActive: true },
    });

    versionRow = { buildUrl: version.buildUrl, version: version.version };
  });

  return {
    message: "Version activated successfully",
    version: versionRow.version,
    buildUrl: versionRow.buildUrl,
  };
}

/**
 * Set release active status
 */
export async function setReleaseStatusService({ projectId, releaseId, user }) {
  // 1️⃣ Access check
  await assertProjectAccess(projectId, user);

  await prisma.$transaction(async (tx) => {
    // 2️⃣ Update active status
    const release = await prisma.release.findFirst({
      where: { id: releaseId, projectId },
    });

    if (!release) {
      throw new ApiError(404, "Release not found");
    }

    if (release.isActive) {
      throw new ApiError(400, "Release is already active");
    }

    await tx.release.updateMany({
      where: { projectId },
      data: { isActive: false },
    });

    await tx.release.update({
      where: { id: releaseId },
      data: { isActive: true },
    });
  });
}
/*GET LIVE URL - always reflects projects/ folder (set at last upload only; switch version is UI preview only) */
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
/*   PROJECT INFO (HEADER)*/
export async function getProjectInfoService(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
    },
  });

  if (!project) {
    throw new ApiError(404, "Project not found");
  }

  const activeVersion = await prisma.projectVersion.findFirst({
    where: {
      projectId,
      isActive: true,
    },
    select: {
      version: true,
      createdAt: true,
    },
  });

  return {
    id: project.id,
    name: project.name,
    version: activeVersion?.version ?? "1.0.0",
    lastUpdated: activeVersion?.createdAt ?? null,
  };
}


export const updateProjectDetailsService = async ({ projectId, userId, body }) => {
  const {
    description,
    jiraUsername, // Added to fix the auth issue
    jiraBaseUrl,
    jiraProjectKey,
    jiraApiToken,
  } = body;

  // 1. Check if project exists and user has permission
  const existingProject = await prisma.project.findUnique({
    where: { id: Number(projectId) },
  });

  if (!existingProject) {
    throw new ApiError(404, "Project not found");
  }



  const jEmail = jiraUsername || existingProject.jiraUsername;
  const jBase = jiraBaseUrl || existingProject.jiraBaseUrl;
  const jKey = jiraProjectKey || existingProject.jiraProjectKey;
  const jToken = jiraApiToken || existingProject.jiraApiToken;

  if (jEmail && jBase && jKey && jToken) {
    await validateJiraConnection(jBase, jKey, jEmail, jToken);
  }

  // 3. Update the database
  return await prisma.project.update({
    where: { id: Number(projectId) },
    data: {
      description,
      jiraUsername,
      jiraBaseUrl,
      jiraProjectKey,
      jiraApiToken,
    },
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



/** Remove _preview dirs older than this (ms) so _preview does not stay filled forever. */
const PREVIEW_TTL_MS = 1 * 60 * 60 * 1000; // 1 hour

// Stored next to serve/ so express.static(serve) does not expose it
const PREVIEW_META_FILE = ".preview-meta.json";

/**
 * Delete stale preview dirs under _preview/ after PREVIEW_TTL_MS.
 * Uses .preview-meta.json { createdAt } next to each project dir when present; else dir mtime.
 * Call periodically and at start of switchProjectVersion.
 */
export async function cleanupStalePreviews() {
  const backendRoot = getBackendRoot();
  const previewRoot = path.join(backendRoot, "_preview");
  if (!fs.existsSync(previewRoot)) return;
  const now = Date.now();
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
        console.log("[cleanupStalePreviews] removed expired preview:", dirPath);
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
    select: { id: true, name: true, projectPath: true, port: true },
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
      select: { zipFilePath: true, version: true },
    });
    if (!versionRow) {
      throw new ApiError(404, "Version not found");
    }
    tag = versionRow.zipFilePath;
    versionLabel = versionRow.version;
  } else {
    tag = String(versionIdOrTag);
    const versionRow = await prisma.projectVersion.findFirst({
      where: { projectId, zipFilePath: tag },
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

  try {
    await cleanupStalePreviews();

    await fs.remove(previewDir).catch(() => { });
    await fs.ensureDir(previewDir);

    runCommand(`git --git-dir="${gitDir}" worktree prune`, backendRoot);
    runCommand(`git --git-dir="${gitDir}" worktree add "${previewRepo}" "${tag}"`, backendRoot);

    const sourceRoot = findProjectRoot(previewRepo);
    const buildOutputPath = await runBuildSequence(sourceRoot);
    await fs.ensureDir(previewServe);
    await fs.emptyDir(previewServe);
    await fs.copy(buildOutputPath, previewServe);
    // Marker for TTL cleanup (1 hour); kept beside serve/ so it is not served as static
    await fs.writeFile(
      path.join(previewDir, PREVIEW_META_FILE),
      JSON.stringify({ createdAt: Date.now() }),
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

    const domain = process.env.BASE_DOMAIN || "localhost";
    const projectUrl = `http://${domain}:${project.port}`;
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


