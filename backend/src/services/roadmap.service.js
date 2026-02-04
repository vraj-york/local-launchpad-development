import { PrismaClient } from "@prisma/client";
import { validateRoadmapItems } from "../validators/roadmap.validator.js";
import ApiError from "../utils/apiError.js";
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
    return prisma.$transaction((tx) =>
        deleteRoadmapTx(tx, roadmapId)
    );
};

export const deleteRoadmapTx = async (tx, roadmapId) => {
    const roadmap = await tx.roadmap.findUnique({
        where: { id: roadmapId },
        include: {
            items: {
                include: {
                    release: {
                        select: { id: true, name: true },
                    },
                },
            },
        },
    });
    if (!roadmap) {
        throw new ApiError(404, "Roadmap not found");
    }

    const linkedRelease = roadmap.items.find(
        (item) => item.releaseId !== null
    );
    if (linkedRelease) {
        throw new ApiError(
            400,
            `Cannot delete roadmap. Item "${linkedRelease.title}" is linked to release "${linkedRelease.release.name}".`
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
            release: { select: { name: true } },
        },
    });

    if (!item) {
        throw new ApiError(404, "Roadmap item not found");
    }
    if (item.releaseId) {
        throw new ApiError(
            400,
            `Cannot delete item. Linked to release "${item.release?.name}".`
        );
    }

    await tx.roadmapItem.delete({ where: { id: itemId } });

    return { message: "Roadmap item deleted successfully" };
};

export const deleteRoadmapItem = async (roadmapId, itemId) =>
    prisma.$transaction((tx) => deleteRoadmapItemTx(tx, roadmapId, itemId));


