import express from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = express.Router();
const prisma = new PrismaClient();

// Get all managers
router.get("/managers", authenticateToken, async (req, res) => {
  try {
    const managers = await prisma.user.findMany({
      where: {
        role: "manager",
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
    res.json(managers);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch managers" });
  }
});
export default router;
