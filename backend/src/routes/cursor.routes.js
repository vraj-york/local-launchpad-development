import express from "express";
import { PrismaClient, ReleaseStatus } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.middleware.js";
import {
  createAgentForProjectRelease,
  cursorRequest,
  getCursorAgentById,
  postCursorAgentFollowup,
  performMergeToLaunchpad,
} from "../services/cursor.service.js";
import { resolveGithubCredentialsFromProject } from "../services/integrationCredential.service.js";
import { assertProjectAccess } from "../services/project.service.js";
import ApiError from "../utils/apiError.js";

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

  try {
    await assertProjectAccess(projectId, req.user);
  } catch (err) {
    if (err instanceof ApiError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    throw err;
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
    const result = await createAgentForProjectRelease({
      projectId,
      releaseId,
      attemptedById: req.user.id,
      prompt: body.prompt,
      nodeCount,
      source: body.source,
      model: body.model,
      target: body.target,
      webhook: body.webhook,
    });
    if (!result.ok) {
      return res.status(result.status).json(result.data);
    }
    return res.status(result.status).json(result.data);
  } catch (err) {
    if (err.code === "CURSOR_KEY_MISSING") {
      return res.status(503).json({ error: err.message });
    }
    if (
      err.code === "GITHUB_NOT_CONFIGURED" ||
      err.code === "SCM_NOT_CONFIGURED" ||
      err.code === "REPO_UNRESOLVED" ||
      err.code === "REPO_INACCESSIBLE"
    ) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === "PROJECT_NOT_FOUND") {
      return res.status(404).json({ error: err.message });
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

    const conversion = await prisma.figmaConversion.findFirst({
      where: { agentId: id },
      select: { projectId: true },
    });
    if (!conversion) {
      return res.status(404).json({ error: "Agent not linked to a project" });
    }
    try {
      await assertProjectAccess(conversion.projectId, req.user);
    } catch (err) {
      if (err instanceof ApiError) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      throw err;
    }

    try {
      const { status, data } = await postCursorAgentFollowup(id, body.prompt);
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
    const { status, data } = await getCursorAgentById(id);
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

    const conversion = await prisma.figmaConversion.findFirst({
      where: { agentId: id },
      select: { projectId: true },
    });
    if (!conversion) {
      return res.status(404).json({ error: "Agent not found or not linked to a project" });
    }

    try {
      await assertProjectAccess(conversion.projectId, req.user);
    } catch (err) {
      if (err instanceof ApiError) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      throw err;
    }

    const project = await prisma.project.findUnique({
      where: { id: conversion.projectId },
      select: {
        githubToken: true,
        gitRepoPath: true,
        githubConnectionId: true,
        createdById: true,
        githubUsername: true,
      },
    });
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    let ghTokRoute = "";
    try {
      ghTokRoute = (await resolveGithubCredentialsFromProject(project)).githubToken?.trim() || "";
    } catch {
      ghTokRoute = "";
    }
    if (!ghTokRoute?.trim() || !project.gitRepoPath?.trim()) {
      return res.status(400).json({ error: "Project has no GitHub token or Git repo path configured" });
    }

    let agentData;
    try {
      const { status, data } = await getCursorAgentById(id);
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
