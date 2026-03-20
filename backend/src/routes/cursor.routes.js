import express from "express";
import { PrismaClient, ReleaseStatus } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { cursorRequest, performMergeToLaunchpad, startAgentPolling } from "../services/cursor.service.js";

const router = express.Router();
const prisma = new PrismaClient();

function requireCursorKey(req, res, next) {
  if (!process.env.CURSOR_API_KEY?.trim()) {
    return res.status(503).json({ error: "Cursor API key not configured" });
  }
  next();
}

/** POST /api/cursor/agents - Create a new cloud agent */
router.post("/agents", authenticateToken, requireCursorKey, async (req, res) => {
  const body = req.body || {};
  const prompt = body.prompt;
  const source = body.source;
  const projectId = body.projectId != null ? Number(body.projectId) : NaN;
  const releaseId = body.releaseId != null ? Number(body.releaseId) : NaN;
  const nodeCount = body.nodeCount != null ? Number(body.nodeCount) : null;

  if (!prompt || typeof prompt.text !== "string" || !prompt.text.trim()) {
    return res.status(400).json({ error: "prompt.text is required" });
  }
  if (!source || (typeof source.repository !== "string" && typeof source.prUrl !== "string")) {
    return res.status(400).json({
      error: "source is required with either source.repository or source.prUrl",
    });
  }
  if (!Number.isInteger(projectId) || projectId < 1) {
    return res.status(400).json({ error: "projectId is required and must be a positive integer" });
  }
  if (!Number.isInteger(releaseId) || releaseId < 1) {
    return res.status(400).json({ error: "releaseId is required and must be a positive integer" });
  }

  const userId = req.user.id;
  const role = req.user.role;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, assignedManagerId: true },
  });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  const hasAccess =
    role === "admin" || (role === "manager" && project.assignedManagerId === userId);
  if (!hasAccess) {
    return res.status(403).json({ error: "Forbidden: no access to this project" });
  }
  const release = await prisma.release.findFirst({
    where: { id: releaseId, projectId },
    select: { id: true, status: true },
  });
  if (!release) {
    return res.status(404).json({ error: "Release not found or does not belong to this project" });
  }
  if (release.status === ReleaseStatus.locked) {
    return res.status(400).json({
      error: "Locked release cannot be modified until status changes.",
    });
  }

  try {
    const { status, data } = await cursorRequest({
      method: "POST",
      path: "/v0/agents",
      body: {
        prompt: body.prompt,
        model: body.model,
        source: body.source,
        target: body.target,
        webhook: body.webhook,
      },
    });
    if (!data || !data.id) {
      return res.status(status).json(data);
    }
    const count = await prisma.figmaConversion.count({
      where: { projectId, releaseId },
    });
    const attemptNumber = count + 1;
    try {
      await prisma.figmaConversion.create({
        data: {
          projectId,
          releaseId,
          agentId: data.id,
          attemptedById: userId,
          attemptNumber,
          nodeCount: nodeCount != null && !Number.isNaN(nodeCount) ? nodeCount : null,
          status: data.status || "CREATING",
        },
      });
    } catch (dbErr) {
      console.error("[cursor] FigmaConversion insert failed:", dbErr);
    }
    startAgentPolling(data.id);
    return res.status(status).json(data);
  } catch (err) {
    if (err.code === "CURSOR_KEY_MISSING") {
      return res.status(503).json({ error: err.message });
    }
    return res.status(502).json({
      error: err.message || "Cursor API request failed",
    });
  }
});

/** POST /api/cursor/agents/:id/followup - Add follow-up to an existing agent */
router.post(
  "/agents/:id/followup",
  authenticateToken,
  requireCursorKey,
  async (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!id) {
      return res.status(400).json({ error: "Agent id is required" });
    }

    const body = req.body || {};
    const prompt = body.prompt;
    if (!prompt || typeof prompt.text !== "string" || !prompt.text.trim()) {
      return res.status(400).json({ error: "prompt.text is required" });
    }

    try {
      const { status, data } = await cursorRequest({
        method: "POST",
        path: `/v0/agents/${encodeURIComponent(id)}/followup`,
        body: { prompt: body.prompt },
      });
      return res.status(status).json(data);
    } catch (err) {
      if (err.code === "CURSOR_KEY_MISSING") {
        return res.status(503).json({ error: err.message });
      }
      return res.status(502).json({
        error: err.message || "Cursor API request failed",
      });
    }
  }
);

/** POST /api/cursor/agents/:id/stop - Stop a running agent */
router.post(
  "/agents/:id/stop",
  authenticateToken,
  requireCursorKey,
  async (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!id) {
      return res.status(400).json({ error: "Agent id is required" });
    }

    try {
      const { status, data } = await cursorRequest({
        method: "POST",
        path: `/v0/agents/${encodeURIComponent(id)}/stop`,
      });
      return res.status(status).json(data);
    } catch (err) {
      if (err.code === "CURSOR_KEY_MISSING") {
        return res.status(503).json({ error: err.message });
      }
      return res.status(502).json({
        error: err.message || "Cursor API request failed",
      });
    }
  }
);

/** GET /api/cursor/agents/:id - Get agent status */
router.get("/agents/:id", authenticateToken, requireCursorKey, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
  if (!id) {
    return res.status(400).json({ error: "Agent id is required" });
  }

  try {
    const { status, data } = await cursorRequest({
      method: "GET",
      path: `/v0/agents/${encodeURIComponent(id)}`,
    });
    return res.status(status).json(data);
  } catch (err) {
    if (err.code === "CURSOR_KEY_MISSING") {
      return res.status(503).json({ error: err.message });
    }
    return res.status(502).json({
      error: err.message || "Cursor API request failed",
    });
  }
});

/** POST /api/cursor/agents/:id/merge-to-launchpad - Force-update launchpad to agent branch, then tag + ProjectVersion + FigmaConversion */
router.post(
  "/agents/:id/merge-to-launchpad",
  authenticateToken,
  requireCursorKey,
  async (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!id) {
      return res.status(400).json({ error: "Agent id is required" });
    }

    const userId = req.user.id;
    const role = req.user.role;

    const conversion = await prisma.figmaConversion.findFirst({
      where: { agentId: id },
      select: { projectId: true },
    });
    if (!conversion) {
      return res.status(404).json({ error: "Agent not found or not linked to a project" });
    }

    const project = await prisma.project.findUnique({
      where: { id: conversion.projectId },
      select: { assignedManagerId: true, githubToken: true, gitRepoPath: true },
    });
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    const hasAccess =
      role === "admin" || (role === "manager" && project.assignedManagerId === userId);
    if (!hasAccess) {
      return res.status(403).json({ error: "Forbidden: no access to this project" });
    }
    if (!project.githubToken?.trim() || !project.gitRepoPath?.trim()) {
      return res.status(400).json({ error: "Project has no GitHub token or Git repo path configured" });
    }

    let agentData;
    try {
      const { status, data } = await cursorRequest({
        method: "GET",
        path: `/v0/agents/${encodeURIComponent(id)}`,
      });
      if (status !== 200 || !data) {
        return res.status(400).json({ error: "Could not fetch agent status" });
      }
      agentData = data;
    } catch (err) {
      return res.status(502).json({
        error: err.message || "Cursor API request failed",
      });
    }

    if (agentData.status !== "FINISHED") {
      return res.status(400).json({
        error: `Agent is not finished (status: ${agentData.status || "unknown"})`,
      });
    }

    try {
      const result = await performMergeToLaunchpad(id, agentData);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || "Merge failed" });
    }
  }
);

export default router;
