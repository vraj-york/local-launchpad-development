import { prisma } from "../lib/prisma.js";
import ApiError from "../utils/apiError.js";
import { assertPublicClientStakeholderEmail } from "../utils/publicClientStakeholder.utils.js";
import {
  FEEDBACK_RECORDING_MAX_CHUNKS,
} from "../utils/feedbackRecording.constants.js";

/**
 * @param {string} contentType
 * @returns {string|null} file extension without dot
 */
export function extForRecordingContentType(contentType) {
  const ct = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (ct === "video/webm" || ct === "video/x-matroska") return "webm";
  if (ct === "video/mp4" || ct === "video/quicktime") return "mp4";
  return null;
}

/**
 * @param {number|string} projectId
 */
export async function assertRecordingStakeholder(projectId, clientEmailRaw) {
  const project = await prisma.project.findUnique({
    where: { id: Number(projectId) },
    select: { id: true, stakeholderEmails: true },
  });
  if (!project) {
    throw new ApiError(404, "Project not found.");
  }
  assertPublicClientStakeholderEmail(
    project.stakeholderEmails,
    clientEmailRaw,
    { context: "issueReporter" },
  );
  return project;
}

/**
 * @param {{
 *   sessionId: string;
 *   projectId: number;
 *   clientEmail: string;
 *   recordingChunkCount?: number;
 * }} opts
 */
export async function getRecordingSessionForFeedbackSubmit({
  sessionId,
  projectId,
  clientEmail,
  recordingChunkCount,
}) {
  const email =
    typeof clientEmail === "string" ? clientEmail.trim().toLowerCase() : "";
  const session = await prisma.feedbackRecordingSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    throw new ApiError(400, "Invalid recording session.");
  }
  if (session.projectId !== projectId) {
    throw new ApiError(400, "Recording session does not match this project.");
  }
  if (session.reporterEmail !== email) {
    throw new ApiError(400, "Recording session does not match this email.");
  }
  if (
    session.status !== "uploading" &&
    session.status !== "ready_for_merge"
  ) {
    throw new ApiError(
      400,
      "Recording session is not eligible for feedback submit.",
    );
  }

  const count =
    typeof recordingChunkCount === "number" &&
    Number.isFinite(recordingChunkCount)
      ? Math.floor(recordingChunkCount)
      : session.chunkCount;
  if (count == null || count < 1) {
    throw new ApiError(
      400,
      "recordingChunkCount is required when attaching a screen recording.",
    );
  }
  if (count > FEEDBACK_RECORDING_MAX_CHUNKS) {
    throw new ApiError(400, "Recording exceeds maximum length.");
  }

  await prisma.feedbackRecordingSession.update({
    where: { id: session.id },
    data: {
      chunkCount: count,
      status: "ready_for_merge",
    },
  });

  return { ...session, chunkCount: count, status: "ready_for_merge" };
}
