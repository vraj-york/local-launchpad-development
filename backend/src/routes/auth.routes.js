import express from "express";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { authController } from "../controllers/auth.controller.js";

const router = express.Router();
/**
 * @swagger
 * /auth/managers:
 *   get:
 *     summary: Get list of managers
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/managers", authController.listManagers);

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *               - role
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [admin, manager, developer]
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/register", authController.register);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/login", authController.login);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user (same token for launchpad + Hub; Cognito credentials verify and link DB user)
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description:  launchpad DB user
 *       401:
 *         description: Invalid or missing token
 */
router.get("/me", authenticateToken, authController.getMe);

/**
 * @swagger
 * /auth/me:
 *   put:
 *     summary: Update current user profile (name, image); returns updated user for use across APIs
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               image: { type: string }
 *     responses:
 *       200:
 *         description: Updated launchpad DB user
 */
router.put("/me", authenticateToken, authController.updateMe);

export default router;
