import express from "express";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { releaseController } from "../controllers/release.controller.js";
import multer from "multer";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Releases
 *   description: Release management API
 */


// --- Project Releases ---

/**
 * @swagger
 * /releases/project/{projectId}:
 *   get:
 *     summary: List all releases for a project
 *     tags: [Releases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the project
 *     responses:
 *       200:
 *         description: List of releases
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   isLocked:
 *                     type: boolean
 *                   versions:
 *                     type: array
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Project not found
 */
router.get("/project/:projectId", authenticateToken, releaseController.list);

// --- Release Management ---

/**
 * @swagger
 * /releases:
 *   post:
 *     summary: Create a new release
 *     tags: [Releases]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - projectId
 *               - name
 *             properties:
 *               projectId:
 *                 type: integer
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               roadmapItemId:
 *                 type: integer
 *                 description: Optional ID of a roadmap item to link
 *     responses:
 *       201:
 *         description: Release created successfully
 *       400:
 *         description: Invalid input or validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Project or Roadmap Item not found
 */
router.post("/", authenticateToken, releaseController.create);

/**
 * @swagger
 * /releases/{id}:
 *   get:
 *     summary: Get a release by ID
 *     tags: [Releases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Release details
 *       404:
 *         description: Release not found
 */
router.get("/:id", authenticateToken, releaseController.getById);

// Lock/Unlock

/**
 * @swagger
 * /releases/{id}/lock:
 *   post:
 *     summary: Lock or unlock a release
 *     tags: [Releases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - locked
 *             properties:
 *               locked:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Release lock status updated
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Release not found
 */
router.post("/:id/lock", authenticateToken, releaseController.lock);

/**
 * @swagger
 * /releases/{id}/status:
 *   patch:
 *     summary: Set release status (draft | active | locked)
 *     tags: [Releases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [draft, active, locked]
 *     responses:
 *       200:
 *         description: Release status updated
 *       400:
 *         description: Invalid status
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Release not found
 */
router.patch("/:id/status", authenticateToken, releaseController.setStatus);

/**
 * @swagger
 * /releases/{id}/public-lock:
 *   post:
 *     summary: Lock or unlock a release (Public)
 *     tags: [Releases]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - locked
 *               - token
 *             properties:
 *               locked:
 *                 type: boolean
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Release lock status updated
 *       400:
 *         description: Invalid token or parameters
 *       404:
 *         description: Release not found
 */
router.post("/:id/public-lock", releaseController.publicLock); // No auth required (token based)

// Info (Public)

/**
 * @swagger
 * /releases/{id}/info:
 *   get:
 *     summary: Get release info (Public)
 *     tags: [Releases]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Release info including lock token
 *       404:
 *         description: Release not found
 */
router.get("/:id/info", releaseController.info);



const upload = multer({
    dest: path.join(process.cwd(), "uploads"),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

router.post(
    "/:releaseId/upload",
    authenticateToken,
    upload.single("project"),
    releaseController.upload
);


/**
 * @swagger
 * /releases/preview/{versionId}:
 *   get:
 *     summary: Preview a release version
 *     description: >
 *       Redirects to the public build URL (S3/CloudFront) for a given release version.
 *       Used to preview deployed HTML builds.
 *     tags:
 *       - Releases
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: versionId
 *         required: true
 *         schema:
 *           type: integer
 *           example: 14
 *         description: Project version ID to preview
 *     responses:
 *       302:
 *         description: Redirect to build preview URL
 *         headers:
 *           Location:
 *             schema:
 *               type: string
 *               example: https://bucket.s3-website.ap-south-1.amazonaws.com/projects/12/release/15/1.0.0/index.html
 *       400:
 *         description: Build not available
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Version not found
 */
router.get(
    "/preview/:versionId",
    authenticateToken,
    releaseController.previewVersion
);

export default router;
