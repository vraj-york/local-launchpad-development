import express from "express";
const router = express.Router();
import { roadmapController } from "../controllers/roadmap.controller.js";
import { param } from "express-validator";

/**
 * @swagger
 * /roadmaps/{roadmapId}:
 *   delete:
 *     summary: Delete a roadmap
 *     tags: [Roadmaps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roadmapId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Roadmap deleted successfully
 *       400:
 *         description: Roadmap or its items are linked to a release
 *       404:
 *         description: Roadmap not found
 */
router.delete(
    "/:roadmapId",
    param("roadmapId").isInt(),
    roadmapController.delete
);
/**
 * @swagger
 * /roadmaps/{roadmapId}/items/{itemId}:
 *   delete:
 *     summary: Delete a roadmap item
 *     tags: [Roadmaps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roadmapId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Roadmap item deleted successfully
 *       400:
 *         description: Roadmap item is linked to a release
 *       404:
 *         description: Roadmap or item not found
 */


router.delete(
    "/:roadmapId/items/:itemId",
    [
        param("roadmapId").isInt(),
        param("itemId").isInt()
    ],
    roadmapController.deleteItem
);
export default router;
