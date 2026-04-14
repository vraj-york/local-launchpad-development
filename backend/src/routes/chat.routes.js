import express from "express";
import {
  clientLinkFollowup,
  clientLinkAgentStatus,
  clientLinkExecutionSummary,
  clientLinkListChatMessages,
  clientLinkRevertMergedMessage,
  clientLinkRefreshLiveBuild,
} from "../services/chat.service.js";
import ApiError from "../utils/apiError.js";

const router = express.Router();

function readReleaseId(body, query) {
  const raw =
    body?.r ?? body?.releaseId ?? query?.r ?? query?.releaseId;
  const r0 = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(r0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function readClientEmail(body) {
  const raw = body?.clientEmail ?? body?.e ?? body?.lockedBy;
  if (typeof raw !== "string") return "";
  return raw.trim();
}

/** POST /api/chat/:slug/followup — send chat / follow-up */
router.post("/:slug/followup", async (req, res) => {
  const slug = req.params.slug;
  const releaseId = readReleaseId(req.body, req.query);
  const t =
    typeof req.body?.t === "string"
      ? req.body.t
      : typeof req.body?.text === "string"
        ? req.body.text
        : typeof req.body?.m === "string"
          ? req.body.m
          : "";
  try {
    if (!releaseId) {
      return res.status(400).json({ error: "Release (r) required" });
    }
    const replacementImage =
      req.body?.replacementImage != null &&
      typeof req.body.replacementImage === "object" &&
      !Array.isArray(req.body.replacementImage)
        ? req.body.replacementImage
        : null;
    const referenceImage =
      req.body?.referenceImage != null &&
      typeof req.body.referenceImage === "object" &&
      !Array.isArray(req.body.referenceImage)
        ? req.body.referenceImage
        : null;
    const referenceImages = Array.isArray(req.body?.referenceImages)
      ? req.body.referenceImages
      : null;

    const result = await clientLinkFollowup({
      slug,
      releaseId,
      promptText: t,
      clientEmail: readClientEmail(req.body),
      replacementImage,
      referenceImage,
      referenceImages,
    });
    return res.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      const body = { error: err.message };
      if (err.code) body.code = err.code;
      return res.status(err.statusCode).json(body);
    }
    return res.status(500).json({ error: "Server error" });
  }
});

/** GET /api/chat/:slug/agent-status — agent status */
router.get("/:slug/agent-status", async (req, res) => {
  const slug = req.params.slug;
  const releaseId = readReleaseId({}, req.query);
  try {
    if (!releaseId) return res.status(400).json({ error: "Release (r) required" });
    const result = await clientLinkAgentStatus({
      slug,
      releaseId,
    });
    return res.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

/** GET /api/chat/:slug/summary — post-execution change summary */
router.get("/:slug/summary", async (req, res) => {
  const slug = req.params.slug;
  const releaseId = readReleaseId({}, req.query);
  try {
    if (!releaseId) return res.status(400).json({ error: "Release (r) required" });
    const result = await clientLinkExecutionSummary({
      slug,
      releaseId,
    });
    return res.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

/** GET /api/chat/:slug/messages?r= — persisted chat history */
router.get("/:slug/messages", async (req, res) => {
  const slug = req.params.slug;
  const releaseId = readReleaseId({}, req.query);
  try {
    if (!releaseId) return res.status(400).json({ error: "Release (r) required" });
    const result = await clientLinkListChatMessages({ slug, releaseId });
    return res.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

/** POST /api/chat/:slug/refresh-build — re-checkout active version tag, rebuild, redeploy live folder */
router.post("/:slug/refresh-build", async (req, res) => {
  const slug = req.params.slug;
  const releaseId = readReleaseId(req.body, req.query);
  try {
    const result = await clientLinkRefreshLiveBuild({
      slug,
      releaseId,
      clientEmail: readClientEmail(req.body),
    });
    return res.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

/** POST /api/chat/:slug/revert-merge — git revert the message's commit on the agent branch, then merge to launchpad */
router.post("/:slug/revert-merge", async (req, res) => {
  const slug = req.params.slug;
  const releaseId = readReleaseId(req.body, req.query);
  const rawMsgId = req.body?.m ?? req.body?.messageId;
  const messageId =
    rawMsgId != null && rawMsgId !== ""
      ? Number(Array.isArray(rawMsgId) ? rawMsgId[0] : rawMsgId)
      : null;
  try {
    if (!releaseId) return res.status(400).json({ error: "Release (r) required" });
    if (!Number.isInteger(messageId) || messageId < 1) {
      return res.status(400).json({ error: "Message id (m) required" });
    }
    const result = await clientLinkRevertMergedMessage({
      slug,
      releaseId,
      messageId,
      clientEmail: readClientEmail(req.body),
    });
    return res.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
