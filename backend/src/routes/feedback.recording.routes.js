import express from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import ApiError from "../utils/apiError.js";
import { getPresignedPutUrl } from "../utils/presignS3Put.js";
import {
  assertRecordingStakeholder,
  extForRecordingContentType,
} from "../services/feedbackRecording.service.js";
import {
  FEEDBACK_RECORDING_MAX_CHUNKS,
  FEEDBACK_RECORDING_MAX_CHUNK_BYTES,
  FEEDBACK_RECORDING_PRESIGN_EXPIRES_SEC,
  feedbackRecordingChunkObjectKey,
  feedbackRecordingKeyPrefix,
} from "../utils/feedbackRecording.constants.js";

const router = express.Router();

function parseBodyString(body, key) {
  const v = body?.[key];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * POST /api/feedback/recording/sessions
 * JSON: { projectId, clientEmail }
 */
router.post("/recording/sessions", express.json(), async (req, res) => {
  try {
    const projectIdRaw = parseBodyString(req.body, "projectId");
    const clientEmail = parseBodyString(req.body, "clientEmail");
    if (!projectIdRaw) {
      return res.status(400).json({
        success: false,
        message: "projectId is required for screen recording.",
      });
    }
    await assertRecordingStakeholder(projectIdRaw, clientEmail);

    const sessionToken = crypto.randomBytes(32).toString("hex");
    const session = await prisma.feedbackRecordingSession.create({
      data: {
        projectId: Number(projectIdRaw),
        reporterEmail: clientEmail.trim().toLowerCase(),
        sessionToken,
        status: "uploading",
      },
    });

    return res.status(201).json({
      success: true,
      sessionId: session.id,
      sessionToken: session.sessionToken,
      uploadPrefix: feedbackRecordingKeyPrefix(session.id),
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return res
        .status(err.statusCode)
        .json({ success: false, message: err.message });
    }
    console.error("[feedback-recording] create session:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to start recording session.",
    });
  }
});

/**
 * POST /api/feedback/recording/sessions/:id/chunk-upload-url
 * JSON: { sessionToken, chunkIndex, contentType, contentLength? }
 */
router.post(
  "/recording/sessions/:id/chunk-upload-url",
  express.json(),
  async (req, res) => {
    try {
      const sessionId = req.params.id;
      const sessionToken = parseBodyString(req.body, "sessionToken");
      const contentType = parseBodyString(req.body, "contentType");
      const chunkIndex = Number(req.body?.chunkIndex);
      const contentLength = req.body?.contentLength;

      if (!sessionToken) {
        return res.status(400).json({
          success: false,
          message: "sessionToken is required.",
        });
      }
      if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
        return res.status(400).json({
          success: false,
          message: "chunkIndex must be a non-negative integer.",
        });
      }
      if (chunkIndex >= FEEDBACK_RECORDING_MAX_CHUNKS) {
        return res.status(400).json({
          success: false,
          message: "Recording exceeds maximum length.",
        });
      }

      const ext = extForRecordingContentType(contentType);
      if (!ext) {
        return res.status(400).json({
          success: false,
          message:
            "Unsupported contentType. Use video/webm or video/mp4 (or video/quicktime).",
        });
      }

      if (
        contentLength != null &&
        (typeof contentLength !== "number" || contentLength > FEEDBACK_RECORDING_MAX_CHUNK_BYTES)
      ) {
        return res.status(400).json({
          success: false,
          message: `contentLength must not exceed ${FEEDBACK_RECORDING_MAX_CHUNK_BYTES} bytes.`,
        });
      }

      const session = await prisma.feedbackRecordingSession.findUnique({
        where: { id: sessionId },
      });
      if (!session || session.sessionToken !== sessionToken) {
        return res.status(403).json({
          success: false,
          message: "Invalid recording session.",
        });
      }
      if (session.status !== "uploading") {
        return res.status(400).json({
          success: false,
          message: "Recording session is not accepting chunks.",
        });
      }

      const key = feedbackRecordingChunkObjectKey(sessionId, chunkIndex, ext);
      const uploadUrl = await getPresignedPutUrl({
        key,
        contentType: contentType.split(";")[0].trim(),
        expiresIn: FEEDBACK_RECORDING_PRESIGN_EXPIRES_SEC,
      });

      return res.status(200).json({
        success: true,
        uploadUrl,
        key,
        headers: {
          "Content-Type": contentType.split(";")[0].trim(),
        },
        expiresInSeconds: FEEDBACK_RECORDING_PRESIGN_EXPIRES_SEC,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        return res
          .status(err.statusCode)
          .json({ success: false, message: err.message });
      }
      console.error("[feedback-recording] chunk-url:", err);
      return res.status(500).json({
        success: false,
        message: err.message || "Failed to presign chunk upload.",
      });
    }
  },
);

/**
 * POST /api/feedback/recording/sessions/:id/complete
 * JSON: { sessionToken, chunkCount }
 */
router.post(
  "/recording/sessions/:id/complete",
  express.json(),
  async (req, res) => {
    try {
      const sessionId = req.params.id;
      const sessionToken = parseBodyString(req.body, "sessionToken");
      const chunkCount = Number(req.body?.chunkCount);

      if (!sessionToken) {
        return res.status(400).json({
          success: false,
          message: "sessionToken is required.",
        });
      }
      if (!Number.isInteger(chunkCount) || chunkCount < 1) {
        return res.status(400).json({
          success: false,
          message: "chunkCount must be a positive integer.",
        });
      }
      if (chunkCount > FEEDBACK_RECORDING_MAX_CHUNKS) {
        return res.status(400).json({
          success: false,
          message: "Recording exceeds maximum length.",
        });
      }

      const session = await prisma.feedbackRecordingSession.findUnique({
        where: { id: sessionId },
      });
      if (!session || session.sessionToken !== sessionToken) {
        return res.status(403).json({
          success: false,
          message: "Invalid recording session.",
        });
      }
      if (session.status !== "uploading") {
        return res.status(400).json({
          success: false,
          message: "Recording session already finalized.",
        });
      }

      await prisma.feedbackRecordingSession.update({
        where: { id: sessionId },
        data: {
          chunkCount,
          status: "ready_for_merge",
        },
      });

      return res.status(200).json({ success: true });
    } catch (err) {
      if (err instanceof ApiError) {
        return res
          .status(err.statusCode)
          .json({ success: false, message: err.message });
      }
      console.error("[feedback-recording] complete:", err);
      return res.status(500).json({
        success: false,
        message: err.message || "Failed to complete recording session.",
      });
    }
  },
);

export default router;
