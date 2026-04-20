import asyncHandler from "../middleware/asyncHandler.middleware.js";
import {
  completeFigmaOAuthCallbackRedirect,
  deleteFigmaConnection,
  getFigmaOAuthStartResult,
} from "../services/oauthConnection.service.js";

/** Figma REST OAuth under /api/integrations/figma (not the Figma plugin routes). */
export const figmaOAuthController = {
  start: asyncHandler(async (req, res) => {
    const result = getFigmaOAuthStartResult(req.user.id, req.query);
    if (!result.ok) {
      res.status(result.status).json({ error: result.clientMessage });
      return;
    }
    const wantsJson = (req.get("Accept") || "").includes("application/json");
    if (wantsJson) {
      res.json({ url: result.authorizeUrl });
      return;
    }
    res.redirect(302, result.authorizeUrl);
  }),

  callback: asyncHandler(async (req, res) => {
    const location = await completeFigmaOAuthCallbackRedirect(req.query);
    res.redirect(302, location);
  }),

  deleteConnection: asyncHandler(async (req, res) => {
    await deleteFigmaConnection(req.user.id, req.params.connectionId);
    res.json({ ok: true });
  }),
};
