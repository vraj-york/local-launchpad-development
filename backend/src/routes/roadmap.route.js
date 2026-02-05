import express from "express";
const router = express.Router();
import { roadmapController } from "../controllers/roadmap.controller.js";
import { param } from "express-validator";
import { authenticateToken } from "../middleware/auth.middleware.js";

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
    authenticateToken,
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
    authenticateToken,
    [
        param("roadmapId").isInt(),
        param("itemId").isInt()
    ],
    roadmapController.deleteItem
);

/**
 * GET roadmap items by project
 */
/**
 * @swagger
 * /roadmaps/project/{projectId}/items:
 *   get:
 *     summary: Get roadmap items by project
 *     tags: [Roadmaps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of roadmaps with items
 */

router.get(
    "/project/:projectId/items",
    authenticateToken,
    param("projectId").isInt(),
    roadmapController.listItemsByProject
);
export default router;
