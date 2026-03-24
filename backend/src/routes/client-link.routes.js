import express from "express";
import {
  clientLinkFollowup,
  clientLinkAgentStatus,
} from "../services/client-link.service.js";
import ApiError from "../utils/apiError.js";

const router = express.Router();

function readReleaseId(body, query) {
  const raw =
    body?.r ?? body?.releaseId ?? query?.r ?? query?.releaseId;
  const r0 = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(r0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** POST /api/p/:slug/q — send chat / follow-up */
router.post("/:slug/q", async (req, res) => {
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
    });
    return res.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn("[client-link] POST q", err.statusCode, err.message);
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("[client-link] POST q unexpected", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/** GET /api/p/:slug/st — agent status */
router.get("/:slug/st", async (req, res) => {
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
    console.error("[client-link] GET st unexpected", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
