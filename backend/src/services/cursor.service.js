import fetch from "node-fetch";
import path from "path";
import fs from "fs-extra";
import { execFileSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import {
  parseGitRepoPath,
  ensureBranchFrom,
  getBranchSha,
  updateRef,
  createTagIdempotent,
  createBranch,
} from "./github.service.js";
import config from "../config/index.js";
import { getBackendRoot } from "../utils/instanceRoot.js";
import {
  runBuildSequence,
  reloadNginx,
  findProjectRoot,
} from "./release.service.js";

const CURSOR_BASE_URL = "https://api.cursor.com";
const prisma = new PrismaClient();
const POLL_INTERVAL_MS = 5000;

/**
 * Run git with args in cwd; argv only (no shell) so token in URL is not interpreted.
 */
function gitExec(argv, cwd) {
  execFileSync("git", argv, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 300000,
  });
}

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
 * Perform merge-to-launchpad: force-update launchpad branch, create tag, checkout tag,
 * build, copy dist/build into projects/{projectPath}, reload nginx, ProjectVersion with live buildUrl.
 * Idempotent: if FigmaConversion.projectVersionId is already set, returns success without re-running.
 * If project has no projectPath/port, falls back to GitHub-only ProjectVersion (no deploy).
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
    select: {
      githubToken: true,
      gitRepoPath: true,
      projectPath: true,
      port: true,
    },
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

  const tagResult = await createTagIdempotent(owner, repo, tagName, headSha, token);
  if (!tagResult.ok) {
    throw new Error(tagResult.message || "Failed to create tag");
  }

  /** Same tag may exist on GitHub from a prior failed run; reuse DB row if present. */
  const existingVersion = await prisma.projectVersion.findFirst({
    where: {
      projectId: conversion.projectId,
      gitTag: tagName,
    },
    select: { id: true },
  });

  const canDeploy =
    project.projectPath?.trim() &&
    project.port != null &&
    Number(project.port) > 0;

  let newVersion;
  /** True only when clone + build + copy + DB succeeded (single attempt; no retry loop). */
  let deployedToPort = false;
  const githubTagUrl = `https://github.com/${owner}/${repo}/releases/tag/${tagName}`;

  /**
   * Persist version when deploy did not run or failed: `buildUrl` is GitHub tag URL if no port,
   * otherwise same domain:port as a successful build.
   */
  const persistFallbackVersion = async (buildUrl) => {
    if (existingVersion) {
      return prisma.projectVersion.update({
        where: { id: existingVersion.id },
        data: {
          version: versionNumber,
          zipFilePath: tagName,
          buildUrl,
          releaseId: conversion.releaseId,
          uploadedBy: conversion.attemptedById,
        },
      });
    }
    return prisma.projectVersion.create({
      data: {
        projectId: conversion.projectId,
        releaseId: conversion.releaseId,
        version: versionNumber,
        gitTag: tagName,
        zipFilePath: tagName,
        buildUrl,
        isActive: false,
        uploadedBy: conversion.attemptedById,
      },
    });
  };

  const backendRoot = getBackendRoot();
  const tempRoot = path.join(
    backendRoot,
    "_tmp_builds",
    `cursor_merge_${conversion.projectId}_${Date.now()}`,
  );

  if (canDeploy) {
    /** Same as successful path: protocol + domain + port for this project’s preview URL. */
    const liveSiteUrl = `${config.getBuildUrlProtocol()}://${config.getBuildUrlHost()}:${project.port}`;

    await fs.ensureDir(tempRoot);
    const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    let deployAttemptFailed = false;
    try {
      try {
        gitExec(["clone", cloneUrl, "."], tempRoot);

        try {
          gitExec(
            ["fetch", "origin", `refs/tags/${tagName}:refs/tags/${tagName}`],
            tempRoot,
          );
        } catch {
          gitExec(["fetch", "origin", "tag", tagName], tempRoot);
        }
        gitExec(["checkout", tagName], tempRoot);

        const sourceRoot = findProjectRoot(tempRoot);
        const buildOutputPath = await runBuildSequence(sourceRoot);

        const projectRoot = path.join(backendRoot, project.projectPath);
        await fs.ensureDir(path.dirname(projectRoot));
        await fs.emptyDir(projectRoot);
        await fs.copy(buildOutputPath, projectRoot);

        await reloadNginx();

        const buildUrl = liveSiteUrl;

        newVersion = await prisma.$transaction(async (tx) => {
          await tx.projectVersion.updateMany({
            where: { projectId: conversion.projectId },
            data: { isActive: false },
          });
          if (existingVersion) {
            return tx.projectVersion.update({
              where: { id: existingVersion.id },
              data: {
                version: versionNumber,
                zipFilePath: tagName,
                buildUrl,
                isActive: true,
                releaseId: conversion.releaseId,
                uploadedBy: conversion.attemptedById,
              },
            });
          }
          return tx.projectVersion.create({
            data: {
              projectId: conversion.projectId,
              releaseId: conversion.releaseId,
              version: versionNumber,
              gitTag: tagName,
              zipFilePath: tagName,
              buildUrl,
              isActive: true,
              uploadedBy: conversion.attemptedById,
            },
          });
        });
        deployedToPort = true;
      } catch (err) {
        deployAttemptFailed = true;
        console.warn(
          "[cursor] merge deploy/build failed (one attempt); persisting fallback:",
          err?.message || err,
        );
      }
    } finally {
      await fs.remove(tempRoot).catch(() => {});
    }
    if (deployAttemptFailed) {
      newVersion = await persistFallbackVersion(liveSiteUrl);
    }
  } else {
    newVersion = await persistFallbackVersion(githubTagUrl);
  }

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
    deployed: deployedToPort,
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
      const { data } = await cursorRequest({
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
      console.error("[cursor] agent poll error:", err?.message || err);
      timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  void poll();
}
