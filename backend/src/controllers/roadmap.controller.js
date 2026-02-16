import { deleteRoadmap, deleteRoadmapItem, listRoadmapItemsByProjectService, updateRoadmapService } from "../services/roadmap.service.js";
import { validateRoadmapTimelines, validateRoadmapItemsTimeline } from "../validators/roadmap.validator.js";
import asyncHandler from "../middleware/asyncHandler.middleware.js";
import { decryptId, encryptAllIds } from "../utils/encryptionHelper.js";

export const roadmapController = {
    /**
     * Delete roadmap
     * ❌ Block if any item is assigned to a release
     */

    delete: asyncHandler(async (req, res) => {
        const roadmapId = decryptId(req.params.roadmapId);
        const result = await deleteRoadmap(Number(roadmapId));
        res.json(result);
    }),
    /**
     * Delete roadmap item
     * ❌ Block if item is assigned to a release
     */
    deleteItem: asyncHandler(async (req, res) => {
        const decreyptroadmapItemId = decryptId(req.params.itemId);
        const decreyptroadmapId = decryptId(req.params.roadmapId);

        const roadmapItemId = Number(decreyptroadmapItemId);
        const roadmapId = Number(decreyptroadmapId);
        const result = await deleteRoadmapItem(roadmapId, roadmapItemId);

        res.json(result);
    }),
    /**
     * List roadmap items by project
     */
    listItemsByProject: asyncHandler(async (req, res) => {
        const projectId = decryptId(req.params.projectId)

        const data = await listRoadmapItemsByProjectService(
            Number(projectId),
            req.user
        );

        res.json(data);
    }),

    /**
     * Update roadmap (and items)
     */
    update: asyncHandler(async (req, res) => {
        const decreyptProjectId = decryptId(req.params.projectId);
        const projectId = Number(decreyptProjectId);
        const { roadmap } = req.body;

        if (!roadmap) {
            return res.status(400).json({ message: "roadmap is required" });
        }

        // Validate roadmap timeline
        validateRoadmapTimelines([roadmap]);

        // Validate items timeline
        validateRoadmapItemsTimeline(roadmap);

        const result = await updateRoadmapService({
            projectId,
            user: req.user,
            roadmap, // 👈 single roadmap
        });

        res.json(encryptAllIds(result));
    })

};
