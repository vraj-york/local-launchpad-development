import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
import ApiError from "../utils/apiError.js";
import { createRoadmapWithItems } from "./roadmap.service.js";
import { fetchProjectJiraTickets } from "../utils/jiraIntegration.js";
import axios from "axios";

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
export const createProjectService = async ({ userId, body }) => {
  const {
    name,
    description,
    githubUsername,
    githubToken,
    jiraBaseUrl,
    jiraProjectKey,
    jiraApiToken,
    jiraUsername,
    jiraIssueType,
    assignedManagerId,
    roadmaps,
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
    validateGithubConnection(githubUsername, githubToken),
    validateJiraConnection(jiraBaseUrl, jiraProjectKey, jiraUsername, jiraApiToken)
  ]);
  return prisma.$transaction(async (tx) => {
    /**
     * 3. Create project
     */
    const project = await tx.project.create({
      data: {
        name,
        description,
        githubUsername,
        githubToken,
        jiraBaseUrl,
        jiraProjectKey,
        jiraApiToken,
        jiraUsername,
        jiraIssueType,
        assignedManagerId: Number(assignedManagerId),
        createdById: userId,
      },
    });

    /**
     * 4. Create roadmaps and items
     */
    for (const roadmap of roadmaps) {
      await createRoadmapWithItems(tx, project.id, roadmap);
    }

    return project;
  });
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
 * NEW: Activate project version
 */

export async function activateProjectVersionService({
  projectId,
  versionId,
  user,
}) {
  // 1️⃣ Access check
  await assertProjectAccess(projectId, user);

  // 2️⃣ Transaction-safe activation
  await prisma.$transaction(async (tx) => {
    const version = await tx.projectVersion.findFirst({
      where: { id: versionId, projectId },
      select: { id: true, isActive: true },
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
  });
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
/*GET LIVE URL*/
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
    githubUsername,
    githubToken,
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

  /** * 2. Validate Connections 
   * We only validate if the user is providing new credentials
   */
  const githubUser = githubUsername || existingProject.githubUsername;
  const githubPass = githubToken || existingProject.githubToken;

  if (githubUser && githubPass) {
    await validateGithubConnection(githubUser, githubPass);
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
      githubUsername,
      githubToken,
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
