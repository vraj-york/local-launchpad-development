import asyncHandler from "../middleware/asyncHandler.middleware.js";
import {
  clientLinkFollowup,
  clientLinkAgentStatus,
  clientLinkExecutionSummary,
  clientLinkListChatMessages,
  clientLinkRevertMergedMessage,
  clientLinkRefreshLiveBuild,
  clientLinkAiPreviewSvg,
} from "../services/chat.service.js";
import ApiError from "../utils/apiError.js";
import { readReleaseId, readClientEmail } from "../utils/chatRequest.utils.js";

export const chatController = {
  aiPreviewSvg: asyncHandler(async (req, res) => {
    const slug = req.params.slug;
    const releaseId = readReleaseId(req.body, req.query);
    if (!releaseId) {
      throw new ApiError(400, "Release (r) required");
    }
    const body = req.body || {};
    const result = await clientLinkAiPreviewSvg({
      slug,
      releaseId,
      clientEmail: readClientEmail(req.body),
      imageBase64: body.imageBase64,
      mediaType: body.mediaType,
      fileName: body.fileName,
      width: body.width,
      height: body.height,
      animate: body.animate,
      customPrompt: body.customPrompt,
    });
    res.json(result);
  }),

  followup: asyncHandler(async (req, res) => {
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
    if (!releaseId) {
      throw new ApiError(400, "Release (r) required");
    }
    const replacementImage =
      req.body?.replacementImage != null &&
      typeof req.body.replacementImage === "object" &&
      !Array.isArray(req.body.replacementImage)
        ? req.body.replacementImage
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
      referenceImages,
    });
    res.json(result);
  }),

  agentStatus: asyncHandler(async (req, res) => {
    const slug = req.params.slug;
    const releaseId = readReleaseId({}, req.query);
    if (!releaseId) {
      throw new ApiError(400, "Release (r) required");
    }
    const result = await clientLinkAgentStatus({
      slug,
      releaseId,
    });
    res.json(result);
  }),

  summary: asyncHandler(async (req, res) => {
    const slug = req.params.slug;
    const releaseId = readReleaseId({}, req.query);
    if (!releaseId) {
      throw new ApiError(400, "Release (r) required");
    }
    const result = await clientLinkExecutionSummary({
      slug,
      releaseId,
    });
    res.json(result);
  }),

  messages: asyncHandler(async (req, res) => {
    const slug = req.params.slug;
    const releaseId = readReleaseId({}, req.query);
    if (!releaseId) {
      throw new ApiError(400, "Release (r) required");
    }
    const result = await clientLinkListChatMessages({ slug, releaseId });
    res.json(result);
  }),

  refreshBuild: asyncHandler(async (req, res) => {
    const slug = req.params.slug;
    const releaseId = readReleaseId(req.body, req.query);
    const result = await clientLinkRefreshLiveBuild({
      slug,
      releaseId,
      clientEmail: readClientEmail(req.body),
    });
    res.json(result);
  }),

  revertMerge: asyncHandler(async (req, res) => {
    const slug = req.params.slug;
    const releaseId = readReleaseId(req.body, req.query);
    const rawMsgId = req.body?.m ?? req.body?.messageId;
    const messageId =
      rawMsgId != null && rawMsgId !== ""
        ? Number(Array.isArray(rawMsgId) ? rawMsgId[0] : rawMsgId)
        : null;
    if (!releaseId) {
      throw new ApiError(400, "Release (r) required");
    }
    if (!Number.isInteger(messageId) || messageId < 1) {
      throw new ApiError(400, "Message id (m) required");
    }
    const result = await clientLinkRevertMergedMessage({
      slug,
      releaseId,
      messageId,
      clientEmail: readClientEmail(req.body),
    });
    res.json(result);
  }),
};
