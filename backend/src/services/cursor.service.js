import fetch from "node-fetch";
import { PrismaClient } from "@prisma/client";
import {
  parseGitRepoPath,
  ensureBranchFrom,
  getBranchSha,
  updateRef,
  createTag,
  createBranch,
} from "./github.service.js";

const CURSOR_BASE_URL = "https://api.cursor.com";
const prisma = new PrismaClient();
const POLL_INTERVAL_MS = 5000;

/**
 * Call Cursor Cloud Agents API with Basic auth (API key as username, empty password).
 * @param {{ method: string, path: string, body?: object }} options
 * @returns {{ status: number, data: object }} Parsed JSON and status; throws if API key missing or request fails
 */
export async function cursorRequest({ method, path, body }) {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error("Cursor API key not configured");
    err.code = "CURSOR_KEY_MISSING";
    throw err;
  }

  const url = `${CURSOR_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const basicAuth = Buffer.from(`${apiKey}:`).toString("base64");
  const headers = {
    Authorization: `Basic ${basicAuth}`,
  };
  if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method: method || "GET",
    headers,
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  });

  let data;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = { error: "Invalid JSON response from Cursor API" };
    }
  } else {
    const text = await res.text();
    data = text ? { error: text } : {};
  }

  return { status: res.status, data };
}

/**
 * Perform merge-to-launchpad: force-update launchpad branch, create tag, ProjectVersion, update FigmaConversion.
 * Idempotent: if FigmaConversion.projectVersionId is already set, returns success without re-running.
 * @param {string} agentId
 * @param {object} agentData - Cursor agent response (must have status === "FINISHED" and target.branchName)
 * @returns {Promise<{ merged: boolean, sha?: string, version?: string, tag?: string, prUrl?: string }>}
 */
export async function performMergeToLaunchpad(agentId, agentData) {
  const conversion = await prisma.figmaConversion.findFirst({
    where: { agentId },
    select: { id: true, projectId: true, releaseId: true, attemptedById: true, projectVersionId: true },
  });
  if (!conversion) {
    throw new Error("Agent not found or not linked to a project");
  }
  if (conversion.projectVersionId != null) {
    return { merged: true };
  }

  const project = await prisma.project.findUnique({
    where: { id: conversion.projectId },
    select: { githubToken: true, gitRepoPath: true },
  });
  if (!project?.githubToken?.trim() || !project?.gitRepoPath?.trim()) {
    throw new Error("Project has no GitHub token or Git repo path configured");
  }

  const parsed = parseGitRepoPath(project.gitRepoPath);
  if (!parsed) throw new Error("Invalid Git repo path format");
  const { owner, repo } = parsed;
  const token = project.githubToken.trim();

  const headBranch = agentData.target?.branchName;
  if (!headBranch || typeof headBranch !== "string") {
    throw new Error("Agent has no target branch name");
  }

  const headShaResult = await getBranchSha(owner, repo, headBranch, token);
  if (!headShaResult) {
    throw new Error("Could not get agent branch SHA; branch may not exist");
  }
  const headSha = headShaResult.sha;

  const baseBranch = "launchpad";
  const ensureResult = await ensureBranchFrom(owner, repo, baseBranch, "main", token);
  if (!ensureResult.ok) {
    throw new Error(ensureResult.error || "Could not ensure launchpad branch");
  }

  let updateResult = await updateRef(owner, repo, "heads/launchpad", headSha, true, token);
  if (!updateResult.ok && updateResult.status === 404) {
    const createResult = await createBranch(owner, repo, baseBranch, headSha, token);
    if (!createResult.ok) {
      throw new Error(createResult.message || "Could not create launchpad branch at agent SHA");
    }
  } else if (!updateResult.ok) {
    throw new Error(updateResult.message || "Failed to force-update launchpad branch");
  }

  const releaseId = conversion.releaseId;
  let versionNumber = "1.0.0";
  const lastVersion = await prisma.projectVersion.findFirst({
    where: { projectId: conversion.projectId, releaseId },
    orderBy: { createdAt: "desc" },
    select: { version: true },
  });
  if (lastVersion) {
    const semverMatch = lastVersion.version.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (semverMatch) {
      const patch = Number(semverMatch[3]) + 1;
      versionNumber = `${semverMatch[1]}.${semverMatch[2]}.${patch}`;
    }
  }
  const tagName = `rel-${releaseId}-${versionNumber}`;
  const tagResult = await createTag(owner, repo, tagName, headSha, token);
  if (!tagResult.ok) {
    throw new Error(tagResult.message || "Failed to create tag");
  }

  const buildUrl = `https://github.com/${owner}/${repo}/releases/tag/${tagName}`;
  const newVersion = await prisma.projectVersion.create({
    data: {
      projectId: conversion.projectId,
      releaseId: conversion.releaseId,
      version: versionNumber,
      zipFilePath: tagName,
      buildUrl,
      isActive: false,
      uploadedBy: conversion.attemptedById,
    },
  });

  await prisma.figmaConversion.update({
    where: { id: conversion.id },
    data: {
      targetBranchName: headBranch,
      projectVersionId: newVersion.id,
      status: "FINISHED",
    },
  });

  return {
    merged: true,
    sha: headSha,
    version: versionNumber,
    tag: tagName,
    prUrl: agentData.target?.prUrl || agentData.source?.prUrl,
  };
}

/**
 * Background polling: poll Cursor for agent status, update FigmaConversion.status, run merge when FINISHED.
 * Fire-and-forget; does not throw to the caller.
 * @param {string} agentId
 */
export function startAgentPolling(agentId) {
  if (!agentId || typeof agentId !== "string" || !agentId.trim()) return;

  const id = agentId.trim();
  let timeoutId = null;

  const poll = async () => {
    try {
      const { status, data } = await cursorRequest({
        method: "GET",
        path: `/v0/agents/${encodeURIComponent(id)}`,
      });
      const agentData = data;
      const agentStatus = agentData?.status ? String(agentData.status).toUpperCase() : null;

      await prisma.figmaConversion.updateMany({
        where: { agentId: id },
        data: { status: agentStatus || undefined },
      });

      if (agentStatus === "FINISHED") {
        const conversion = await prisma.figmaConversion.findFirst({
          where: { agentId: id },
          select: { projectVersionId: true },
        });
        if (conversion?.projectVersionId != null) {
          return;
        }
        await performMergeToLaunchpad(id, agentData);
        return;
      }

      timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
    } catch (err) {
      console.error("[cursor] agent poll error:", err.message);
      timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  void poll();
}
