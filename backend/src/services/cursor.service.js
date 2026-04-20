import fetch from "node-fetch";
import { inspect } from "util";
import path from "path";
import fs from "fs-extra";
import { execFileSync } from "child_process";
import { prisma } from "../lib/prisma.js";
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
import { waitForAgentBranchTipSha } from "../utils/agentBranchTipWait.js";
import { API_BASE_URLS } from "../constants/contstants.js";
import { ensureFreshFigmaConnection } from "./oauthConnection.service.js";
import { LAUNCHPAD_FRONTEND_SUBMODULE_PATH } from "./developerRepoSubmodule.service.js";
import { buildLaunchpadFrontendAlignmentBlock } from "./cursorPrompts.js";
import { ensureFreshFigmaConnection } from "./oauthConnection.service.js";
import { LAUNCHPAD_FRONTEND_SUBMODULE_PATH } from "./developerRepoSubmodule.service.js";

/** Cursor Cloud / cursor-cloud-agent base (e.g. `http://cursor-cloud-agent:3100` in Docker). */
const CURSOR_BASE_URL = String(process.env.CURSOR_BASE_URL ?? "").trim();

/**
 * @param {number} projectId
 * @param {boolean} fromScratch
 * @param {string | null} status — CREATING, FAILED, or null to clear
 */
async function setProjectScratchVersionStatus(projectId, fromScratch, status) {
  if (!fromScratch) return;
  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { scratchVersionStatus: status },
    });
  } catch (err) {
    console.error("[cursor] scratchVersionStatus update failed", {
      projectId,
      error: err?.message || err,
    });
  }
}

/** After pipeline errors: mark FAILED only if we had set CREATING (avoids bogus FAILED on pre-pipeline throws). */
export async function markScratchVersionFailedIfCreating(projectId) {
  try {
    const row = await prisma.project.findUnique({
      where: { id: projectId },
      select: { fromScratch: true, scratchVersionStatus: true },
    });
    if (
      !row?.fromScratch ||
      row.scratchVersionStatus !== "CREATING"
    ) {
      return;
    }
    await setProjectScratchVersionStatus(projectId, true, "FAILED");
  } catch (err) {
    console.error("[cursor] markScratchVersionFailedIfCreating failed", {
      projectId,
      error: err?.message || err,
    });
  }
}
const POLL_INTERVAL_MS = 5000;
const ENV_GITHUB_USERNAME = process.env.GITHUB_USERNAME;

/** Matches cursor-cloud-agent JSON when no PAT is stored for `?email=`. */
const CURSOR_CLOUD_GITHUB_PAT_ERROR_CODE = "GITHUB_PAT_NOT_CONFIGURED";

/**
 * @param {number | null | undefined} projectId
 * @returns {Promise<Record<string, string> | undefined>}
 */
async function getCreatorEmailQueryForProject(projectId) {
  const pid = projectId != null ? Number(projectId) : NaN;
  if (!Number.isInteger(pid) || pid < 1) return undefined;
  const project = await prisma.project.findUnique({
    where: { id: pid },
    select: { createdById: true },
  });
  if (!project) return undefined;
  const user = await prisma.user.findUnique({
    where: { id: project.createdById },
    select: { email: true },
  });
  const email = user?.email?.trim();
  if (!email) return undefined;
  return { email };
}

/**
 * @param {number} status
 * @param {object} data
 */
function responseIndicatesGithubPatNotConfigured(status, data) {
  return (
    status === 400 &&
    data &&
    typeof data === "object" &&
    data.code === CURSOR_CLOUD_GITHUB_PAT_ERROR_CODE
  );
}

/**
 * POST GitHub token to cursor-cloud-agent for the project creator's email (Basic auth = CURSOR_API_KEY).
 * @param {import("@prisma/client").Project & { createdById: number }} project
 */
async function registerGithubPatWithCursorCloudAgent(project) {
  const scm = await resolveScmCredentialsFromProject(project);
  if (scm.provider !== "github") {
    throw new Error(
      "GitHub connection required to register PAT with Cursor agent service (project uses non-GitHub SCM).",
    );
  }
  const token = scm.token?.trim();
  if (!token) {
    throw new Error("GitHub token is empty; reconnect GitHub under Integrations.");
  }
  const user = await prisma.user.findUnique({
    where: { id: project.createdById },
    select: { email: true },
  });
  const email = user?.email?.trim();
  if (!email) {
    throw new Error("Project creator email missing");
  }
  const { status, data } = await cursorRequest({
    method: "POST",
    path: "/v0/credentials/github",
    query: { email },
    body: { githubToken: token },
  });
  if (status < 200 || status >= 300) {
    const msg =
      data && typeof data === "object" && data.error
        ? String(data.error)
        : "Failed to register GitHub PAT with Cursor agent service";
    const err = new Error(msg);
    err.code = "CURSOR_PAT_REGISTER_FAILED";
    throw err;
  }
}

/**
 * On GITHUB_PAT_NOT_CONFIGURED, push OAuth token from the project then retry once.
 * @param {{ method: string, path: string, body?: object, projectId?: number|null }} options
 */
async function cursorRequestWithProjectAndPatRetry(options) {
  const { method, path, body, projectId } = options;
  const query = await getCreatorEmailQueryForProject(projectId);
  let result = await cursorRequest({ method, path, body, query });
  if (!responseIndicatesGithubPatNotConfigured(result.status, result.data) || projectId == null) {
    return result;
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: PROJECT_SELECT_FOR_SCM_PUSH,
  });
  if (!project) {
    return result;
  }
  try {
    await registerGithubPatWithCursorCloudAgent(project);
  } catch (e) {
    console.error("[cursor] registerGithubPatWithCursorCloudAgent failed:", e?.message || e);
    return result;
  }
  result = await cursorRequest({ method, path, body, query });
  return result;
}
/**
 * Optional override for source.ref when creating Cursor agents.
 * If unset, ref defaults to `main` (caller `source.ref` still wins).
 */
const CURSOR_AGENT_SOURCE_REF_ENV = process.env.CURSOR_AGENT_SOURCE_REF;

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

/** Log line helper: same URL shape as wire calls but without sensitive query values. */
function cursorRequestUrlForLogs(urlStr) {
  try {
    const u = new URL(urlStr);
    for (const key of u.searchParams.keys()) {
      if (/token|secret|password|email|github/i.test(key)) {
        u.searchParams.set(key, "(redacted)");
      }
    }
    return u.toString();
  } catch {
    return "(invalid-url)";
  }
}

/**
 * Call Cursor Cloud Agents API with Basic auth (API key as username, empty password).
 * @param {{ method: string, path: string, body?: object, query?: Record<string, string> }} options
 * @returns {{ status: number, data: object }} Parsed JSON and status; throws if API key missing or request fails
 */
export async function cursorRequest({ method, path, body, query }) {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error("Cursor API key not configured");
    err.code = "CURSOR_KEY_MISSING";
    throw err;
  }

  if (!CURSOR_BASE_URL) {
    const err = new Error("CURSOR_BASE_URL is not configured");
    err.code = "CURSOR_BASE_URL_MISSING";
    throw err;
  }

  const baseRaw = CURSOR_BASE_URL;
  const base = baseRaw.replace(/\/$/, "");
  const relPath = path.startsWith("/") ? path : `/${path}`;
  const urlObj = new URL(relPath, `${base}/`);
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && String(v).trim() !== "") {
        urlObj.searchParams.set(k, String(v));
      }
    }
  }
  const url = urlObj.toString();
  const basicAuth = Buffer.from(`${apiKey}:`).toString("base64");
  const headers = {
    Authorization: `Basic ${basicAuth}`,
  };
  if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
  }

  const postWireBody =
    body !== undefined && body !== null ? JSON.stringify(body) : undefined;

  const m = method || "GET";
  console.warn("[cursor] outgoing request", {
    method: m,
    path: relPath,
    url: cursorRequestUrlForLogs(url),
  });

  let res;
  try {
    res = await fetch(url, {
      method: m,
      headers,
      body: postWireBody,
    });
  } catch (e) {
    const cause = e?.cause;
    console.warn(
      "[cursor] HTTP request failed (network / TLS / DNS before response)",
      inspect(
        {
          method: m,
          path: relPath,
          url: cursorRequestUrlForLogs(url),
          message: e?.message,
          name: e?.name,
          code: e?.code,
          errno: e?.errno,
          syscall: e?.syscall,
          address: e?.address,
          port: e?.port,
          cause:
            cause && typeof cause === "object"
              ? {
                  message: cause.message,
                  code: cause.code,
                  errno: cause.errno,
                  syscall: cause.syscall,
                  address: cause.address,
                  port: cause.port,
                }
              : cause,
        },
        { depth: 5, breakLength: 120 },
      ),
    );
    throw e;
  }

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

  console.log(
    "[cursor] API response",
    inspect(
      {
        method: method || "GET",
        path,
        url,
        httpStatus: res.status,
        contentType,
        data,
      },
      {
        depth: null,
        maxArrayLength: null,
        maxStringLength: Infinity,
        breakLength: 120,
      },
    ),
  );

  return { status: res.status, data };
}

/**
 * GET /v0/agents/:id — same behavior as GET /api/cursor/agents/:id (agent payload including status).
 * @param {string} agentId
 * @param {number} [projectId] — when set, adds `?email=` (project creator); otherwise inferred from
 *   FigmaConversion, or from Release.backendAgentId (e.g. post-lock backend plan agent).
 * @returns {Promise<{ status: number, data: object }>}
 */
export async function getCursorAgentById(agentId, projectId) {
  const id =
    typeof agentId === "string"
      ? agentId.trim()
      : String(agentId ?? "").trim();
  if (!id) {
    return { status: 400, data: { error: "Agent id is required" } };
  }
  let pid =
    projectId != null && Number.isInteger(Number(projectId)) ? Number(projectId) : null;
  if (pid == null) {
    const conv = await prisma.figmaConversion.findFirst({
      where: { agentId: id },
      select: { projectId: true },
    });
    pid = conv?.projectId ?? null;
  }
  if (pid == null) {
    const rel = await prisma.release.findFirst({
      where: { backendAgentId: id },
      select: { projectId: true },
    });
    pid = rel?.projectId ?? null;
  }
  const query = await getCreatorEmailQueryForProject(pid);
  return cursorRequest({
    method: "GET",
    path: `/v0/agents/${encodeURIComponent(id)}`,
    query,
  });
}

/**
 * POST /v0/agents/:id/followup — same behavior as POST /api/cursor/agents/:id/followup.
 * @param {string} agentId
 * @param {{ text: string, images?: Array<{ data: string, dimension: { width: number, height: number } }> }} prompt
 *        Same `prompt` shape as POST /v0/agents (Cursor API): optional `images` with base64 `data` + `dimension`).
 * @returns {Promise<{ status: number, data: object }>}
 */
export async function postCursorAgentFollowup(agentId, prompt) {
  const id =
    typeof agentId === "string"
      ? agentId.trim()
      : String(agentId ?? "").trim();
  if (!id) {
    const err = new Error("Agent id is required");
    err.code = "AGENT_ID_REQUIRED";
    throw err;
  }
  const conv = await prisma.figmaConversion.findFirst({
    where: { agentId: id },
    select: { projectId: true },
  });
  let projectId = conv?.projectId ?? null;
  if (projectId == null) {
    const rel = await prisma.release.findFirst({
      where: { backendAgentId: id },
      select: { projectId: true },
    });
    projectId = rel?.projectId ?? null;
  }

  const { status, data } = await cursorRequestWithProjectAndPatRetry({
    method: "POST",
    path: `/v0/agents/${encodeURIComponent(id)}/followup`,
    body: { prompt },
    projectId,
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

/** Terminal failure states from Cursor Cloud agent polling. */
export function isCursorAgentFailureTerminal(status) {
  if (status == null || status === "") return false;
  const u = String(status).trim().toUpperCase().replace(/\s+/g, "_");
  if (
    u === "FAILED" ||
    u === "ERROR" ||
    u === "CANCELLED" ||
    u === "CANCELED" ||
    u === "STOPPED"
  )
    return true;
  return u.includes("FAIL");
}

/**
 * @param {{ submodulePath?: string }} [opts] — relative path to platform submodule in dev repo (default launchpad-frontend)
 */
function buildBackendPlanPrompt(projectVersionId, releaseId, opts = {}) {
  const raw = (opts.submodulePath || LAUNCHPAD_FRONTEND_SUBMODULE_PATH).trim().replace(/^\/+|\/+$/g, "");
  const sub = raw || LAUNCHPAD_FRONTEND_SUBMODULE_PATH;
  const subSlash = sub.endsWith("/") ? sub : `${sub}/`;
  return (
    `You are working in the developer integration repository, which includes the Launchpad platform UI as a git submodule at ${subSlash}.\n\n` +
    `Use ${subSlash} as the reference for Launchpad patterns and behavior. Compare ${subSlash} with Frontend/ in this repository (for example using git diff or an equivalent approach) and apply the necessary changes under the Frontend/ folder so it aligns with or correctly reflects patterns from the submodule.\n\n` +
    `Create a Plan named backend-v${projectVersionId}-release${releaseId}.md in the backend/plan (or equivalent) folder at the repository root that documents how to implement or connect a backend that supports this Frontend: APIs, data contracts, auth or session notes if relevant, deployment considerations, and concrete integration steps.`
  );
}

/**
 * Force remote `launchpad` to point at headSha (GitHub or Bitbucket).
 * @param {{ provider: 'github'|'bitbucket', owner: string, repo: string, headSha: string, token: string }} p
 */
export async function forceUpdateLaunchpadBranch(p) {
  const { provider, owner, repo, headSha, token } = p;
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
}

/**
 * After release lock: run Cursor agent in the GitHub developer integration repo (post-submodule push).
 * Fire-and-forget from release.service; updates Release.backendAgentId / backendAgentStatus.
 * @param {{ releaseId: number, projectId: number, projectVersionId: number, attemptedById: number }} params
 */
export async function startReleaseBackendPlanAgent({
  releaseId,
  projectId,
  projectVersionId,
  attemptedById: _attemptedById,
}) {
  const markFailed = async () => {
    try {
      await prisma.release.update({
        where: { id: releaseId },
        data: { backendAgentStatus: "FAILED" },
      });
    } catch (e) {
      console.error("[cursor] backend plan agent: mark FAILED failed", e?.message || e);
    }
  };

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        developmentRepoUrl: true,
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
    if (!project) return;

    const devRaw = String(project.developmentRepoUrl || "").trim();
    if (!devRaw) return;

    const devParsed = parseScmRepoPath(devRaw);
    if (!devParsed || devParsed.provider !== "github") {
      console.warn("[cursor] backend plan agent: developmentRepoUrl must be a GitHub repo path");
      return;
    }

    let scmAccess = null;
    try {
      scmAccess = await resolveScmCredentialsFromProject(project);
    } catch {
      scmAccess = null;
    }
    const ghAccessToken = scmAccess?.token?.trim() || "";
    if (!ghAccessToken || scmAccess?.provider !== "github") {
      console.warn("[cursor] backend plan agent: GitHub credentials required");
      await markFailed();
      return;
    }

    const repositoryUrl = `https://github.com/${devParsed.owner}/${devParsed.repo}`;
    const meta = await scmGetRepositoryMetadata(
      "github",
      devParsed.owner,
      devParsed.repo,
      ghAccessToken,
    );
    if (!meta.ok) {
      console.warn("[cursor] backend plan agent: cannot read developer repo metadata", meta.message);
      await markFailed();
      return;
    }

    const releaseLockRow = await prisma.release.findUnique({
      where: { id: releaseId },
      select: { developerSubmodulePath: true, developerAgentRef: true },
    });
    const submodulePathForPrompt =
      releaseLockRow?.developerSubmodulePath?.trim() || LAUNCHPAD_FRONTEND_SUBMODULE_PATH;
    const explicitAgentRef = releaseLockRow?.developerAgentRef?.trim();
    const refBranch =
      explicitAgentRef ||
      (meta.defaultBranch && String(meta.defaultBranch).trim()) ||
      (typeof CURSOR_AGENT_SOURCE_REF_ENV === "string" && CURSOR_AGENT_SOURCE_REF_ENV.trim()
        ? CURSOR_AGENT_SOURCE_REF_ENV.trim()
        : "main");

    const promptText = buildBackendPlanPrompt(projectVersionId, releaseId, {
      submodulePath: submodulePathForPrompt,
    });

    const { data } = await cursorRequestWithProjectAndPatRetry({
      method: "POST",
      path: "/v0/agents",
      body: {
        prompt: { text: promptText },
        source: { repository: repositoryUrl, ref: refBranch },
        target: { autoBranch: true },
      },
      projectId,
    });

    if (!data?.id) {
      await markFailed();
      return;
    }

    const agentId = String(data.id).trim();
    const initialStatus = data.status
      ? String(data.status).toUpperCase().replace(/\s+/g, "_")
      : "CREATING";

    await prisma.release.update({
      where: { id: releaseId },
      data: {
        backendAgentId: agentId,
        backendAgentStatus: initialStatus,
      },
    });

    startReleaseBackendAgentPolling(agentId, releaseId);
  } catch (err) {
    console.error("[cursor] startReleaseBackendPlanAgent:", err?.message || err);
    await markFailed();
  }
}

/**
 * Poll Cursor for release-scoped backend plan agent; updates Release.backendAgentStatus only.
 */
export function startReleaseBackendAgentPolling(agentId, releaseId) {
  if (!agentId || typeof agentId !== "string" || !agentId.trim()) return;
  const id = agentId.trim();
  let timeoutId = null;

  const poll = async () => {
    try {
      const releaseRow = await prisma.release.findUnique({
        where: { id: releaseId },
        select: { projectId: true, backendAgentId: true },
      });
      if (!releaseRow || releaseRow.backendAgentId?.trim() !== id) {
        return;
      }

      const { status, data: agentData } = await getCursorAgentById(
        id,
        releaseRow.projectId,
      );
      if (status !== 200 || !agentData) {
        timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }
      const agentStatus = agentData?.status
        ? String(agentData.status).toUpperCase().replace(/\s+/g, "_")
        : null;

      await prisma.release.updateMany({
        where: { id: releaseId, backendAgentId: id },
        data: { backendAgentStatus: agentStatus ?? undefined },
      });

      if (
        isCursorAgentSuccessTerminal(agentStatus) ||
        isCursorAgentFailureTerminal(agentStatus)
      ) {
        return;
      }

      timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
    } catch (err) {
      console.error("[cursor] backend agent poll error:", err?.message || err);
      timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  void poll();
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
 *   prompt: { text: string, images?: Array<{ data: string, dimension: { width: number, height: number } }> },
 *   nodeCount?: number|null,
 *   source?: { repository?: string, prUrl?: string, ref?: string }|null,
 *   model?: unknown,
 *   target?: unknown,
 *   webhook?: unknown,
 *   deferLaunchpadMerge?: boolean,
 *   skipLaunchpadAutomation?: boolean — if true, poller does not run launchpad merge (developer-repo lock agent)
 *   omitTargetFromBody?: boolean — if true, do not send `target` in POST /v0/agents (client-link chat)
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
    const refBranch = clientRef || envRef || "main";
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
  const { status, data } = await cursorRequestWithProjectAndPatRetry({
    method: "POST",
    path: "/v0/agents",
    body: agentCreateBody,
    projectId,
  });

  if (!data || !data.id) {
    return { ok: false, status, data };
  }

  const count = await prisma.figmaConversion.count({
    where: { projectId, releaseId },
  });
  const attemptNumber = count + 1;
  let figmaConversionId = null;
  try {
    const created = await prisma.figmaConversion.create({
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
    figmaConversionId = created?.id ?? null;
  } catch (dbErr) {
    console.error("[cursor] FigmaConversion insert failed:", dbErr);
  }
  startAgentPolling(data.id);
  return { ok: true, status, data, figmaConversionId };
}

/**
 * Client-link merge: pick the ProjectVersion row to reuse (same git tag, no new revision).
 * Prefers active version on this release, else newest id.
 */
async function findReleaseAnchorVersionForClientLinkMerge(projectId, releaseId) {
  const rid = Number(releaseId);
  const pid = Number(projectId);
  if (!Number.isInteger(rid) || rid < 1 || !Number.isInteger(pid) || pid < 1) {
    return null;
  }
  return prisma.projectVersion.findFirst({
    where: { projectId: pid, releaseId: rid },
    orderBy: [{ isActive: "desc" }, { id: "desc" }],
    select: { id: true, gitTag: true, version: true, isActive: true },
  });
}

/**
 * Force `launchpad` to headSha, tag, build, deploy; update FigmaConversion.
 * @param {object} conversion — row with id, projectId, releaseId, attemptedById
 * @param {string} headSha
 * @param {string} headBranchName — agent branch name (for DB)
 * @param {{ skipShaDedupe?: boolean, prUrl?: string|null, reuseExistingReleaseTag?: boolean, explicitAnchorProjectVersionId?: number|null }} options
 * @param {boolean} [options.reuseExistingReleaseTag] — client-link only: move this release’s existing
 *   version tag to headSha and update that ProjectVersion row (no new tag / no new revision row).
 * @param {number|null} [options.explicitAnchorProjectVersionId] — when reusing a tag, pin to this ProjectVersion id (must belong to the same project and release).
 */
export async function executeLaunchpadHeadDeploy(conversion, headSha, headBranchName, options = {}) {
  const {
    skipShaDedupe = false,
    prUrl = null,
    reuseExistingReleaseTag = false,
    explicitAnchorProjectVersionId = null,
  } = options;

  const project = await prisma.project.findUnique({
    where: { id: conversion.projectId },
    select: {
      id: true,
      fromScratch: true,
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

  const fromScratchProject = Boolean(project?.fromScratch);
  await setProjectScratchVersionStatus(
    conversion.projectId,
    fromScratchProject,
    "CREATING",
  );

  if (!skipShaDedupe) {
    const lpNow = await scmGetBranchSha(provider, owner, repo, "launchpad", token);
    if (
      lpNow?.sha &&
      lpNow.sha.toLowerCase() === headSha.toLowerCase()
    ) {
      let anchorSkip = null;
      let tagSkip = "";
      if (reuseExistingReleaseTag) {
        anchorSkip = await findReleaseAnchorVersionForClientLinkMerge(
          conversion.projectId,
          conversion.releaseId,
        );
        tagSkip = anchorSkip?.gitTag?.trim() || "";
        if (anchorSkip && tagSkip) {
          const tr = await createTagIdempotent(owner, repo, tagSkip, headSha, token);
          if (!tr.ok) {
            console.warn(
              "[cursor] executeLaunchpadHeadDeploy: launchpad already at SHA but tag move failed",
              tr.message,
            );
          }
        }
      }
      await setProjectScratchVersionStatus(
        conversion.projectId,
        fromScratchProject,
        null,
      );
      return {
        merged: true,
        skipped: true,
        sha: headSha,
        prUrl,
        deployed: false,
        ...(anchorSkip && tagSkip
          ? { version: anchorSkip.version, tag: tagSkip }
          : {}),
      };
    }
  }

  await forceUpdateLaunchpadBranch({ provider, owner, repo, headSha, token });

  const releaseId = conversion.releaseId;

  let tagName;
  let versionNumber;
  let anchorVersion = null;
  let existingVersion = null;

  if (reuseExistingReleaseTag) {
    const explicitId = Number(explicitAnchorProjectVersionId);
    if (
      explicitAnchorProjectVersionId != null &&
      Number.isInteger(explicitId) &&
      explicitId > 0
    ) {
      anchorVersion = await prisma.projectVersion.findFirst({
        where: {
          id: explicitId,
          projectId: conversion.projectId,
          releaseId: conversion.releaseId,
        },
        select: { id: true, gitTag: true, version: true, isActive: true },
      });
    }
    if (!anchorVersion) {
      anchorVersion = await findReleaseAnchorVersionForClientLinkMerge(
        conversion.projectId,
        releaseId,
      );
    }
    const gt = anchorVersion?.gitTag?.trim() || "";
    if (!anchorVersion || !gt) {
      throw new Error(
        explicitAnchorProjectVersionId != null
          ? "The selected revision was not found for this release, or it has no git tag."
          : "No published version with a git tag exists for this release. Add or activate a version for this release before merging chat changes.",
      );
    }
    tagName = gt;
    versionNumber = anchorVersion.version;
    existingVersion = { id: anchorVersion.id };
  } else {
    versionNumber = await autoGenerateVersion(releaseId);
    tagName = `rel-${releaseId}-${versionNumber}`;
    existingVersion = await prisma.projectVersion.findFirst({
      where: {
        projectId: conversion.projectId,
        gitTag: tagName,
      },
      select: { id: true },
    });
  }

  const tagResult =
    provider === "github"
      ? await createTagIdempotent(owner, repo, tagName, headSha, token)
      : await createBitbucketTagIdempotent(owner, repo, tagName, headSha, token);
  if (!tagResult.ok) {
    throw new Error(tagResult.message || "Failed to create or move tag");
  }

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
    if (reuseExistingReleaseTag && anchorVersion) {
      return prisma.projectVersion.update({
        where: { id: anchorVersion.id },
        data: {
          buildUrl,
          releaseId: conversion.releaseId,
          uploadedBy: conversion.attemptedById,
        },
      });
    }
    if (existingVersion) {
      return prisma.projectVersion.update({
        where: { id: existingVersion.id },
        data: {
          version: versionNumber,
          gitTag: tagName,
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

        // Build only from the release tag at headSha (created/moved above). Do not use origin/launchpad.
        try {
          gitExec(
            ["fetch", "origin", `refs/tags/${tagName}:refs/tags/${tagName}`],
            tempRoot,
          );
        } catch {
          gitExec(["fetch", "origin", "tag", tagName], tempRoot);
        }
        gitExec(["checkout", "-f", tagName], tempRoot);

        const sourceRoot = findProjectRoot(tempRoot);
        const buildOutputPath = await runBuildSequence(sourceRoot);

        const projectRoot = path.join(backendRoot, project.projectPath);
        await fs.ensureDir(path.dirname(projectRoot));
        await fs.emptyDir(projectRoot);
        await fs.copy(buildOutputPath, projectRoot);

        await reloadNginx();

        const buildUrl = liveSiteUrl;

        newVersion = await prisma.$transaction(async (tx) => {
          if (reuseExistingReleaseTag && anchorVersion) {
            return tx.projectVersion.update({
              where: { id: anchorVersion.id },
              data: {
                buildUrl,
                releaseId: conversion.releaseId,
                uploadedBy: conversion.attemptedById,
              },
            });
          }
          await tx.projectVersion.updateMany({
            where: { projectId: conversion.projectId },
            data: { isActive: false },
          });
          if (existingVersion) {
            return tx.projectVersion.update({
              where: { id: existingVersion.id },
              data: {
                version: versionNumber,
                gitTag: tagName,
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

  await setProjectScratchVersionStatus(
    conversion.projectId,
    fromScratchProject,
    null,
  );

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

  const polledTip = await waitForAgentBranchTipSha({
    provider,
    owner,
    repo,
    branch: headBranch,
    token,
  });
  const headShaResult = polledTip
    ? { sha: polledTip }
    : await scmGetBranchSha(provider, owner, repo, headBranch, token);
  if (!headShaResult?.sha) {
    throw new Error("Could not get agent branch SHA; branch may not exist");
  }
  const headSha = headShaResult.sha;

  const prUrl = agentData.target?.prUrl || agentData.source?.prUrl;

  try {
    return await executeLaunchpadHeadDeploy(conversion, headSha, headBranch, {
      skipShaDedupe: options.skipShaDedupe ?? false,
      prUrl,
    });
  } catch (err) {
    await markScratchVersionFailedIfCreating(conversion.projectId);
    throw err;
  }
}

/**
 * Merge/deploy a specific commit SHA to launchpad for an existing conversion.
 * Used by client-link confirm flow when user confirms the currently applied preview commit.
 * @param {string} agentId
 * @param {string} headSha
 * @param {string} headBranchName
 * @param {{ skipShaDedupe?: boolean, prUrl?: string|null, reuseExistingReleaseTag?: boolean }} options
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

  try {
    return await executeLaunchpadHeadDeploy(conversion, sha, branch, {
      skipShaDedupe: options.skipShaDedupe ?? false,
      prUrl: options.prUrl ?? null,
      reuseExistingReleaseTag: Boolean(options.reuseExistingReleaseTag),
    });
  } catch (err) {
    await markScratchVersionFailedIfCreating(conversion.projectId);
    throw err;
  }
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
          flow: true,
          projectVersionId: true,
          project: { select: { fromScratch: true } },
        },
      });

      if (
        agentStatus &&
        convRow?.projectId &&
        convRow.project?.fromScratch
      ) {
        try {
          await prisma.project.update({
            where: { id: convRow.projectId },
            data: { scratchAgentStatus: agentStatus },
          });
        } catch (scratchStatusErr) {
          console.error("[cursor] poll: scratchAgentStatus update failed", {
            agentId: id,
            error: scratchStatusErr?.message || scratchStatusErr,
          });
        }
      }

      const pollRowUpdate = { status: agentStatus || undefined };
      if (branchNameFromAgent) {
        pollRowUpdate.targetBranchName = branchNameFromAgent;
      }
      await prisma.figmaConversion.updateMany({
        where: { agentId: id },
        data: pollRowUpdate,
      });

      if (isCursorAgentFailureTerminal(agentStatus)) {
        return;
      }

      if (isCursorAgentSuccessTerminal(agentStatus)) {
        if (convRow?.flow === "migrate_frontend") {
          try {
            const { runMigrateFrontendPhaseBFromPoller } = await import(
              "./migrateFrontend.service.js"
            );
            await runMigrateFrontendPhaseBFromPoller({
              agentId: id,
              agentData,
              convRow,
            });
          } catch (migrateErr) {
            console.error("[cursor] poll: migrate frontend phase B failed", {
              agentId: id,
              error: migrateErr?.message || migrateErr,
            });
          }
          return;
        }
        if (convRow?.skipLaunchpadAutomation) {
          console.log(
            "[cursor] poll: agent complete — skipLaunchpadAutomation (no platform merge)",
            { agentId: id },
          );
          return;
        }
        if (convRow?.deferLaunchpadMerge) {
          try {
            const { clientLinkAutoMergeFromAgentPoll } = await import("./chat.service.js");
            const mergeRes = await clientLinkAutoMergeFromAgentPoll(id);
            if (!mergeRes?.ok) {
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
            } else {
              await prisma.figmaConversion.updateMany({
                where: {
                  releaseId: convRow.releaseId,
                  projectId: convRow.projectId,
                  id: { not: convRow.id },
                },
                data: { awaitingLaunchpadConfirmation: false },
              });
            }
          } catch (autoErr) {
            console.error("[cursor] poll: client-link auto-merge failed", {
              agentId: id,
              error: autoErr?.message || autoErr,
            });
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
            } catch (deferErr) {
              console.error("[cursor] poll: defer merge flags failed", {
                agentId: id,
                error: deferErr?.message || deferErr,
              });
            }
          }
          return;
        }

        try {
          await performMergeToLaunchpad(id, agentData);
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
