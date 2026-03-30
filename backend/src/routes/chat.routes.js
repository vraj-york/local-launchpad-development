import express from "express";
import {
  clientLinkFollowup,
  clientLinkAgentStatus,
  clientLinkExecutionSummary,
  clientLinkListChatMessages,
  clientLinkConfirmLaunchpadMerge,
  clientLinkPreviewCommit,
  clientLinkRestoreVersion,
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
    const result = await clientLinkFollowup({
      slug,
      releaseId,
      promptText: t,
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

/** POST /api/chat/:slug/confirm-merge — merge agent work to launchpad after user confirms */
router.post("/:slug/confirm-merge", async (req, res) => {
  const slug = req.params.slug;
  const releaseId = readReleaseId(req.body, req.query);
  const sha = req.body?.sha ?? req.body?.commitSha;
  const rawMsgId = req.body?.m ?? req.body?.messageId;
  const messageId =
    rawMsgId != null && rawMsgId !== ""
      ? Number(Array.isArray(rawMsgId) ? rawMsgId[0] : rawMsgId)
      : null;
  try {
    if (!releaseId) return res.status(400).json({ error: "Release (r) required" });
    const result = await clientLinkConfirmLaunchpadMerge({
      slug,
      releaseId,
      commitSha: sha,
      messageId:
        Number.isInteger(messageId) && messageId > 0 ? messageId : null,
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

/** POST /api/chat/:slug/restore-version — body: r, versionId */
router.post("/:slug/restore-version", async (req, res) => {
  const slug = req.params.slug;
  const releaseId = readReleaseId(req.body, req.query);
  const vid = req.body?.versionId ?? req.body?.v;
  try {
    if (!releaseId) return res.status(400).json({ error: "Release (r) required" });
    const result = await clientLinkRestoreVersion({
      slug,
      releaseId,
      versionId: vid,
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

/** POST /api/chat/:slug/preview-commit — body: r, sha, before?, m|messageId */
router.post("/:slug/preview-commit", async (req, res) => {
  const slug = req.params.slug;
  const releaseId = readReleaseId(req.body, req.query);
  const sha = req.body?.sha ?? req.body?.commitSha;
  const before = req.body?.before === true || req.body?.mode === "before";
  const rawMsgId = req.body?.m ?? req.body?.messageId;
  const messageId =
    rawMsgId != null && rawMsgId !== ""
      ? Number(Array.isArray(rawMsgId) ? rawMsgId[0] : rawMsgId)
      : null;
  try {
    if (!releaseId) return res.status(400).json({ error: "Release (r) required" });
    const result = await clientLinkPreviewCommit({
      slug,
      releaseId,
      commitSha: sha,
      before,
      messageId:
        Number.isInteger(messageId) && messageId > 0 ? messageId : null,
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
