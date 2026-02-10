import { deleteRoadmap, deleteRoadmapItem, listRoadmapItemsByProjectService, updateRoadmapService } from "../services/roadmap.service.js";
import { validateRoadmapTimelines, validateRoadmapItemsTimeline } from "../validators/roadmap.validator.js";
import asyncHandler from "../middleware/asyncHandler.middleware.js";

export const roadmapController = {
    /**
     * Delete roadmap
     * ❌ Block if any item is assigned to a release
     */

    delete: asyncHandler(async (req, res) => {
        const roadmapId = Number(req.params.roadmapId);
        const result = await deleteRoadmap(roadmapId);
        res.json(result);
    }),
    /**
     * Delete roadmap item
     * ❌ Block if item is assigned to a release
     */
    deleteItem: asyncHandler(async (req, res) => {
        const roadmapItemId = Number(req.params.itemId);
        const roadmapId = Number(req.params.roadmapId);

        const result = await deleteRoadmapItem(roadmapId, roadmapItemId);

        res.json(result);
    }),
    /**
     * List roadmap items by project
     */
    listItemsByProject: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.projectId);

        const data = await listRoadmapItemsByProjectService(
            projectId,
            req.user
        );

        res.json(data);
    }),

    /**
     * Update roadmap (and items)
     */
    update: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.projectId);
        const { roadmaps } = req.body;

        // Validation
        const validatedRoadmaps = validateRoadmapTimelines(roadmaps);

        validatedRoadmaps.forEach(roadmap => {
            validateRoadmapItemsTimeline(roadmap);
        });

        const result = await updateRoadmapService({
            projectId,
            user: req.user,
            roadmaps: validatedRoadmaps
        });

        res.json(result);
    }),
};
