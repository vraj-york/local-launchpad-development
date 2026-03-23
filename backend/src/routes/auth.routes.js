import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";
import { authenticateToken } from "../middleware/auth.middleware.js";
import {
  getCognitoVerifier,
  findOrCreateUserFromCognitoPayload,
} from "../utils/cognitoAuth.js";

const router = express.Router();
const prisma = new PrismaClient();

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
router.get("/managers", async (req, res) => {
  try {
    const managers = await prisma.user.findMany({
      where: { role: "manager" },
      select: {
        id: true,
        name: true,
        email: true
      }
    });
    res.json(managers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword, role },
    });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: "Email already exists" });
  }
});

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
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
  res.json({ token, user });
});

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
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, image: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
router.put("/me", authenticateToken, async (req, res) => {
  try {
    const { name, image } = req.body || {};
    const updateData = {};
    if (typeof name === "string" && name.trim()) updateData.name = name.trim();
    if (typeof image === "string") updateData.image = image.trim() || null;
    if (Object.keys(updateData).length === 0) {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, name: true, email: true, role: true, image: true },
      });
      return res.json({ user: user || null });
    }
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
      select: { id: true, name: true, email: true, role: true, image: true },
    });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;