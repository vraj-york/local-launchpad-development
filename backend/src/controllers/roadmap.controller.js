import { deleteRoadmap, deleteRoadmapItem, listRoadmapItemsByProjectService } from "../services/roadmap.service.js";
import asyncHandler from "../middleware/asyncHandler.middleware.js";

export const roadmapController = {
    /**
     * Delete roadmap
     * ❌ Block if any item is assigned to a release
     */

    delete: asyncHandler(async (req, res) => {
        const roadmapId = Number(req.params.roadmapId);
        const result = await deleteRoadmap(roadmapId);
        res.status(200).json(result);
    }),
    /**
     * Delete roadmap item
     * ❌ Block if item is assigned to a release
     */
    deleteItem: asyncHandler(async (req, res) => {
        const roadmapItemId = Number(req.params.itemId);
        const roadmapId = Number(req.params.roadmapId);

        const result = await deleteRoadmapItem(roadmapId, roadmapItemId);

        res.status(200).json(result);
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
};


