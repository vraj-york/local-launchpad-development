import { PrismaClient, ReleaseStatus } from "@prisma/client";
import ApiError from "../utils/apiError.js";
import {
  cursorRequest,
  startAgentPolling,
} from "./cursor.service.js";

const prisma = new PrismaClient();

/** Resolve project by public slug (no client secret for now). */
export async function resolveProjectBySlug(slug) {
  const s = typeof slug === "string" ? slug.trim() : "";
  if (!s) throw new ApiError(400, "Invalid slug");

  const project = await prisma.project.findUnique({
    where: { slug: s },
    select: {
      id: true,
      slug: true,
    },
  });
  if (!project) {
    console.warn("[client-link] project not found for slug", { slug: s });
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

function latestConversionForRelease(releaseId) {
  return prisma.figmaConversion.findFirst({
    where: { releaseId },
    orderBy: { id: "desc" },
    select: {
      id: true,
      agentId: true,
      releaseId: true,
      projectId: true,
      status: true,
    },
  });
}

/**
 * POST follow-up prompt (public).
 */
export async function clientLinkFollowup({ slug, releaseId, promptText }) {
  const project = await resolveProjectBySlug(slug);
  const release = await assertReleaseBelongs(releaseId, project.id);
  assertReleaseNotLocked(release);

  const text = typeof promptText === "string" ? promptText.trim() : "";
  if (!text) {
    throw new ApiError(400, "Message required");
  }

  const conv = await latestConversionForRelease(Number(releaseId));
  if (!conv?.agentId) {
    console.warn("[client-link] followup: no agent for release", {
      releaseId,
      projectId: project.id,
    });
    throw new ApiError(400, "No agent is linked to this release yet.");
  }

  if (!process.env.CURSOR_API_KEY?.trim()) {
    console.error("[client-link] CURSOR_API_KEY missing");
    throw new ApiError(503, "Chat is temporarily unavailable.");
  }

  console.log("[client-link] followup", {
    projectId: project.id,
    releaseId: Number(releaseId),
    agentIdPrefix: String(conv.agentId).slice(0, 8),
    promptLen: text.length,
  });

  const { status, data } = await cursorRequest({
    method: "POST",
    path: `/v0/agents/${encodeURIComponent(conv.agentId)}/followup`,
    body: { prompt: { text } },
  });

  if (status < 200 || status >= 300) {
    console.warn("[client-link] Cursor followup failed", { status, data });
    throw new ApiError(
      status >= 400 && status < 500 ? status : 502,
      typeof data?.error === "string"
        ? data.error
        : "Could not send message to agent",
    );
  }

  startAgentPolling(conv.agentId);

  return { ok: true, agentStatus: data?.status || null };
}

/**
 * Sanitized agent status for client UI.
 */
export async function clientLinkAgentStatus({ slug, releaseId }) {
  const project = await resolveProjectBySlug(slug);
  await assertReleaseBelongs(releaseId, project.id);

  const conv = await latestConversionForRelease(Number(releaseId));
  if (!conv?.agentId) {
    return { hasAgent: false, status: null };
  }

  if (!process.env.CURSOR_API_KEY?.trim()) {
    return { hasAgent: true, status: null, error: "unconfigured" };
  }

  try {
    const { status, data } = await cursorRequest({
      method: "GET",
      path: `/v0/agents/${encodeURIComponent(conv.agentId)}`,
    });
    if (status !== 200 || !data) {
      console.warn("[client-link] agent status non-200", { status });
      return {
        hasAgent: true,
        status: null,
        error: "status_unavailable",
      };
    }
    const st = data.status != null ? String(data.status) : null;
    return {
      hasAgent: true,
      status: st,
      prUrl:
        typeof data.target?.prUrl === "string"
          ? data.target.prUrl
          : typeof data.source?.prUrl === "string"
            ? data.source.prUrl
            : null,
    };
  } catch (e) {
    console.error("[client-link] agent status error", e?.message || e);
    return { hasAgent: true, status: null, error: "poll_failed" };
  }
}
