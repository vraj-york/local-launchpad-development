import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
import ApiError from "../utils/apiError.js";
import { createRoadmapWithItems } from "./roadmap.service.js";
import { fetchProjectJiraTickets } from "../utils/jiraIntegration.js";

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
        jiraAccessToken,
        jiraAccessKey,
        jiraIssueType,
        assignedManagerId,
        roadmaps
    } = body;
    /**
  * Validate assigned manager exists
  */
    const managerExists = await prisma.user.findFirst({
        where: {
            id: Number(assignedManagerId),
            role: "manager"
        },
        select: { id: true }
    });

    if (!managerExists) {
        throw new ApiError(400, "Assigned manager not found");
    }
    return prisma.$transaction(async (tx) => {
        /**
         * 1. Create project
         */
        const project = await tx.project.create({
            data: {
                name,
                description,
                githubUsername,
                githubToken,
                jiraBaseUrl,
                jiraProjectKey,
                jiraAccessToken,
                jiraAccessKey,
                jiraIssueType,
                assignedManagerId: Number(assignedManagerId),
                createdById: userId
            }
        });

        /**
         * 2. Create roadmaps and items
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

    // 2. Add Permission Logic
    if (user?.id) {
        // Authenticated: User must be owner, manager, or have explicit access
        whereClause.OR = [
            { createdById: user.id },
            { assignedManagerId: user.id },
            { projectAccess: { some: { userId: user.id } } },
            // Optional: Still allow them to see it if it's public
            // { isPublic: true } 
        ];
    }
    const project = await prisma.project.findFirst({
        where: whereClause,
        include: {
            createdBy: { select: { id: true, name: true, email: true } },
            assignedManager: { select: { id: true, name: true, email: true } },

            // 🧭 Planning roadmap
            roadmaps: {
                orderBy: { id: 'asc' },
                include: {
                    items: { orderBy: { createdAt: 'asc' } },
                },
            },

            // 🚀 Release / version execution
            releases: {
                include: {
                    versions: true
                }
            },
        },
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
export async function setReleaseStatusService({
    projectId,
    releaseId,
    user
}) {
    // 1️⃣ Access check
    await assertProjectAccess(projectId, user);


    await prisma.$transaction(async (tx) => {

        // 2️⃣ Update active status
        const release = await prisma.release.findFirst({
            where: { id: releaseId, projectId }
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
    })
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
const roadmapData = (r) => ({
    title: r.title,
    description: r.description,
    status: r.status,
    timelineStart: new Date(r.timelineStart),
    timelineEnd: new Date(r.timelineEnd),
});

const itemData = (i) => ({
    title: i.title,
    description: i.description,
    status: i.status,
    priority: i.priority,
    startDate: new Date(i.startDate),
    endDate: new Date(i.endDate),
});


export const updateProjectService = async ({ projectId, userId, roadmap }) => {

    return prisma.$transaction(async (tx) => {

        // 2️⃣ Upsert roadmap (only one allowed)
        let roadmapId;

        if (roadmap.id) {
            const updated = await tx.roadmap.update({
                where: { id: roadmap.id },
                data: roadmapData(roadmap),
            });
            roadmapId = updated.id;
        } else {
            const created = await tx.roadmap.create({
                data: {
                    ...roadmapData(roadmap),
                    projectId: Number(projectId),
                },
            });
            roadmapId = created.id;
        }

        // 3️⃣ Split items
        const existingItems = roadmap.items.filter(i => i.id);
        const newItems = roadmap.items.filter(i => !i.id);

        // 4️⃣ Update existing items (parallel)
        await Promise.all(
            existingItems.map(item =>
                tx.roadmapItem.update({
                    where: { id: item.id },
                    data: itemData(item),
                })
            )
        );

        // 5️⃣ Create new items (bulk)
        if (newItems.length) {
            await tx.roadmapItem.createMany({
                data: newItems.map(i => ({
                    ...itemData(i),
                    roadmapId,
                })),
            });
        }



        return {
            message: "Project updated successfully",
        };
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
            jiraAccessToken: true,
            jiraAccessKey: true, // This is expected to be the email/username
        }
    });

    if (!projectDetails.jiraBaseUrl || !projectDetails.jiraProjectKey || !projectDetails.jiraAccessToken || !projectDetails.jiraAccessKey) {
        throw new ApiError(400, "Jira configuration missing for this project");
    }

    // 3️⃣ Fetch tickets
    const result = await fetchProjectJiraTickets({
        baseUrl: projectDetails.jiraBaseUrl,
        projectKey: projectDetails.jiraProjectKey,
        apiToken: projectDetails.jiraAccessToken,
        email: projectDetails.jiraAccessKey
    });

    if (!result.success) {
        throw new ApiError(502, `Failed to fetch Jira tickets: ${result.error}`);
    }

    return result.issues;
};
