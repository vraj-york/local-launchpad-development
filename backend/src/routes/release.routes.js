import express from "express";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { releaseController } from "../controllers/release.controller.js";
import {
    createReleaseValidation,
    updateReleaseValidation,
    setReleaseStatusValidation,
    lockReleaseValidation,
    publicLockReleaseValidation,
    releaseChangelogParamValidation,
} from "../validators/release.validator.js";
import { validate } from "../validators/validate.middleware.js";
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
 *                   status:
 *                     type: string
 *                     enum: [draft, active, locked, skip]
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
router.post(
    "/",
    authenticateToken,
    createReleaseValidation,
    validate,
    releaseController.create,
);

/**
 * @swagger
 * /releases/{id}/changelog:
 *   get:
 *     summary: Release audit history (newest first)
 *     tags: [Releases]
 *     security:
 *       - bearerAuth: []
 */
router.get(
    "/:id/changelog",
    authenticateToken,
    releaseChangelogParamValidation,
    validate,
    releaseController.changelog,
);

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

/**
 * @swagger
 * /releases/{id}:
 *   patch:
 *     summary: Update release fields (not status)
 *     tags: [Releases]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
    "/:id",
    authenticateToken,
    updateReleaseValidation,
    validate,
    releaseController.update,
);

// Lock (one-way)

/**
 * @swagger
 * /releases/{id}/lock:
 *   post:
 *     summary: Lock a release (unlock not supported)
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
 *                 description: Must be true; false is rejected
 *     responses:
 *       200:
 *         description: Release locked; versions on this release have isActive cleared
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Release not found
 */
router.post(
    "/:id/lock",
    authenticateToken,
    lockReleaseValidation,
    validate,
    releaseController.lock,
);

/**
 * @swagger
 * /releases/{id}/status:
 *   patch:
 *     summary: Set release status (draft | active | locked | skip)
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
 *                 enum: [draft, active, locked, skip]
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
router.patch(
    "/:id/status",
    authenticateToken,
    setReleaseStatusValidation,
    validate,
    releaseController.setStatus,
);

/**
 * @swagger
 * /releases/{id}/public-lock:
 *   post:
 *     summary: Lock a release (Public; unlock not supported)
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
 *               - lockedBy
 *             properties:
 *               lockedBy:
 *                 type: string
 *                 format: email
 *                 description: Must match a project stakeholder email (see Project.stakeholderEmails)
 *     responses:
 *       200:
 *         description: Release locked; versions on this release have isActive cleared
 *       400:
 *         description: Invalid email or parameters
 *       403:
 *         description: Email not in project stakeholders, or no stakeholders configured
 *       404:
 *         description: Release not found
 */
router.post(
    "/:id/public-lock",
    publicLockReleaseValidation,
    validate,
    releaseController.publicLock,
); // No auth required

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
 *         description: Release info (includes lockedBy when locked)
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


export default router;
