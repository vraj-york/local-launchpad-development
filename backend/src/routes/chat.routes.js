import express from "express";
import { chatController } from "../controllers/chat.controller.js";

const router = express.Router();

/** POST /api/chat/:slug/ai-preview-svg — AI SVG from reference image (Anthropic proxied; same gate as followup). */
router.post("/:slug/ai-preview-svg", chatController.aiPreviewSvg);

/** POST /api/chat/:slug/followup — send chat / follow-up */
router.post("/:slug/followup", chatController.followup);

/** GET /api/chat/:slug/agent-status — agent status */
router.get("/:slug/agent-status", chatController.agentStatus);

/** GET /api/chat/:slug/summary — post-execution change summary */
router.get("/:slug/summary", chatController.summary);

/** GET /api/chat/:slug/messages?r= — persisted chat history */
router.get("/:slug/messages", chatController.messages);

/** POST /api/chat/:slug/refresh-build — re-checkout active version tag, rebuild, redeploy live folder */
router.post("/:slug/refresh-build", chatController.refreshBuild);

/** POST /api/chat/:slug/revert-merge — git revert the message's commit on the agent branch, then merge to launchpad */
router.post("/:slug/revert-merge", chatController.revertMerge);

export default router;
