import { validateRoadmapItems } from "../validators/roadmap.validator.js";

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
