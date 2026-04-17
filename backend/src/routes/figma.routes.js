import express from "express";
import { figmaController } from "../controllers/figma.controller.js";

const router = express.Router();

/** POST /api/figma/react-to-figma-ir — LaunchPad 2: React/JSX → layout IR (Claude). */
router.post("/react-to-figma-ir", figmaController.reactToFigmaIr);

/** POST /api/figma/keys - Generate readKey and writeKey for plugin */
router.post("/keys", figmaController.createKeys);

/** GET /api/figma/poll?readKey= - Plugin polls until login result is available */
router.get("/poll", figmaController.poll);

/** POST /api/figma/complete - Frontend calls after user signs in with state and access_token */
router.post("/complete", figmaController.complete);

export default router;
