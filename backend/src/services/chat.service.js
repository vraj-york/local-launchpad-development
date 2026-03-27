import { PrismaClient, ReleaseStatus } from "@prisma/client";
import validator from "validator";
import ApiError from "../utils/apiError.js";
import { parseStoredEmailListToSet } from "../utils/emailList.utils.js";
import {
  createAgentForProjectRelease,
  getCursorAgentById,
  isCursorAgentSuccessTerminal,
  performMergeToLaunchpadAtCommit,
  postCursorAgentFollowup,
  resolveCursorRepositoryUrl,
} from "./cursor.service.js";
import {
  compareRefs,
  parseGitRepoPath,
  getBranchSha,
  getCommitInfo,
} from "./github.service.js";
import {
  buildProjectPreviewFromGitRef,
  deployVersionArtifactsToProjectFolder,
} from "./project.service.js";

const prisma = new PrismaClient();
const GIT_SHA_RE = /^[0-9a-f]{7,40}$/i;

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
      "Could not determine the GitHub repository URL for this project.",
    );
  }

  if (resolved.gitRepoPathToPersist) {
    await prisma.project.update({
      where: { id: project.id },
      data: { gitRepoPath: resolved.gitRepoPathToPersist },
    });
    project.gitRepoPath = resolved.gitRepoPathToPersist;
  }

  const parsed = parseGitRepoPath(resolved.repositoryUrl);
  if (!parsed) {
    throw new ApiError(400, "Invalid GitHub repository URL format.");
  }
  if (!project.githubToken?.trim()) {
    throw new ApiError(400, "GitHub token is not configured for this project.");
  }
  return { owner: parsed.owner, repo: parsed.repo, token: project.githubToken.trim() };
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
    const head = await getBranchSha(repo.owner, repo.repo, branch, repo.token);
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
    const cmp = await compareRefs(repo.owner, repo.repo, sha, branch, repo.token);
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

async function createClientChatAgent({ project, releaseId, text }) {
  const cursorAgentCreateInput = {
    projectId: project.id,
    releaseId: Number(releaseId),
    attemptedById: project.assignedManagerId,
    prompt: { text },
    model: "composer-1.5",
    deferLaunchpadMerge: true,
    omitTargetFromBody: true,
  };
  return createAgentForProjectRelease({
    ...cursorAgentCreateInput,
    silentCursorApiLog: true,
  });
}

/**
 * POST follow-up prompt (public).
 */
export async function clientLinkFollowup({ slug, releaseId, promptText, clientEmail }) {
  const project = await resolveProjectBySlug(slug);
  assertPublicClientStakeholderEmail(project.stakeholderEmails, clientEmail);
  const release = await assertReleaseBelongs(releaseId, project.id);
  assertReleaseNotLocked(release);

  const text = typeof promptText === "string" ? promptText.trim() : "";
  if (!text) {
    throw new ApiError(400, "Message required");
  }

  const userMessage = await prisma.chatHistory.create({
    data: {
      projectId: project.id,
      releaseId: Number(releaseId),
      role: "user",
      text,
    },
  });

  if (!process.env.CURSOR_API_KEY?.trim()) {
    throw new ApiError(503, "Chat is temporarily unavailable.");
  }

  let conv = await latestConversionForRelease(project.id, Number(releaseId));
  if (shouldCreateFreshClientAgent(conv)) {
    try {
      const result = await createClientChatAgent({
        project,
        releaseId: Number(releaseId),
        text,
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
    ({ status, data } = await postCursorAgentFollowup(conv.agentId, { text }, {
      silent: true,
    }));
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

  if (!project.githubToken?.trim() || !project.gitRepoPath?.trim()) {
    return {
      ok: true,
      ready: true,
      summaryLines: [
        `Created version ${currentVersion.version} (${currentVersion.gitTag}).`,
        "Could not compare against previous version because GitHub token/repository path is not configured.",
      ],
      stats: null,
      files: [],
    };
  }
  const parsedRepo = parseGitRepoPath(project.gitRepoPath);
  if (!parsedRepo) {
    return {
      ok: true,
      ready: true,
      summaryLines: [
        `Created version ${currentVersion.version} (${currentVersion.gitTag}).`,
        "Could not compare versions because gitRepoPath format is invalid.",
      ],
      stats: null,
      files: [],
    };
  }

  const compare = await compareRefs(
    parsedRepo.owner,
    parsedRepo.repo,
    previousVersion.gitTag,
    currentVersion.gitTag,
    project.githubToken.trim(),
  );
  if (!compare.ok) {
    return {
      ok: true,
      ready: true,
      summaryLines: [
        `Created version ${currentVersion.version} (${currentVersion.gitTag}).`,
        `Could not generate GitHub compare summary: ${compare.message}.`,
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
      createdAt: r.createdAt,
    })),
  };
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

  if (!process.env.CURSOR_API_KEY?.trim()) {
    throw new ApiError(503, "Chat is temporarily unavailable.");
  }

  const requestedSha = typeof commitSha === "string" ? commitSha.trim() : "";
  if (!GIT_SHA_RE.test(requestedSha)) {
    throw new ApiError(400, "Applied commit SHA is required to confirm merge.");
  }
  const projectRepo = await resolveClientChatRepository(project);

  const rows = await prisma.figmaConversion.findMany({
    where: {
      projectId: project.id,
      releaseId: Number(releaseId),
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

  const msgId =
    messageId != null && Number.isInteger(Number(messageId)) && Number(messageId) > 0
      ? Number(messageId)
      : null;
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
    const cmp = await compareRefs(
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
        releaseId: Number(releaseId),
        id: msgId,
        role: "user",
      },
      data: { mergedAt: new Date() },
    });
  } else {
    await prisma.chatHistory.updateMany({
      where: {
        projectId: project.id,
        releaseId: Number(releaseId),
        role: "user",
        appliedCommitSha: requestedSha,
      },
      data: { mergedAt: new Date() },
    });
  }

  return { ok: true };
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
    const commit = await getCommitInfo(repo.owner, repo.repo, inputSha, repo.token);
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
