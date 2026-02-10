import { PrismaClient } from "@prisma/client";
import { validateRoadmapItems } from "../validators/roadmap.validator.js";
import ApiError from "../utils/apiError.js";
import { assertProjectAccess } from "./project.service.js";
const prisma = new PrismaClient();

export const createRoadmapWithItems = async (tx, projectId, roadmap) => {
    const newRoadmap = await tx.roadmap.create({
        data: {
            projectId,
            title: roadmap.title,
            description: roadmap.description,
            status: roadmap.status ?? "DRAFT",
            tshirtSize: roadmap.tshirtSize ?? "M",
            timelineStart: roadmap.timelineStart,
            timelineEnd: roadmap.timelineEnd
        }
    });

    const items = validateRoadmapItems(roadmap, roadmap.items);
    if (items.length) {
        await tx.roadmapItem.createMany({
            data: items.map((item) => ({
                roadmapId: newRoadmap.id,
                title: item.title,
                description: item.description,
                type: item.type ?? "FEATURE",
                status: item.status ?? "PLANNED",
                priority: item.priority ?? "MEDIUM",
                startDate: item.start,
                endDate: item.end
            }))
        });
    }

    return newRoadmap;
};
export const deleteRoadmap = async (roadmapId) => {
    return await prisma.$transaction((tx) =>
        deleteRoadmapTx(tx, roadmapId)
    );
};

export const deleteRoadmapTx = async (tx, roadmapId) => {
    const roadmap = await tx.roadmap.findUnique({
        where: { id: roadmapId },
        include: {
            items: {
                include: {
                    projectVersion: {
                        select: { id: true, version: true },
                    },
                },
            },
        },
    });
    if (!roadmap) {
        throw new ApiError(404, "Roadmap not found");
    }

    const linkedVersion = roadmap.items.find(
        (item) => item.projectVersionId !== null
    );
    if (linkedVersion) {
        throw new ApiError(
            400,
            `Cannot delete roadmap. Item "${linkedVersion.title}" is linked to version "${linkedVersion.projectVersion.version}".`
        );
    }

    await tx.roadmapItem.deleteMany({
        where: { roadmapId },
    });

    await tx.roadmap.delete({
        where: { id: roadmapId },
    });

    return { message: "Roadmap deleted successfully" };
};
export const deleteRoadmapItemTx = async (tx, roadmapId, itemId) => {
    const item = await tx.roadmapItem.findUnique({
        where: { id: itemId, roadmapId: roadmapId },
        include: {
            projectVersion: { select: { version: true } },
        },
    });

    if (!item) {
        throw new ApiError(404, "Roadmap item not found");
    }
    if (item.projectVersionId) {
        throw new ApiError(
            400,
            `Cannot delete item. Linked to version "${item.projectVersion?.version}".`
        );
    }

    await tx.roadmapItem.delete({ where: { id: itemId } });

    return { message: "Roadmap item deleted successfully" };
};

export const deleteRoadmapItem = async (roadmapId, itemId) => {
    return await prisma.$transaction((tx) => deleteRoadmapItemTx(tx, roadmapId, itemId));
};

export const listRoadmapItemsByProjectService = async (projectId, user) => {
    const { role, id: userId } = user;

    /**
     * Access control
     */
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { assignedManagerId: true }
    });

    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    if (role !== "admin" && project.assignedManagerId !== userId) {
        throw new ApiError(403, "Forbidden");
    }

    /**
     * Fetch roadmaps + items
     */
    const roadmaps = await prisma.roadmap.findMany({
        where: { projectId },
        orderBy: { timelineStart: "asc" },
        include: {
            items: {
                orderBy: { startDate: 'asc' },
                include: {
                    projectVersion: {
                        include: {
                            release: true,
                        },
                    },
                },
            },
        },
    });

    return roadmaps;
};


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

export const updateRoadmapService = async ({ projectId, user, roadmaps }) => {
    // 1️⃣ Access check
    await assertProjectAccess(projectId, user);

    return prisma.$transaction(async (tx) => {
        const results = [];

        for (const roadmap of roadmaps) {
            // 2️⃣ Upsert roadmap (only one allowed per update call for now, or creates new if no ID)
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
            const existingItems = (roadmap.items || []).filter(i => i.id);
            const newItems = (roadmap.items || []).filter(i => !i.id);

            // 4️⃣ Update existing items (parallel)
            if (existingItems && existingItems.length > 0) {
                await Promise.all(
                    existingItems.map(item =>
                        tx.roadmapItem.update({
                            where: { id: item.id },
                            data: itemData(item),
                        })
                    )
                );
            }

            // 5️⃣ Create new items (bulk)
            if (newItems.length > 0) {
                await tx.roadmapItem.createMany({
                    data: newItems.map(i => ({
                        ...itemData(i),
                        roadmapId,
                    })),
                });
            }

            results.push({
                roadmapId,
                status: "success"
            });
        }

        return {
            message: "Roadmaps updated successfully",
            results
        };
    });
};
