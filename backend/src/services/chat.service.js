import crypto from "crypto";
import { PrismaClient, ReleaseStatus } from "@prisma/client";
import validator from "validator";
import ApiError from "../utils/apiError.js";
import { parseStoredEmailListToSet } from "../utils/emailList.utils.js";
import {
  createAgentForProjectRelease,
  executeLaunchpadHeadDeploy,
  getCursorAgentById,
  isCursorAgentSuccessTerminal,
  performMergeToLaunchpadAtCommit,
  postCursorAgentFollowup,
  resolveCursorRepositoryUrl,
} from "./cursor.service.js";
import { parseScmRepoPath } from "../utils/scmPath.js";
import {
  scmCompareRefs,
  scmGetBranchSha,
  scmGetCommitInfo,
  scmGetRepositoryMetadata,
  scmPutRepositoryContents,
} from "./scmFacade.service.js";
import {
  buildProjectPreviewFromGitRef,
  deployVersionArtifactsToProjectFolder,
} from "./project.service.js";
import { resolveScmCredentialsFromProject } from "./integrationCredential.service.js";

const prisma = new PrismaClient();
const GIT_SHA_RE = /^[0-9a-f]{7,40}$/i;

/** Appended to Cursor prompt only (not stored in ChatHistory). Max 5MB base64 payload. */
const CLIENT_REPO_IMAGE_INSTRUCTION = `

[Repository task — reference image attached]
The stakeholder attached an image that must replace the real asset in this Git repository for the selected preview element in the context above (sidebar icons, logos, <img>, <picture>, inline SVG, or CSS background-image).

You must:
1) Locate the source file(s) for that element (follow src= paths, bundler imports, SVG-in-JSX, or url() in CSS using the URL hints in the context).
2) Save the attached image bytes to **src/assets/** (create subfolders if needed, e.g. src/assets/images/). Use a clear filename (kebab-case, descriptive or derived from data-testid/id/component hint). Preserve the file extension that matches the image type (e.g. .png, .webp, .svg).
3) Wire the UI to that file: use this project’s usual pattern (e.g. \`import … from '@/assets/...'\` or \`import … from '../assets/...'\`, or \`new URL('../assets/...', import.meta.url)\` for Vite) so the built app resolves the path correctly. If an old asset lived outside src/assets/, migrate references to the new src/assets path and remove or stop using the old file when safe.
4) For inline SVG icons, prefer writing the raster/SVG file under src/assets/ and switching the component to import or reference that path (not public/), unless the repo convention strictly requires public/.
5) Remove stale srcset entries if you replace a raster image.
`;

function sanitizeClientLinkReplacementImage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  let data = typeof raw.data === "string" ? raw.data.trim() : "";
  if (data.includes(",")) data = data.split(",").pop() || "";
  data = data.replace(/\s/g, "");
  if (!data) return null;
  let buf;
  try {
    buf = Buffer.from(data, "base64");
  } catch {
    return null;
  }
  if (buf.length < 8 || buf.length > 5 * 1024 * 1024) return null;
  const mime =
    typeof raw.mimeType === "string" && raw.mimeType.trim().startsWith("image/")
      ? raw.mimeType.trim()
      : "image/png";
  const w = Math.min(8192, Math.max(1, Number(raw.width) || 512));
  const h = Math.min(8192, Math.max(1, Number(raw.height) || 512));
  return { data, mimeType: mime, width: w, height: h };
}

function replacementToCursorImages(sanitized) {
  if (!sanitized) return [];
  return [
    {
      data: sanitized.data,
      dimension: { width: sanitized.width, height: sanitized.height },
    },
  ];
}

function replacementMimeToExt(mimeType) {
  const m = String(mimeType || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("svg")) return "svg";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("gif")) return "gif";
  return "png";
}

/**
 * Base Git ref for client-link Cursor agents (persist git path; launchpad vs default branch).
 * @throws {Error} with .code REPO_UNRESOLVED | SCM_NOT_CONFIGURED
 */
async function resolveClientChatGitSource(project, forceLaunchpadBase = false) {
  const resolved = resolveCursorRepositoryUrl(project);
  if (!resolved.repositoryUrl) {
    const err = new Error(
      "Could not resolve repository for this project. Set gitRepoPath or connect GitHub/Bitbucket.",
    );
    err.code = "REPO_UNRESOLVED";
    throw err;
  }
  if (resolved.gitRepoPathToPersist) {
    await prisma.project.update({
      where: { id: project.id },
      data: { gitRepoPath: resolved.gitRepoPathToPersist },
    });
    project.gitRepoPath = resolved.gitRepoPathToPersist;
  }
  let sourceRef = "launchpad";
  let parsed = parseScmRepoPath(project.gitRepoPath || "");
  if (!parsed && resolved.repositoryUrl) {
    parsed = parseScmRepoPath(resolved.repositoryUrl);
  }
  if (!parsed) {
    const err = new Error(
      "Could not resolve repository owner/slug for this project.",
    );
    err.code = "REPO_UNRESOLVED";
    throw err;
  }
  let scm;
  try {
    scm = await resolveScmCredentialsFromProject(project);
  } catch (e) {
    const err = new Error(
      typeof e?.message === "string"
        ? e.message
        : "Repository credentials are not configured for this project.",
    );
    err.code = "SCM_NOT_CONFIGURED";
    throw err;
  }
  const token = scm.token?.trim() || "";
  if (!token) {
    const err = new Error("Repository token is not configured for this project.");
    err.code = "SCM_NOT_CONFIGURED";
    throw err;
  }
  if (scm.provider !== parsed.provider) {
    const err = new Error(
      `gitRepoPath points to ${parsed.provider} but project credentials are for ${scm.provider}.`,
    );
    err.code = "REPO_UNRESOLVED";
    throw err;
  }
  const lp = await scmGetBranchSha(parsed.provider, parsed.owner, parsed.repo, "launchpad", token);
  const launchpadMissing = !lp?.sha;
  if (launchpadMissing && !forceLaunchpadBase) {
    const meta = await scmGetRepositoryMetadata(
      parsed.provider,
      parsed.owner,
      parsed.repo,
      token,
    );
    if (meta.ok) {
      sourceRef = meta.defaultBranch || "main";
    }
  }
  return {
    repositoryUrl: resolved.repositoryUrl,
    sourceRef,
    parsed,
    token,
  };
}

async function resolveAgentTargetBranchForFollowup(conv) {
  const fromDb =
    typeof conv?.targetBranchName === "string"
      ? conv.targetBranchName.trim()
      : "";
  if (fromDb) return fromDb;
  const agentId = conv?.agentId;
  if (!agentId) return null;
  try {
    const { status, data } = await getCursorAgentById(String(agentId));
    if (status !== 200 || !data) return null;
    const b = data?.target?.branchName;
    return typeof b === "string" && b.trim() ? b.trim() : null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ ok: true, path: string, branch: string } | { ok: false, message: string }>}
 */
async function commitClientLinkReplacementToBranch({
  provider,
  owner,
  repo,
  token,
  branch,
  userMessageId,
  sanitized,
}) {
  const branchHead = await scmGetBranchSha(provider, owner, repo, branch, token);
  if (!branchHead?.sha) {
    return {
      ok: false,
      message: `Branch "${branch}" was not found on the remote.`,
    };
  }
  const ext = replacementMimeToExt(sanitized.mimeType);
  const suffix = crypto.randomBytes(4).toString("hex");
  const filePath = `src/assets/images/client-link-${userMessageId}-${suffix}.${ext}`;
  const put = await scmPutRepositoryContents(provider, owner, repo, filePath, {
    message: `chore(client-link): add replacement image (chat #${userMessageId})`,
    contentBase64: sanitized.data,
    branch,
    token,
    fileSha: null,
  });
  if (!put.ok) {
    return {
      ok: false,
      message:
        typeof put.message === "string"
          ? put.message
          : "The repository host refused the file upload.",
    };
  }
  return { ok: true, path: filePath, branch };
}

/** Resolve project by public slug (no client secret for now). */
export async function resolveProjectBySlug(slug) {
  const s = typeof slug === "string" ? slug.trim() : "";
  if (!s) throw new ApiError(400, "Invalid slug");

  const project = await prisma.project.findUnique({
    where: { slug: s },
    select: {
      id: true,
      slug: true,
      assignedManagerId: true,
      githubToken: true,
      name: true,
      gitRepoPath: true,
      githubUsername: true,
      stakeholderEmails: true,
      githubConnectionId: true,
      bitbucketConnectionId: true,
      bitbucketToken: true,
      bitbucketUsername: true,
      createdById: true,
    },
  });
  if (!project) {
    throw new ApiError(404, "Not found");
  }
  return project;
}

async function assertReleaseBelongs(releaseId, projectId) {
  const rid = Number(releaseId);
  if (!Number.isInteger(rid) || rid < 1) {
    throw new ApiError(400, "Invalid release");
  }
  const release = await prisma.release.findFirst({
    where: { id: rid, projectId },
    select: { id: true, status: true },
  });
  if (!release) {
    throw new ApiError(404, "Release not found");
  }
  return release;
}

function assertReleaseNotLocked(release) {
  if (release.status === ReleaseStatus.locked) {
    throw new ApiError(400, "Release is locked");
  }
}

/** Same rules as public release lock: stakeholders must be configured; email must be in the list. */
function assertPublicClientStakeholderEmail(stakeholderCsv, clientEmailRaw) {
  const email =
    typeof clientEmailRaw === "string" ? clientEmailRaw.trim().toLowerCase() : "";
  if (!email) {
    throw new ApiError(400, "Client email is required.");
  }
  if (!validator.isEmail(email)) {
    throw new ApiError(400, "Invalid email address.");
  }
  const stakeholderSet = parseStoredEmailListToSet(stakeholderCsv);
  if (stakeholderSet.size === 0) {
    throw new ApiError(
      400,
      "Public release lock is not available until project stakeholders are configured.",
    );
  }
  if (!stakeholderSet.has(email)) {
    throw new ApiError(
      403,
      "This email is not authorized to use this chat feature.",
    );
  }
}

const CURSOR_CHAT_ACCESS_DENIED_MESSAGE =
  "Your email is not allowed to use this chat feature.";

/**
 * Cursor may return 401 + "Unauthorized request.: Follow-up blocked." — surface a single safe message to clients.
 */
function mapCursorChatErrorMessageForClient(httpStatus, rawError, fallback) {
  const raw = typeof rawError === "string" ? rawError.trim() : "";
  const fb = typeof fallback === "string" ? fallback : "Could not send message to agent";
  if (!raw) return fb;
  const lower = raw.toLowerCase();
  if (/follow[- ]?up\s*blocked/.test(lower)) {
    return CURSOR_CHAT_ACCESS_DENIED_MESSAGE;
  }
  if (httpStatus === 401 && /unauthorized/.test(lower) && /blocked/.test(lower)) {
    return CURSOR_CHAT_ACCESS_DENIED_MESSAGE;
  }
  return raw;
}

function latestConversionForRelease(projectId, releaseId) {
  const pid = Number(projectId);
  const rid = Number(releaseId);
  if (!Number.isInteger(pid) || pid < 1 || !Number.isInteger(rid) || rid < 1) {
    return Promise.resolve(null);
  }
  return prisma.figmaConversion.findFirst({
    where: { projectId: pid, releaseId: rid },
    orderBy: { id: "desc" },
    select: {
      id: true,
      agentId: true,
      releaseId: true,
      projectId: true,
      status: true,
      deferLaunchpadMerge: true,
      awaitingLaunchpadConfirmation: true,
      projectVersionId: true,
      pendingClientChatMessageId: true,
      targetBranchName: true,
    },
  });
}

function shouldCreateFreshClientAgent(conv) {
  if (!conv?.agentId) return true;
  // Legacy or non-client-link runs can auto-merge; never reuse them.
  if (!conv.deferLaunchpadMerge) return true;
  // If this conversion was already merged, start a new conversion cycle.
  if (conv.projectVersionId != null) return true;
  return false;
}

function extractAgentActivity(agentData) {
  if (!agentData || typeof agentData !== "object") return null;
  const candidates = [
    agentData.activity,
    agentData.currentTask,
    agentData.currentStep,
    agentData.message,
    agentData.summary,
    agentData.statusMessage,
    agentData.status_message,
    agentData?.lastMessage?.text,
    agentData?.state?.message,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

async function resolveClientChatRepository(project) {
  const resolved = resolveCursorRepositoryUrl(project);
  if (!resolved.repositoryUrl) {
    throw new ApiError(
      400,
      "Could not determine the repository URL for this project.",
    );
  }

  if (resolved.gitRepoPathToPersist) {
    await prisma.project.update({
      where: { id: project.id },
      data: { gitRepoPath: resolved.gitRepoPathToPersist },
    });
    project.gitRepoPath = resolved.gitRepoPathToPersist;
  }

  const parsed =
    parseScmRepoPath(project.gitRepoPath || "") ||
    parseScmRepoPath(resolved.repositoryUrl);
  if (!parsed) {
    throw new ApiError(400, "Invalid repository URL format.");
  }
  let token = "";
  let provider = parsed.provider;
  try {
    const scm = await resolveScmCredentialsFromProject(project);
    if (scm.provider !== parsed.provider) {
      throw new ApiError(
        400,
        `Repository path does not match connected ${scm.provider} credentials.`,
      );
    }
    token = scm.token?.trim() || "";
    provider = scm.provider;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    token = "";
  }
  if (!token) {
    throw new ApiError(400, "Repository token is not configured for this project.");
  }
  return { owner: parsed.owner, repo: parsed.repo, token, provider };
}

/**
 * Set ChatHistory.appliedCommitSha from GitHub HEAD of the agent branch.
 * Resolves FigmaConversion by ChatHistory id === pendingClientChatMessageId (no cursor/client-chat fallback).
 */
async function syncPendingMessageCommitSha(project, conv) {
  const chatHistoryId = Number(conv?.pendingClientChatMessageId);
  if (!Number.isInteger(chatHistoryId) || chatHistoryId < 1) {
    return null;
  }

  const releaseId = Number(conv?.releaseId);
  if (!Number.isInteger(releaseId) || releaseId < 1) {
    return null;
  }

  const figmaRow = await prisma.figmaConversion.findFirst({
    where: {
      projectId: project.id,
      releaseId,
      pendingClientChatMessageId: chatHistoryId,
    },
    select: { id: true, targetBranchName: true, agentId: true },
  });
  if (!figmaRow) {
    return null;
  }

  let branch =
    typeof figmaRow.targetBranchName === "string"
      ? figmaRow.targetBranchName.trim()
      : "";
  if (!branch && figmaRow.agentId) {
    try {
      const { status, data } = await getCursorAgentById(figmaRow.agentId);
      const fromApi =
        status === 200 && typeof data?.target?.branchName === "string"
          ? data.target.branchName.trim()
          : "";
      if (fromApi) {
        branch = fromApi;
        await prisma.figmaConversion
          .update({
            where: { id: figmaRow.id },
            data: { targetBranchName: branch },
          })
          .catch(() => {});
      }
    } catch {
      // ignore
    }
  }
  if (!branch) {
    return null;
  }

  try {
    const repo = await resolveClientChatRepository(project);
    const head = await scmGetBranchSha(
      repo.provider,
      repo.owner,
      repo.repo,
      branch,
      repo.token,
    );
    if (!head?.sha) {
      return null;
    }
    await prisma.$transaction([
      prisma.chatHistory.updateMany({
        where: {
          id: chatHistoryId,
          projectId: project.id,
          releaseId,
          role: "user",
        },
        data: { appliedCommitSha: head.sha },
      }),
      prisma.figmaConversion.update({
        where: { id: figmaRow.id },
        data: { pendingClientChatMessageId: null },
      }),
    ]);
    return head.sha;
  } catch {
    return null;
  }
}

/**
 * Ensure `sha` is an ancestor of (or equal to) a tracked agent branch for this release.
 * Branch selection is based on FigmaConversion.targetBranchName:
 * 1) preferred row matched by pendingClientChatMessageId === chatHistoryId (if provided)
 * 2) then remaining rows for projectId + releaseId (newest first)
 */
async function assertShaOnTrackedAgentBranch(project, releaseId, sha, chatHistoryId = null) {
  const repo = await resolveClientChatRepository(project);
  const pid = project.id;
  const rid = Number(releaseId);
  if (!Number.isInteger(rid) || rid < 1) {
    throw new ApiError(400, "Invalid release for commit validation.");
  }

  const rows = await prisma.figmaConversion.findMany({
    where: { projectId: pid, releaseId: rid },
    orderBy: { id: "desc" },
    select: {
      id: true,
      targetBranchName: true,
      pendingClientChatMessageId: true,
    },
  });

  const branches = [];
  function pushBranch(name) {
    const b = typeof name === "string" ? name.trim() : "";
    if (!b || branches.includes(b)) return;
    branches.push(b);
  }

  const mid =
    chatHistoryId != null && Number.isInteger(Number(chatHistoryId)) && Number(chatHistoryId) > 0
      ? Number(chatHistoryId)
      : null;

  if (mid != null) {
    const preferred = rows.find((r) => r.pendingClientChatMessageId === mid);
    if (preferred) {
      const b =
        typeof preferred.targetBranchName === "string"
          ? preferred.targetBranchName.trim()
          : "";
      pushBranch(b);
    }
  }

  for (const r of rows) {
    const b = typeof r.targetBranchName === "string" ? r.targetBranchName.trim() : "";
    pushBranch(b);
  }

  let lastCompareError = "";
  for (const branch of branches) {
    const cmp = await scmCompareRefs(
      repo.provider,
      repo.owner,
      repo.repo,
      sha,
      branch,
      repo.token,
    );
    if (!cmp.ok) {
      lastCompareError = cmp.message || "compare failed";
      continue;
    }
    const st = String(cmp.data?.status || "").toLowerCase();
    if (st === "ahead" || st === "identical") {
      return repo;
    }
  }

  throw new ApiError(
    400,
    lastCompareError
      ? `Commit is not on any tracked targetBranchName for this release (last compare: ${lastCompareError}).`
      : "Commit is not on any tracked targetBranchName for this release.",
  );
}

/**
 * @param {{ forceLaunchpadBase?: boolean }} opts - when true, always use ref launchpad (never main) so a new
 * agent after a prior client-link merge builds on merged work, not the default branch.
 */
async function createClientChatAgent({
  project,
  releaseId,
  text,
  forceLaunchpadBase = false,
  promptImages = null,
}) {
  const { repositoryUrl, sourceRef } = await resolveClientChatGitSource(
    project,
    forceLaunchpadBase,
  );

  const prompt =
    Array.isArray(promptImages) && promptImages.length > 0
      ? { text, images: promptImages }
      : { text };

  const cursorAgentCreateInput = {
    projectId: project.id,
    releaseId: Number(releaseId),
    attemptedById: project.assignedManagerId,
    prompt,
    model: "composer-1.5",
    deferLaunchpadMerge: true,
    omitTargetFromBody: true,
    source: {
      repository: repositoryUrl,
      ref: sourceRef,
    },
  };
  return createAgentForProjectRelease({
    ...cursorAgentCreateInput,
    silentCursorApiLog: true,
  });
}

/**
 * POST follow-up prompt (public).
 */
export async function clientLinkFollowup({
  slug,
  releaseId,
  promptText,
  clientEmail,
  replacementImage: replacementImageRaw = null,
}) {
  const project = await resolveProjectBySlug(slug);
  assertPublicClientStakeholderEmail(project.stakeholderEmails, clientEmail);
  const release = await assertReleaseBelongs(releaseId, project.id);
  assertReleaseNotLocked(release);

  const sanitizedReplacement =
    sanitizeClientLinkReplacementImage(replacementImageRaw);
  let storedText = typeof promptText === "string" ? promptText.trim() : "";
  if (!storedText && sanitizedReplacement) {
    storedText =
      "Replace the selected asset with the attached reference image. Save it under src/assets/ (e.g. src/assets/images/) and update imports or references in code.";
  }
  if (!storedText) {
    throw new ApiError(400, "Message required");
  }

  let textForCursor = sanitizedReplacement
    ? `${storedText}${CLIENT_REPO_IMAGE_INSTRUCTION}`
    : storedText;
  const cursorImages = replacementToCursorImages(sanitizedReplacement);

  const userMessage = await prisma.chatHistory.create({
    data: {
      projectId: project.id,
      releaseId: Number(releaseId),
      role: "user",
      text: storedText,
    },
  });

  if (!process.env.CURSOR_API_KEY?.trim()) {
    throw new ApiError(503, "Chat is temporarily unavailable.");
  }

  const [priorVersionedConversion, priorMergedChat] = await Promise.all([
    prisma.figmaConversion.findFirst({
      where: {
        projectId: project.id,
        releaseId: Number(releaseId),
        projectVersionId: { not: null },
      },
      select: { id: true },
    }),
    prisma.chatHistory.findFirst({
      where: {
        projectId: project.id,
        releaseId: Number(releaseId),
        role: "user",
        mergedAt: { not: null },
      },
      select: { id: true },
    }),
  ]);
  const forceLaunchpadBase =
    Boolean(priorVersionedConversion) || Boolean(priorMergedChat);

  let conv = await latestConversionForRelease(project.id, Number(releaseId));
  const needFreshAgent = shouldCreateFreshClientAgent(conv);

  if (sanitizedReplacement) {
    try {
      const repoCtx = await resolveClientChatRepository(project);
      let commitBranch = null;
      if (needFreshAgent) {
        const git = await resolveClientChatGitSource(project, forceLaunchpadBase);
        commitBranch = git.sourceRef;
      } else {
        commitBranch = await resolveAgentTargetBranchForFollowup(conv);
      }
      if (!commitBranch) {
        throw new ApiError(
          502,
          "Could not determine a Git branch to save the uploaded image.",
        );
      }
      const commit = await commitClientLinkReplacementToBranch({
        provider: repoCtx.provider,
        owner: repoCtx.owner,
        repo: repoCtx.repo,
        token: repoCtx.token,
        branch: commitBranch,
        userMessageId: userMessage.id,
        sanitized: sanitizedReplacement,
      });
      if (!commit.ok) {
        throw new ApiError(
          502,
          commit.message || "Failed to save the image to the repository.",
        );
      }
      textForCursor += `\n\n[The uploaded image is already committed at \`${commit.path}\` on branch \`${commitBranch}\`. Import this file (e.g. \`@/assets/images/...\` or your project's path alias) and replace the selected element's asset; do not duplicate the file elsewhere.]`;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (
        err.code === "GITHUB_NOT_CONFIGURED" ||
        err.code === "SCM_NOT_CONFIGURED" ||
        err.code === "REPO_UNRESOLVED"
      ) {
        throw new ApiError(400, err.message);
      }
      console.error("[client-link] replacement image commit failed", err);
      throw new ApiError(
        502,
        err.message || "Failed to save the image to the repository.",
      );
    }
  }

  if (needFreshAgent) {
    try {
      const result = await createClientChatAgent({
        project,
        releaseId: Number(releaseId),
        text: textForCursor,
        forceLaunchpadBase,
        promptImages: cursorImages.length > 0 ? cursorImages : null,
      });
      if (!result.ok) {
        const rawStr =
          typeof result.data?.error === "string" ? result.data.error : "";
        const msg = mapCursorChatErrorMessageForClient(
          result.status,
          rawStr,
          "Could not start chat agent",
        );
        throw new ApiError(
          result.status >= 400 && result.status < 500 ? result.status : 502,
          msg,
        );
      }
      if (result.data?.id) {
        await prisma.figmaConversion.updateMany({
          where: {
            agentId: String(result.data.id),
            projectId: project.id,
            releaseId: Number(releaseId),
          },
          data: { pendingClientChatMessageId: userMessage.id },
        });
      }
      return {
        ok: true,
        agentId: result.data?.id ?? null,
        agentStatus: result.data?.status || null,
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (
        err.code === "GITHUB_NOT_CONFIGURED" ||
        err.code === "SCM_NOT_CONFIGURED" ||
        err.code === "REPO_UNRESOLVED" ||
        err.code === "REPO_INACCESSIBLE"
      ) {
        throw new ApiError(400, err.message);
      }
      if (err.code === "PROJECT_NOT_FOUND") {
        throw new ApiError(404, err.message);
      }
      if (err.code === "CURSOR_KEY_MISSING") {
        throw new ApiError(503, "Chat is temporarily unavailable.");
      }
      throw new ApiError(502, err.message || "Could not start chat agent");
    }
  }

  let status;
  let data;
  try {
    await prisma.figmaConversion.update({
      where: { id: conv.id },
      data: {
        pendingClientChatMessageId: userMessage.id,
        deferLaunchpadMerge: true,
      },
    });
    ({ status, data } = await postCursorAgentFollowup(
      conv.agentId,
      cursorImages.length > 0
        ? { text: textForCursor, images: cursorImages }
        : { text: textForCursor },
      { silent: true },
    ));
  } catch (err) {
    await prisma.figmaConversion.update({
      where: { id: conv.id },
      data: { pendingClientChatMessageId: null },
    }).catch(() => {});
    if (err.code === "CURSOR_KEY_MISSING") {
      throw new ApiError(503, "Chat is temporarily unavailable.");
    }
    throw new ApiError(502, err.message || "Could not send message to agent");
  }

  if (status < 200 || status >= 300) {
    const rawErr =
      typeof data?.error === "string" ? data.error : "Could not send message to agent";
    const message = mapCursorChatErrorMessageForClient(status, rawErr, rawErr);
    throw new ApiError(
      status >= 400 && status < 500 ? status : 502,
      message,
    );
  }

  return {
    ok: true,
    agentId: conv.agentId,
    agentStatus: data?.status || null,
  };
}

/**
 * Sanitized agent status for client UI.
 */
export async function clientLinkAgentStatus({ slug, releaseId }) {
  const project = await resolveProjectBySlug(slug);
  await assertReleaseBelongs(releaseId, project.id);

  const conv = await latestConversionForRelease(project.id, Number(releaseId));
  if (!conv?.agentId) {
    return { hasAgent: false, status: null };
  }

  if (!process.env.CURSOR_API_KEY?.trim()) {
    return { hasAgent: true, status: null, error: "unconfigured" };
  }

  try {
    const { status, data } = await getCursorAgentById(conv.agentId);
    if (status !== 200 || !data) {
      return {
        hasAgent: true,
        status: null,
        error: "status_unavailable",
        awaitingLaunchpadConfirmation: Boolean(conv.awaitingLaunchpadConfirmation),
        mergeConfirmationPending:
          Boolean(conv.awaitingLaunchpadConfirmation) &&
          conv.projectVersionId == null,
      };
    }
    const st = data.status != null ? String(data.status) : null;
    if (
      isCursorAgentSuccessTerminal(st) &&
      Boolean(conv.deferLaunchpadMerge) &&
      conv.pendingClientChatMessageId != null
    ) {
      await syncPendingMessageCommitSha(project, conv);
    }
    const mergeConfirmationPending =
      Boolean(conv.awaitingLaunchpadConfirmation) ||
      (isCursorAgentSuccessTerminal(st) &&
        Boolean(conv.deferLaunchpadMerge) &&
        conv.projectVersionId == null);
    return {
      hasAgent: true,
      status: st,
      activity: extractAgentActivity(data),
      prUrl:
        typeof data.target?.prUrl === "string"
          ? data.target.prUrl
          : typeof data.source?.prUrl === "string"
            ? data.source.prUrl
            : null,
      awaitingLaunchpadConfirmation: Boolean(conv.awaitingLaunchpadConfirmation),
      mergeConfirmationPending,
      deferLaunchpadMerge: Boolean(conv.deferLaunchpadMerge),
    };
  } catch {
    return {
      hasAgent: true,
      status: null,
      error: "poll_failed",
      awaitingLaunchpadConfirmation: Boolean(conv.awaitingLaunchpadConfirmation),
      mergeConfirmationPending:
        Boolean(conv.awaitingLaunchpadConfirmation) &&
        conv.projectVersionId == null,
    };
  }
}

/**
 * Summary of changes after agent finishes for release.
 */
export async function clientLinkExecutionSummary({ slug, releaseId }) {
  const project = await resolveProjectBySlug(slug);
  await assertReleaseBelongs(releaseId, project.id);

  const conv = await latestConversionForRelease(project.id, Number(releaseId));
  if (!conv?.id) {
    return {
      ok: false,
      ready: false,
      error: "No agent run found for this release yet.",
    };
  }
  const fullConv = await prisma.figmaConversion.findUnique({
    where: { id: conv.id },
    select: {
      id: true,
      status: true,
      targetBranchName: true,
      projectVersionId: true,
      releaseId: true,
      projectId: true,
    },
  });
  if (!fullConv) {
    return { ok: false, ready: false, error: "Conversion not found." };
  }
  if (!isCursorAgentSuccessTerminal(fullConv.status)) {
    return {
      ok: false,
      ready: false,
      status: fullConv.status || null,
      error: "Agent has not finished yet.",
    };
  }
  if (fullConv.projectVersionId == null) {
    return {
      ok: true,
      ready: false,
      pendingMergeConfirmation: true,
      status: fullConv.status || null,
      error: null,
    };
  }

  const currentVersion = await prisma.projectVersion.findUnique({
    where: { id: fullConv.projectVersionId },
    select: {
      id: true,
      projectId: true,
      releaseId: true,
      version: true,
      gitTag: true,
      createdAt: true,
    },
  });
  if (!currentVersion?.gitTag) {
    return {
      ok: false,
      ready: false,
      error: "Generated version/tag not available for summary yet.",
    };
  }

  const previousVersion = await prisma.projectVersion.findFirst({
    where: {
      projectId: currentVersion.projectId,
      releaseId: currentVersion.releaseId,
      createdAt: { lt: currentVersion.createdAt },
      gitTag: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, version: true, gitTag: true },
  });
  if (!previousVersion?.gitTag) {
    return {
      ok: true,
      ready: true,
      summaryLines: [
        `Created version ${currentVersion.version} (${currentVersion.gitTag}).`,
        "No previous version exists for this release, so a file-by-file diff is not available yet.",
      ],
      stats: null,
      files: [],
    };
  }

  let scmTok = "";
  let scmProvider = "github";
  try {
    const scm = await resolveScmCredentialsFromProject(project);
    scmTok = scm.token?.trim() || "";
    scmProvider = scm.provider;
  } catch {
    scmTok = "";
  }
  if (!scmTok || !project.gitRepoPath?.trim()) {
    return {
      ok: true,
      ready: true,
      summaryLines: [
        `Created version ${currentVersion.version} (${currentVersion.gitTag}).`,
        "Could not compare against previous version because repository credentials or gitRepoPath are not configured.",
      ],
      stats: null,
      files: [],
    };
  }
  const parsedRepo = parseScmRepoPath(project.gitRepoPath);
  if (!parsedRepo || parsedRepo.provider !== scmProvider) {
    return {
      ok: true,
      ready: true,
      summaryLines: [
        `Created version ${currentVersion.version} (${currentVersion.gitTag}).`,
        "Could not compare versions because gitRepoPath format is invalid or does not match the connected host.",
      ],
      stats: null,
      files: [],
    };
  }

  const compare = await scmCompareRefs(
    scmProvider,
    parsedRepo.owner,
    parsedRepo.repo,
    previousVersion.gitTag,
    currentVersion.gitTag,
    scmTok,
  );
  if (!compare.ok) {
    return {
      ok: true,
      ready: true,
      summaryLines: [
        `Created version ${currentVersion.version} (${currentVersion.gitTag}).`,
        `Could not generate compare summary: ${compare.message}.`,
      ],
      stats: null,
      files: [],
    };
  }

  const cmp = compare.data || {};
  const files = Array.isArray(cmp.files) ? cmp.files : [];
  const commits = Array.isArray(cmp.commits) ? cmp.commits : [];
  const additions = Number(cmp.total_additions || 0);
  const deletions = Number(cmp.total_deletions || 0);
  const changes = Number(cmp.total_changes || additions + deletions);

  const topFiles = files.slice(0, 12).map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: Number(f.additions || 0),
    deletions: Number(f.deletions || 0),
    changes: Number(f.changes || 0),
  }));
  const summaryLines = [
    `Updated from ${previousVersion.gitTag} to ${currentVersion.gitTag}.`,
    `${commits.length} commit(s), ${files.length} file(s) changed, +${additions} / -${deletions} (${changes} total line changes).`,
    ...topFiles.map(
      (f) =>
        `${String(f.status || "modified").toUpperCase()}: ${f.filename} (+${f.additions}/-${f.deletions})`,
    ),
  ];

  return {
    ok: true,
    ready: true,
    summaryLines,
    stats: {
      commits: commits.length,
      files: files.length,
      additions,
      deletions,
      changes,
    },
    files: topFiles,
  };
}

/** Public: persisted chat for client link (per release). */
export async function clientLinkListChatMessages({ slug, releaseId, limit = 200 }) {
  const project = await resolveProjectBySlug(slug);
  await assertReleaseBelongs(releaseId, project.id);

  // Backfill commit SHA lazily if polling reached success but row has not been synced yet.
  const conv = await latestConversionForRelease(project.id, Number(releaseId));
  if (
    conv?.agentId &&
    conv.pendingClientChatMessageId != null &&
    Boolean(conv.deferLaunchpadMerge)
  ) {
    try {
      const { status, data } = await getCursorAgentById(conv.agentId);
      if (status === 200 && isCursorAgentSuccessTerminal(data?.status)) {
        await syncPendingMessageCommitSha(project, conv);
      }
    } catch {
      // Best-effort only; never block chat history.
    }
  }

  const rows = await prisma.chatHistory.findMany({
    where: {
      projectId: project.id,
      releaseId: Number(releaseId),
      role: { not: "system" },
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(Number(limit) || 200, 1), 500),
    select: {
      id: true,
      role: true,
      tone: true,
      text: true,
      msgKey: true,
      appliedCommitSha: true,
      mergedAt: true,
      revertedAt: true,
      revertCommitSha: true,
      createdAt: true,
    },
  });

  return {
    messages: rows.map((r) => ({
      id: r.id,
      role: r.role,
      tone: r.tone,
      text: r.text,
      msgKey: r.msgKey,
      appliedCommitSha: r.appliedCommitSha || null,
      isMerged: r.role === "user" && Boolean(r.mergedAt),
      mergedAt: r.mergedAt,
      revertedAt: r.revertedAt || null,
      revertCommitSha: r.revertCommitSha || null,
      isReverted: r.role === "user" && Boolean(r.revertedAt),
      createdAt: r.createdAt,
    })),
  };
}

/**
 * Core merge + deploy for client-link (no auth). Used by confirm-merge HTTP and agent poller.
 * Idempotent when ChatHistory row already merged with the same SHA.
 */
async function executeClientLinkLaunchpadMerge(
  project,
  releaseId,
  commitSha,
  messageId = null,
) {
  const requestedSha = typeof commitSha === "string" ? commitSha.trim() : "";
  if (!GIT_SHA_RE.test(requestedSha)) {
    throw new ApiError(400, "Applied commit SHA is required to confirm merge.");
  }

  const rid = Number(releaseId);
  if (!Number.isInteger(rid) || rid < 1) {
    throw new ApiError(400, "Invalid release.");
  }

  const msgId =
    messageId != null && Number.isInteger(Number(messageId)) && Number(messageId) > 0
      ? Number(messageId)
      : null;

  if (msgId != null) {
    const existing = await prisma.chatHistory.findFirst({
      where: {
        id: msgId,
        projectId: project.id,
        releaseId: rid,
        role: "user",
      },
      select: { mergedAt: true, appliedCommitSha: true },
    });
    if (
      existing?.mergedAt &&
      typeof existing.appliedCommitSha === "string" &&
      existing.appliedCommitSha.trim().toLowerCase() === requestedSha.toLowerCase()
    ) {
      await prisma.figmaConversion.updateMany({
        where: {
          projectId: project.id,
          releaseId: rid,
          awaitingLaunchpadConfirmation: true,
        },
        data: { awaitingLaunchpadConfirmation: false },
      });
      return { ok: true, skipped: true };
    }
  }

  if (!process.env.CURSOR_API_KEY?.trim()) {
    throw new ApiError(503, "Chat is temporarily unavailable.");
  }

  const projectRepo = await resolveClientChatRepository(project);

  const rows = await prisma.figmaConversion.findMany({
    where: {
      projectId: project.id,
      releaseId: rid,
    },
    orderBy: { id: "desc" },
    select: {
      id: true,
      agentId: true,
      targetBranchName: true,
      pendingClientChatMessageId: true,
    },
  });
  if (!rows.length) {
    throw new ApiError(400, "Nothing to confirm for this release.");
  }

  const ordered = [];
  if (msgId != null) {
    const preferred = rows.filter((r) => r.pendingClientChatMessageId === msgId);
    ordered.push(...preferred);
  }
  ordered.push(...rows.filter((r) => !ordered.some((x) => x.id === r.id)));

  let match = null;
  for (const row of ordered) {
    const branch =
      typeof row.targetBranchName === "string" ? row.targetBranchName.trim() : "";
    if (!branch) continue;
    const cmp = await scmCompareRefs(
      projectRepo.provider,
      projectRepo.owner,
      projectRepo.repo,
      requestedSha,
      branch,
      projectRepo.token,
    );
    if (!cmp.ok) continue;
    const st = String(cmp.data?.status || "").toLowerCase();
    if (st === "ahead" || st === "identical") {
      match = { row, branch };
      break;
    }
  }
  if (!match) {
    throw new ApiError(
      400,
      "Selected commit is not in tracked targetBranchName history for this release.",
    );
  }

  try {
    await performMergeToLaunchpadAtCommit(
      match.row.agentId,
      requestedSha,
      match.branch,
    );
  } catch (err) {
    throw new ApiError(502, err?.message || "Merge to launchpad failed.");
  }

  if (msgId != null) {
    await prisma.chatHistory.updateMany({
      where: {
        projectId: project.id,
        releaseId: rid,
        id: msgId,
        role: "user",
      },
      data: { mergedAt: new Date() },
    });
  } else {
    await prisma.chatHistory.updateMany({
      where: {
        projectId: project.id,
        releaseId: rid,
        role: "user",
        appliedCommitSha: requestedSha,
      },
      data: { mergedAt: new Date() },
    });
  }

  return { ok: true };
}

/**
 * Called from cursor poller when a deferred client-link agent finishes.
 * Syncs SHA to ChatHistory, merges to launchpad, sets mergedAt.
 * On failure, leaves awaitingLaunchpadConfirmation so manual confirm-merge can retry.
 */
export async function clientLinkAutoMergeFromAgentPoll(agentId) {
  const aid =
    typeof agentId === "string" ? agentId.trim() : String(agentId || "").trim();
  if (!aid) return { ok: false, reason: "no_agent" };

  if (!process.env.CURSOR_API_KEY?.trim()) {
    console.warn("[chat] clientLinkAutoMergeFromAgentPoll: CURSOR_API_KEY missing");
    return { ok: false, reason: "no_cursor_key" };
  }

  const conv = await prisma.figmaConversion.findFirst({
    where: { agentId: aid },
    select: {
      id: true,
      deferLaunchpadMerge: true,
      pendingClientChatMessageId: true,
      releaseId: true,
      projectId: true,
      targetBranchName: true,
      agentId: true,
    },
  });
  if (!conv?.deferLaunchpadMerge) {
    return { ok: true, skipped: true, reason: "not_deferred" };
  }

  const release = await prisma.release.findFirst({
    where: { id: conv.releaseId, projectId: conv.projectId },
    select: { id: true, status: true },
  });
  if (!release) return { ok: false, reason: "no_release" };
  if (release.status === ReleaseStatus.locked) {
    console.warn("[chat] clientLinkAutoMergeFromAgentPoll: release locked", { agentId: aid });
    return { ok: false, reason: "locked" };
  }

  const project = await prisma.project.findUnique({
    where: { id: conv.projectId },
    select: {
      id: true,
      slug: true,
      assignedManagerId: true,
      githubToken: true,
      githubUsername: true,
      githubConnectionId: true,
      bitbucketConnectionId: true,
      bitbucketToken: true,
      bitbucketUsername: true,
      createdById: true,
      name: true,
      gitRepoPath: true,
      stakeholderEmails: true,
    },
  });
  try {
    await resolveScmCredentialsFromProject(project);
  } catch {
    return { ok: false, reason: "no_token" };
  }

  const pendingMid = Number(conv.pendingClientChatMessageId);
  const pendingOk = Number.isInteger(pendingMid) && pendingMid > 0;

  const syncConv = {
    pendingClientChatMessageId: conv.pendingClientChatMessageId,
    releaseId: conv.releaseId,
    projectId: conv.projectId,
  };
  await syncPendingMessageCommitSha(project, syncConv);

  let requestedSha = null;
  if (pendingOk) {
    const ch = await prisma.chatHistory.findFirst({
      where: {
        id: pendingMid,
        projectId: project.id,
        releaseId: conv.releaseId,
        role: "user",
      },
      select: { appliedCommitSha: true },
    });
    requestedSha = ch?.appliedCommitSha?.trim() || null;
  }
  if (!requestedSha && conv.targetBranchName?.trim()) {
    try {
      const repo = await resolveClientChatRepository(project);
      const head = await scmGetBranchSha(
        repo.provider,
        repo.owner,
        repo.repo,
        conv.targetBranchName.trim(),
        repo.token,
      );
      requestedSha = head?.sha || null;
      if (requestedSha && pendingOk) {
        await prisma.chatHistory.updateMany({
          where: {
            id: pendingMid,
            projectId: project.id,
            releaseId: conv.releaseId,
            role: "user",
          },
          data: { appliedCommitSha: requestedSha },
        });
      }
    } catch {
      /* ignore */
    }
  }

  const msgIdForMerge = pendingOk ? pendingMid : null;
  if (!requestedSha || !GIT_SHA_RE.test(requestedSha)) {
    console.warn("[chat] clientLinkAutoMergeFromAgentPoll: no valid SHA yet", { agentId: aid });
    return { ok: false, reason: "no_sha" };
  }

  try {
    await executeClientLinkLaunchpadMerge(project, conv.releaseId, requestedSha, msgIdForMerge);
  } catch (err) {
    console.error("[chat] clientLinkAutoMergeFromAgentPoll: merge failed", {
      agentId: aid,
      error: err?.message || err,
    });
    return { ok: false, reason: "merge_failed", error: err?.message };
  }

  return { ok: true };
}

/** Public: merge agent branch to launchpad after user confirms (client-link deferred flows only). */
export async function clientLinkConfirmLaunchpadMerge({
  slug,
  releaseId,
  commitSha = null,
  messageId = null,
  clientEmail,
}) {
  const project = await resolveProjectBySlug(slug);
  assertPublicClientStakeholderEmail(project.stakeholderEmails, clientEmail);
  const release = await assertReleaseBelongs(releaseId, project.id);
  assertReleaseNotLocked(release);

  const msgId =
    messageId != null && Number.isInteger(Number(messageId)) && Number(messageId) > 0
      ? Number(messageId)
      : null;

  const requestedSha = typeof commitSha === "string" ? commitSha.trim() : "";
  await executeClientLinkLaunchpadMerge(project, Number(releaseId), requestedSha, msgId);
  return { ok: true };
}

/**
 * Public: Point `launchpad` at this chat's merged commit (later merged chats drop off the live line),
 * full deploy so preview matches, clear merged state for newer user messages on this release.
 */
export async function clientLinkRevertMergedMessage({
  slug,
  releaseId,
  messageId,
  clientEmail,
}) {
  const project = await resolveProjectBySlug(slug);
  assertPublicClientStakeholderEmail(project.stakeholderEmails, clientEmail);
  const release = await assertReleaseBelongs(releaseId, project.id);
  assertReleaseNotLocked(release);

  const mid = Number(messageId);
  if (!Number.isInteger(mid) || mid < 1) {
    throw new ApiError(400, "Invalid message id.");
  }

  const row = await prisma.chatHistory.findFirst({
    where: {
      id: mid,
      projectId: project.id,
      releaseId: Number(releaseId),
      role: "user",
    },
    select: {
      id: true,
      appliedCommitSha: true,
      mergedAt: true,
      revertedAt: true,
      createdAt: true,
    },
  });
  if (!row) {
    throw new ApiError(404, "Message not found.");
  }
  if (!row.mergedAt) {
    throw new ApiError(400, "Only merged messages can be restored from.");
  }

  const targetSha =
    typeof row.appliedCommitSha === "string" ? row.appliedCommitSha.trim() : "";
  if (!GIT_SHA_RE.test(targetSha)) {
    throw new ApiError(400, "No valid commit SHA stored for this message.");
  }

  const repoCtx = await resolveClientChatRepository(project);
  const { owner, repo, token, provider } = repoCtx;

  // Same deploy primitive as merge: force `launchpad` to this SHA. Do not require git ancestry to
  // current launchpad — each chat uses its own agent branch; history is not always linear even when
  // previews stack correctly. We only require the commit to still exist on the remote.
  const commitOk = await scmGetCommitInfo(provider, owner, repo, targetSha, token);
  if (!commitOk.ok) {
    throw new ApiError(
      400,
      "This chat's saved commit was not found on the repository (it may have been removed or the SHA is invalid).",
    );
  }

  const conversion = await prisma.figmaConversion.findFirst({
    where: { projectId: project.id, releaseId: Number(releaseId) },
    orderBy: { id: "desc" },
    select: {
      id: true,
      projectId: true,
      releaseId: true,
      attemptedById: true,
    },
  });
  if (!conversion) {
    throw new ApiError(500, "No conversion record for this release.");
  }

  try {
    await executeLaunchpadHeadDeploy(conversion, targetSha, "launchpad", {
      skipShaDedupe: true,
    });
  } catch (deployErr) {
    throw new ApiError(502, deployErr?.message || "Deploy after restore failed.");
  }

  await prisma.$transaction([
    prisma.chatHistory.updateMany({
      where: {
        projectId: project.id,
        releaseId: Number(releaseId),
        role: "user",
        OR: [
          { createdAt: { gt: row.createdAt } },
          {
            AND: [{ createdAt: row.createdAt }, { id: { gt: mid } }],
          },
        ],
      },
      data: {
        mergedAt: null,
        revertedAt: null,
        revertCommitSha: null,
      },
    }),
    prisma.chatHistory.update({
      where: { id: mid },
      data: {
        revertCommitSha: targetSha,
      },
    }),
  ]);

  return { ok: true, sha: targetSha };
}

/**
 * Public: deploy a saved release version to the project folder and mark it active
 * (restore / roll back live site).
 */
export async function clientLinkRestoreVersion({
  slug,
  releaseId,
  versionId,
  clientEmail,
}) {
  const project = await resolveProjectBySlug(slug);
  assertPublicClientStakeholderEmail(project.stakeholderEmails, clientEmail);
  const release = await assertReleaseBelongs(releaseId, project.id);
  assertReleaseNotLocked(release);

  const vid = Number(versionId);
  if (!Number.isInteger(vid) || vid < 1) {
    throw new ApiError(400, "Invalid version");
  }

  const version = await prisma.projectVersion.findFirst({
    where: { id: vid, projectId: project.id, releaseId: Number(releaseId) },
    select: {
      id: true,
      version: true,
      gitTag: true,
    },
  });
  if (!version) {
    throw new ApiError(404, "Version not found for this release");
  }

  const user = await prisma.user.findUnique({
    where: { id: project.assignedManagerId },
  });
  if (!user) {
    throw new ApiError(500, "Project has no assigned manager");
  }

  const deployed = await deployVersionArtifactsToProjectFolder({
    projectId: project.id,
    versionId: vid,
    user,
  });

  await prisma.$transaction([
    prisma.projectVersion.updateMany({
      where: { projectId: project.id },
      data: { isActive: false },
    }),
    prisma.projectVersion.update({
      where: { id: vid },
      data: { isActive: true },
    }),
  ]);

  return {
    ok: true,
    buildUrl: deployed.buildUrl,
    version: deployed.version,
    tag: deployed.tag,
  };
}

/** Public: preview chat branch at a specific commit (or its parent) without merging live. */
export async function clientLinkPreviewCommit({
  slug,
  releaseId,
  commitSha,
  before = false,
  messageId = null,
  clientEmail,
}) {
  const project = await resolveProjectBySlug(slug);
  assertPublicClientStakeholderEmail(project.stakeholderEmails, clientEmail);
  const release = await assertReleaseBelongs(releaseId, project.id);
  assertReleaseNotLocked(release);

  const inputSha = typeof commitSha === "string" ? commitSha.trim() : "";
  if (!GIT_SHA_RE.test(inputSha)) {
    throw new ApiError(400, "Valid commit SHA is required.");
  }

  const repo = await assertShaOnTrackedAgentBranch(
    project,
    Number(releaseId),
    inputSha,
    messageId,
  );
  let targetSha = inputSha;
  if (before) {
    const commit = await scmGetCommitInfo(
      repo.provider,
      repo.owner,
      repo.repo,
      inputSha,
      repo.token,
    );
    if (!commit.ok) {
      throw new ApiError(400, `Could not resolve commit parent: ${commit.message}`);
    }
    const parentSha = commit.parents?.[0];
    if (!parentSha) {
      throw new ApiError(400, "No previous commit exists before this change.");
    }
    await assertShaOnTrackedAgentBranch(
      project,
      Number(releaseId),
      parentSha,
      messageId,
    );
    targetSha = parentSha;
  }

  const preview = await buildProjectPreviewFromGitRef({
    projectId: project.id,
    gitRef: targetSha,
    label: `commit ${targetSha.slice(0, 7)}`,
  });

  return {
    ok: true,
    buildUrl: preview.buildUrl,
    commitSha: targetSha,
    cached: Boolean(preview.cached),
  };
}
