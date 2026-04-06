import fetch from "node-fetch";
import path from "path";
import fs from "fs-extra";
import { execFileSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import {
  ensureBranchFrom,
  updateRef,
  createTagIdempotent,
  createBranch,
} from "./github.service.js";
import { parseScmRepoPath } from "../utils/scmPath.js";
import { scmGetBranchSha, scmGetRepositoryMetadata } from "./scmFacade.service.js";
import {
  createBitbucketBranchAt,
  createBitbucketTagIdempotent,
  setBitbucketBranchTip,
} from "./bitbucket.service.js";
import config from "../config/index.js";
import { getBackendRoot } from "../utils/instanceRoot.js";
import {
  autoGenerateVersion,
  runBuildSequence,
  reloadNginx,
  findProjectRoot,
} from "./release.service.js";
import { projectRepoSlugFromDisplayName } from "../utils/projectValidation.utils.js";
import ApiError from "../utils/apiError.js";
import { resolveScmCredentialsFromProject } from "./integrationCredential.service.js";

const CURSOR_BASE_URL = "https://api.cursor.com";
const prisma = new PrismaClient();
const POLL_INTERVAL_MS = 5000;
const ENV_GITHUB_USERNAME = process.env.GITHUB_USERNAME;
/**
 * Optional override for source.ref when creating Cursor agents.
 * If unset, ref is taken from GitHub API default_branch for the repo (recommended).
 */
const CURSOR_AGENT_SOURCE_REF_ENV = process.env.CURSOR_AGENT_SOURCE_REF

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
 * @param {{ method: string, path: string, body?: object, silent?: boolean }} options
 * @returns {{ status: number, data: object }} Parsed JSON and status; throws if API key missing or request fails
 */
export async function cursorRequest({ method, path, body, silent = false }) {
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

  const httpMethod = (method || "GET").toUpperCase();
  if (!silent && httpMethod !== "GET") {
    console.log("[cursor] API request", { method: httpMethod, path });
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const postWireBody =
    body !== undefined && body !== null ? JSON.stringify(body) : undefined;
  if (
    !silent &&
    httpMethod === "POST" &&
    normalizedPath === "/v0/agents" &&
    postWireBody !== undefined
  ) {
    console.log("[cursor] POST /v0/agents exact request body (wire):", postWireBody);
  }

  const res = await fetch(url, {
    method: method || "GET",
    headers,
    body: postWireBody,
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

  if (!res.ok) {
    console.warn("[cursor] API non-OK response", {
      path,
      status: res.status,
      body: typeof data === "object" ? JSON.stringify(data).slice(0, 500) : data,
    });
  }

  return { status: res.status, data };
}

/**
 * GET /v0/agents/:id — same behavior as GET /api/cursor/agents/:id (agent payload including status).
 * @param {string} agentId
 * @returns {Promise<{ status: number, data: object }>}
 */
export async function getCursorAgentById(agentId) {
  const id =
    typeof agentId === "string"
      ? agentId.trim()
      : String(agentId ?? "").trim();
  if (!id) {
    return { status: 400, data: { error: "Agent id is required" } };
  }
  return cursorRequest({
    method: "GET",
    path: `/v0/agents/${encodeURIComponent(id)}`,
  });
}

/**
 * POST /v0/agents/:id/followup — same behavior as POST /api/cursor/agents/:id/followup.
 * @param {string} agentId
 * @param {object} prompt — { text, images? } per Cursor API
 * @param {{ silent?: boolean }} [options] — silent:true skips [cursor] API request log (e.g. client-link logs its own body)
 * @returns {Promise<{ status: number, data: object }>}
 */
export async function postCursorAgentFollowup(agentId, prompt, options = {}) {
  const { silent = false } = options;
  const id =
    typeof agentId === "string"
      ? agentId.trim()
      : String(agentId ?? "").trim();
  if (!id) {
    const err = new Error("Agent id is required");
    err.code = "AGENT_ID_REQUIRED";
    throw err;
  }
  const { status, data } = await cursorRequest({
    method: "POST",
    path: `/v0/agents/${encodeURIComponent(id)}/followup`,
    body: { prompt },
    silent,
  });
  if (status >= 200 && status < 300) {
    startAgentPolling(id);
  }
  return { status, data };
}

/**
 * Cursor may report completion as FINISHED, COMPLETED, etc.
 * Use this before merge / client-link confirm UI.
 */
export function isCursorAgentSuccessTerminal(status) {
  if (status == null || status === "") return false;
  const u = String(status).trim().toUpperCase().replace(/\s+/g, "_");
  return (
    u === "FINISHED" ||
    u === "COMPLETED" ||
    u === "COMPLETE" ||
    u === "SUCCEEDED" ||
    u === "SUCCESS" ||
    u === "DONE"
  );
}

/**
 * Resolve https URL for Cursor agents (GitHub or Bitbucket). Uses gitRepoPath when parseable;
 * otherwise derives owner/repo from bitbucketUsername or githubUsername / GITHUB_USERNAME + slug from name.
 * When fallback is used, gitRepoPathToPersist is set so merge/deploy can parse the host.
 * @param {{
 *   gitRepoPath?: string|null,
 *   githubUsername?: string|null,
 *   bitbucketUsername?: string|null,
 *   name?: string|null,
 * }} project
 * @returns {{ repositoryUrl: string|null, gitRepoPathToPersist: string|null }}
 */
export function resolveCursorRepositoryUrl(project) {
  const parsed = parseScmRepoPath(project.gitRepoPath || "");
  if (parsed) {
    if (parsed.provider === "bitbucket") {
      return {
        repositoryUrl: `https://bitbucket.org/${parsed.owner}/${parsed.repo}`,
        gitRepoPathToPersist: null,
      };
    }
    return {
      repositoryUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
      gitRepoPathToPersist: null,
    };
  }
  const bbUser = project.bitbucketUsername?.trim();
  if (bbUser) {
    let slug;
    try {
      slug = projectRepoSlugFromDisplayName(project.name || "");
    } catch {
      return { repositoryUrl: null, gitRepoPathToPersist: null };
    }
    const pathCanonical = `bitbucket.org/${bbUser}/${slug}`;
    return {
      repositoryUrl: `https://bitbucket.org/${bbUser}/${slug}`,
      gitRepoPathToPersist: pathCanonical,
    };
  }
  const username = project.githubUsername?.trim() || ENV_GITHUB_USERNAME?.trim();
  if (!username) {
    return { repositoryUrl: null, gitRepoPathToPersist: null };
  }
  let slug;
  try {
    slug = projectRepoSlugFromDisplayName(project.name || "");
  } catch {
    return { repositoryUrl: null, gitRepoPathToPersist: null };
  }
  const pathCanonical = `github.com/${username}/${slug}`;
  return {
    repositoryUrl: `https://github.com/${username}/${slug}`,
    gitRepoPathToPersist: pathCanonical,
  };
}

/**
 * Create a Cursor cloud agent, persist FigmaConversion, start polling.
 * If source is omitted, resolves repository from the project (ZIP/manual path).
 * @param {{
 *   projectId: number,
 *   releaseId: number,
 *   attemptedById: number,
 *   prompt: object,
 *   nodeCount?: number|null,
 *   source?: { repository?: string, prUrl?: string, ref?: string }|null,
 *   model?: unknown,
 *   target?: unknown,
 *   webhook?: unknown,
 *   deferLaunchpadMerge?: boolean,
 *   skipLaunchpadAutomation?: boolean — if true, poller does not run launchpad merge (developer-repo lock agent)
 *   omitTargetFromBody?: boolean — if true, do not send `target` in POST /v0/agents (client-link chat)
 *   silentCursorApiLog?: boolean — if true, skip [cursor] API request line for POST /v0/agents (client-link logs its own input)
 * }} params
 * @returns {Promise<{ ok: true, status: number, data: object } | { ok: false, status: number, data: object }>}
 */
export async function createAgentForProjectRelease({
  projectId,
  releaseId,
  attemptedById,
  prompt,
  nodeCount = null,
  source = null,
  model,
  target,
  webhook,
  deferLaunchpadMerge = false,
  skipLaunchpadAutomation = false,
  omitTargetFromBody = false,
  silentCursorApiLog = false,
}) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      gitRepoPath: true,
      githubUsername: true,
      githubToken: true,
      githubConnectionId: true,
      bitbucketUsername: true,
      bitbucketToken: true,
      bitbucketConnectionId: true,
      createdById: true,
    },
  });
  if (!project) {
    const err = new Error("Project not found");
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }
  let scmAccess = null;
  try {
    scmAccess = await resolveScmCredentialsFromProject(project);
  } catch {
    scmAccess = null;
  }
  const ghAccessToken = scmAccess?.token?.trim() || "";
  if (!ghAccessToken) {
    const err = new Error(
      "Repository host is not configured for this project; connect GitHub or Bitbucket (OAuth) or set legacy tokens before using Cursor.",
    );
    err.code = "SCM_NOT_CONFIGURED";
    throw err;
  }

  let finalSource = source;
  if (
    !finalSource ||
    (typeof finalSource.repository !== "string" && typeof finalSource.prUrl !== "string")
  ) {
    const resolved = resolveCursorRepositoryUrl(project);
    if (!resolved.repositoryUrl) {
      const err = new Error(
        "Could not resolve repository for this project. Set gitRepoPath or project GitHub/Bitbucket username.",
      );
      err.code = "REPO_UNRESOLVED";
      throw err;
    }
    finalSource = {
      repository: resolved.repositoryUrl,
    };
    if (resolved.gitRepoPathToPersist) {
      await prisma.project.update({
        where: { id: projectId },
        data: { gitRepoPath: resolved.gitRepoPathToPersist },
      });
    }
  }

  if (
    finalSource &&
    typeof finalSource.repository === "string" &&
    typeof finalSource.prUrl !== "string"
  ) {
    const parsedRepo = parseScmRepoPath(finalSource.repository);
    if (!parsedRepo) {
      const err = new Error(
        "Invalid source.repository; expected a github.com or bitbucket.org owner/repo URL.",
      );
      err.code = "REPO_UNRESOLVED";
      throw err;
    }
    if (scmAccess && scmAccess.provider !== parsedRepo.provider) {
      const err = new Error(
        `source.repository is ${parsedRepo.provider} but project credentials are for ${scmAccess.provider}.`,
      );
      err.code = "REPO_UNRESOLVED";
      throw err;
    }
    const meta = await scmGetRepositoryMetadata(
      parsedRepo.provider,
      parsedRepo.owner,
      parsedRepo.repo,
      ghAccessToken,
    );
    if (!meta.ok) {
      const host = parsedRepo.provider === "bitbucket" ? "Bitbucket" : "GitHub";
      const status = meta.status != null ? String(meta.status) : "";
      const hint =
        meta.status === 404
          ? `Repository ${parsedRepo.owner}/${parsedRepo.repo} was not found, or the token cannot see it. Check gitRepoPath / username match the repo you push to.`
          : `${host}${status ? ` (${status})` : ""}: ${meta.message || "metadata request failed"}. Ensure the token has repository scope. Private repos must be reachable by Cursor Cloud.`;
      const err = new Error(hint);
      err.code = "REPO_INACCESSIBLE";
      throw err;
    }
    const clientRef =
      finalSource.ref != null && String(finalSource.ref).trim() !== ""
        ? String(finalSource.ref).trim()
        : null;
    // Explicit ref from caller wins over CURSOR_AGENT_SOURCE_REF so client-link can force `launchpad`
    // after prior merges (otherwise env e.g. main overrides and agents miss merged work).
    const envRef =
      typeof CURSOR_AGENT_SOURCE_REF_ENV === "string" &&
        CURSOR_AGENT_SOURCE_REF_ENV.trim()
        ? CURSOR_AGENT_SOURCE_REF_ENV.trim()
        : null;
    const refBranch = clientRef || envRef || meta.defaultBranch;
    finalSource = {
      ...finalSource,
      ref: refBranch,
    };
  }

  const effectiveTarget =
    omitTargetFromBody
      ? null
      : target !== undefined &&
        target !== null &&
        typeof target === "object" &&
        !Array.isArray(target) &&
        Object.keys(target).length > 0
        ? target
        : { autoBranch: true };

  const agentCreateBody = {
    prompt,
    model,
    source: finalSource,
    webhook,
  };
  if (!omitTargetFromBody && effectiveTarget != null) {
    agentCreateBody.target = effectiveTarget;
  }
  if (!silentCursorApiLog) {
    console.log(
      "[cursor] POST /v0/agents exact body (object; undefined shows in console)",
      agentCreateBody,
    );
    console.log(
      "[cursor] POST /v0/agents exact body (wire JSON.stringify, same as request)",
      JSON.stringify(agentCreateBody),
    );
  }

  const { status, data } = await cursorRequest({
    method: "POST",
    path: "/v0/agents",
    body: agentCreateBody,
    silent: silentCursorApiLog,
  });

  if (!data || !data.id) {
    return { ok: false, status, data };
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
        attemptedById,
        attemptNumber,
        nodeCount: nodeCount != null && !Number.isNaN(nodeCount) ? nodeCount : null,
        status: data.status || "CREATING",
        deferLaunchpadMerge: Boolean(deferLaunchpadMerge),
        awaitingLaunchpadConfirmation: false,
        skipLaunchpadAutomation: Boolean(skipLaunchpadAutomation),
      },
    });
  } catch (dbErr) {
    console.error("[cursor] FigmaConversion insert failed:", dbErr);
  }
  startAgentPolling(data.id);
  return { ok: true, status, data };
}

/**
 * Force `launchpad` to headSha, tag, build, deploy; update FigmaConversion.
 * @param {object} conversion — row with id, projectId, releaseId, attemptedById
 * @param {string} headSha
 * @param {string} headBranchName — agent branch name (for DB)
 * @param {{ skipShaDedupe?: boolean, prUrl?: string|null }} options
 */
export async function executeLaunchpadHeadDeploy(conversion, headSha, headBranchName, options = {}) {
  const { skipShaDedupe = false, prUrl = null } = options;

  const project = await prisma.project.findUnique({
    where: { id: conversion.projectId },
    select: {
      id: true,
      githubToken: true,
      gitRepoPath: true,
      projectPath: true,
      port: true,
      githubConnectionId: true,
      bitbucketConnectionId: true,
      bitbucketToken: true,
      bitbucketUsername: true,
      createdById: true,
      githubUsername: true,
    },
  });
  let scm;
  try {
    scm = await resolveScmCredentialsFromProject(project);
  } catch {
    scm = null;
  }
  const token = scm?.token?.trim() || "";
  if (!token || !project?.gitRepoPath?.trim()) {
    throw new Error("Project has no repository token or gitRepoPath configured");
  }

  const parsed = parseScmRepoPath(project.gitRepoPath);
  if (!parsed) throw new Error("Invalid Git repo path format");
  if (scm.provider !== parsed.provider) {
    throw new Error(
      `gitRepoPath is ${parsed.provider} but project credentials are for ${scm.provider}`,
    );
  }
  const { owner, repo, provider } = parsed;

  if (!skipShaDedupe) {
    const lpNow = await scmGetBranchSha(provider, owner, repo, "launchpad", token);
    if (
      lpNow?.sha &&
      lpNow.sha.toLowerCase() === headSha.toLowerCase()
    ) {
      console.log("[cursor] executeLaunchpadHeadDeploy: skip (launchpad already at SHA)", {
        conversionId: conversion.id,
        shaPrefix: headSha.slice(0, 7),
      });
      return { merged: true, skipped: true, sha: headSha };
    }
  }

  console.log("[cursor] executeLaunchpadHeadDeploy: updating launchpad", {
    projectId: conversion.projectId,
    releaseId: conversion.releaseId,
    shaPrefix: headSha.slice(0, 7),
    provider,
  });

  const baseBranch = "launchpad";
  if (provider === "github") {
    const ensureResult = await ensureBranchFrom(owner, repo, baseBranch, "main", token);
    if (!ensureResult.ok) {
      throw new Error(ensureResult.error || "Could not ensure launchpad branch");
    }

    let updateResult = await updateRef(owner, repo, "heads/launchpad", headSha, true, token);
    if (!updateResult.ok && updateResult.status === 404) {
      const createResult = await createBranch(owner, repo, baseBranch, headSha, token);
      if (!createResult.ok) {
        throw new Error(createResult.message || "Could not create launchpad branch at SHA");
      }
    } else if (!updateResult.ok) {
      throw new Error(updateResult.message || "Failed to force-update launchpad branch");
    }
  } else {
    const meta = await scmGetRepositoryMetadata(provider, owner, repo, token);
    const defaultBranch = meta.ok ? meta.defaultBranch || "main" : "main";
    const mainTip = await scmGetBranchSha(provider, owner, repo, defaultBranch, token);
    if (!mainTip?.sha) {
      throw new Error(
        `Default branch "${defaultBranch}" not found; cannot ensure "${baseBranch}" on Bitbucket.`,
      );
    }
    const launchpadTip = await scmGetBranchSha(provider, owner, repo, baseBranch, token);
    if (!launchpadTip?.sha) {
      const created = await createBitbucketBranchAt(owner, repo, baseBranch, mainTip.sha, token);
      if (!created.ok) {
        throw new Error(created.message || "Could not create launchpad branch on Bitbucket");
      }
    }
    const moved = await setBitbucketBranchTip(owner, repo, baseBranch, headSha, token);
    if (!moved.ok) {
      throw new Error(moved.message || "Failed to move launchpad branch on Bitbucket");
    }
  }

  const releaseId = conversion.releaseId;
  const versionNumber = await autoGenerateVersion(releaseId);
  const tagName = `rel-${releaseId}-${versionNumber}`;

  const tagResult =
    provider === "github"
      ? await createTagIdempotent(owner, repo, tagName, headSha, token)
      : await createBitbucketTagIdempotent(owner, repo, tagName, headSha, token);
  if (!tagResult.ok) {
    throw new Error(tagResult.message || "Failed to create tag");
  }

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
  let deployedToPort = false;
  const scmTagUrl =
    provider === "github"
      ? `https://github.com/${owner}/${repo}/releases/tag/${tagName}`
      : `https://bitbucket.org/${owner}/${repo}/commits/tag/${encodeURIComponent(tagName)}`;

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
    const liveSiteUrl = `${config.getBuildUrlProtocol()}://${config.getBuildUrlHost()}:${project.port}`;

    await fs.ensureDir(tempRoot);
    const cloneUrl =
      provider === "github"
        ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
        : `https://x-token-auth:${token}@bitbucket.org/${owner}/${repo}.git`;
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
      await fs.remove(tempRoot).catch(() => { });
    }
    if (deployAttemptFailed) {
      newVersion = await persistFallbackVersion(liveSiteUrl);
    }
  } else {
    newVersion = await persistFallbackVersion(scmTagUrl);
  }

  await prisma.figmaConversion.update({
    where: { id: conversion.id },
    data: {
      targetBranchName: headBranchName,
      projectVersionId: newVersion.id,
      status: "FINISHED",
      awaitingLaunchpadConfirmation: false,
    },
  });

  console.log("[cursor] executeLaunchpadHeadDeploy: done", {
    conversionId: conversion.id,
    tag: tagName,
    deployedToPort,
  });

  return {
    merged: true,
    skipped: false,
    sha: headSha,
    version: versionNumber,
    tag: tagName,
    prUrl,
    deployed: deployedToPort,
  };
}

/**
 * Merge agent branch to launchpad and deploy (after agent FINISHED).
 * Skips work if agent branch SHA matches last merged SHA.
 */
export async function performMergeToLaunchpad(agentId, agentData, options = {}) {
  const conversion = await prisma.figmaConversion.findFirst({
    where: { agentId },
    select: {
      id: true,
      projectId: true,
      releaseId: true,
      attemptedById: true,
    },
  });
  if (!conversion) {
    throw new Error("Agent not found or not linked to a project");
  }

  const project = await prisma.project.findUnique({
    where: { id: conversion.projectId },
    select: {
      id: true,
      githubToken: true,
      gitRepoPath: true,
      githubConnectionId: true,
      bitbucketConnectionId: true,
      bitbucketToken: true,
      bitbucketUsername: true,
      createdById: true,
      githubUsername: true,
    },
  });
  let scm;
  try {
    scm = await resolveScmCredentialsFromProject(project);
  } catch {
    scm = null;
  }
  const token = scm?.token?.trim() || "";
  if (!token || !project?.gitRepoPath?.trim()) {
    throw new Error("Project has no repository token or Git repo path configured");
  }

  const parsed = parseScmRepoPath(project.gitRepoPath);
  if (!parsed) throw new Error("Invalid Git repo path format");
  if (scm.provider !== parsed.provider) {
    throw new Error(
      `gitRepoPath is ${parsed.provider} but project credentials are for ${scm.provider}`,
    );
  }
  const { owner, repo, provider } = parsed;

  const headBranch = agentData.target?.branchName;
  if (!headBranch || typeof headBranch !== "string") {
    throw new Error("Agent has no target branch name");
  }

  const headShaResult = await scmGetBranchSha(provider, owner, repo, headBranch, token);
  if (!headShaResult) {
    throw new Error("Could not get agent branch SHA; branch may not exist");
  }
  const headSha = headShaResult.sha;

  const prUrl = agentData.target?.prUrl || agentData.source?.prUrl;

  return executeLaunchpadHeadDeploy(conversion, headSha, headBranch, {
    skipShaDedupe: options.skipShaDedupe ?? false,
    prUrl,
  });
}

/**
 * Merge/deploy a specific commit SHA to launchpad for an existing conversion.
 * Used by client-link confirm flow when user confirms the currently applied preview commit.
 * @param {string} agentId
 * @param {string} headSha
 * @param {string} headBranchName
 * @param {{ skipShaDedupe?: boolean, prUrl?: string|null }} options
 */
export async function performMergeToLaunchpadAtCommit(
  agentId,
  headSha,
  headBranchName,
  options = {},
) {
  const id =
    typeof agentId === "string"
      ? agentId.trim()
      : String(agentId ?? "").trim();
  if (!id) throw new Error("Agent id is required");
  const sha = typeof headSha === "string" ? headSha.trim() : "";
  if (!sha) throw new Error("Commit SHA is required");
  const branch = typeof headBranchName === "string" ? headBranchName.trim() : "";
  if (!branch) throw new Error("Target branch name is required");

  const conversion = await prisma.figmaConversion.findFirst({
    where: { agentId: id },
    select: {
      id: true,
      projectId: true,
      releaseId: true,
      attemptedById: true,
    },
  });
  if (!conversion) {
    throw new Error("Agent not found or not linked to a project");
  }

  return executeLaunchpadHeadDeploy(conversion, sha, branch, {
    skipShaDedupe: options.skipShaDedupe ?? false,
    prUrl: options.prUrl ?? null,
  });
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
      const { status, data: agentData } = await getCursorAgentById(id);
      if (status !== 200 || !agentData) {
        timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }
      const agentStatus = agentData?.status
        ? String(agentData.status).toUpperCase()
        : null;

      const branchNameFromAgent =
        typeof agentData?.target?.branchName === "string"
          ? agentData.target.branchName.trim()
          : "";

      const convRow = await prisma.figmaConversion.findFirst({
        where: { agentId: id },
        select: {
          id: true,
          projectId: true,
          releaseId: true,
          deferLaunchpadMerge: true,
          skipLaunchpadAutomation: true,
        },
      });

      const pollRowUpdate = { status: agentStatus || undefined };
      if (branchNameFromAgent) {
        pollRowUpdate.targetBranchName = branchNameFromAgent;
      }
      await prisma.figmaConversion.updateMany({
        where: { agentId: id },
        data: pollRowUpdate,
      });

      if (isCursorAgentSuccessTerminal(agentStatus)) {
        if (convRow?.skipLaunchpadAutomation) {
          console.log(
            "[cursor] poll: agent complete — skipLaunchpadAutomation (no platform merge)",
            { agentId: id },
          );
          return;
        }
        if (convRow?.deferLaunchpadMerge) {
          try {
            await prisma.$transaction([
              prisma.figmaConversion.updateMany({
                where: {
                  releaseId: convRow.releaseId,
                  projectId: convRow.projectId,
                  id: { not: convRow.id },
                },
                data: { awaitingLaunchpadConfirmation: false },
              }),
              prisma.figmaConversion.update({
                where: { id: convRow.id },
                data: {
                  awaitingLaunchpadConfirmation: true,
                  ...(branchNameFromAgent
                    ? { targetBranchName: branchNameFromAgent }
                    : {}),
                },
              }),
            ]);
            console.log("[cursor] poll: agent complete — auto-merge to launchpad (client-link)", {
              agentId: id,
            });
          } catch (deferErr) {
            console.error("[cursor] poll: defer merge flags failed", {
              agentId: id,
              error: deferErr?.message || deferErr,
            });
          }
          try {
            const { clientLinkAutoMergeFromAgentPoll } = await import("./chat.service.js");
            await clientLinkAutoMergeFromAgentPoll(id);
          } catch (autoErr) {
            console.error("[cursor] poll: client-link auto-merge failed", {
              agentId: id,
              error: autoErr?.message || autoErr,
            });
          }
          return;
        }

        try {
          const result = await performMergeToLaunchpad(id, agentData);
          if (result?.skipped) {
            console.log("[cursor] poll: agent complete but merge skipped (duplicate SHA)", {
              agentId: id,
            });
          } else {
            console.log("[cursor] poll: merged after agent completed", { agentId: id });
          }
        } catch (mergeErr) {
          console.error("[cursor] poll: merge after agent completed failed", {
            agentId: id,
            error: mergeErr?.message || mergeErr,
          });
        }
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
