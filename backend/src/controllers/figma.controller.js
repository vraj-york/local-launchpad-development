import asyncHandler from "../middleware/asyncHandler.middleware.js";
import { reactSourceToIr } from "../services/reactToFigmaIr.service.js";
import {
  createFigmaPluginKeys,
  pollFigmaPluginAuth,
  completeFigmaPluginAuth,
} from "../services/figmaPluginAuth.service.js";

export const figmaController = {
  reactToFigmaIr: asyncHandler(async (req, res) => {
    const source =
      typeof req.body?.source === "string"
        ? req.body.source
        : typeof req.body?.react === "string"
          ? req.body.react
          : "";
    const result = await reactSourceToIr(source);
    if (result.error) {
      res
        .status(result.error.includes("ANTHROPIC_API_KEY") ? 503 : 400)
        .json({ error: result.error });
      return;
    }
    res.json({ ir: result.ir });
  }),

  createKeys: (_req, res) => {
    const keys = createFigmaPluginKeys();
    res.json(keys);
  },

  poll: asyncHandler(async (req, res) => {
    const readKey =
      typeof req.query.readKey === "string" ? req.query.readKey : "";
    const outcome = pollFigmaPluginAuth(readKey);
    if (outcome.kind === "no_content") {
      res.status(204).send();
      return;
    }
    res.json({ token: outcome.token, user: outcome.user });
  }),

  complete: asyncHandler(async (req, res) => {
    const data = await completeFigmaPluginAuth(req.body);
    res.json(data);
  }),
};
