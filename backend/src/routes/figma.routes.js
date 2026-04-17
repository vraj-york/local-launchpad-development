import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import crypto from "crypto";
import {
  getCognitoVerifier,
  getCognitoAccessVerifier,
  findOrCreateUserFromCognitoPayload,
} from "../utils/cognitoAuth.js";
import { reactSourceToIr } from "../services/reactToFigmaIr.service.js";

const router = express.Router();
// In-memory store for Figma plugin OAuth flow (same as Server Figma to React v2)
const figmaPendingByWriteKey = new Map();
const figmaReadKeyToWriteKey = new Map();

function randomUUID() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** POST /api/figma/react-to-figma-ir — LaunchPad 2: React/JSX → layout IR (Claude). */
router.post("/react-to-figma-ir", async (req, res) => {
  const source =
    typeof req.body?.source === "string"
      ? req.body.source
      : typeof req.body?.react === "string"
        ? req.body.react
        : "";
  const result = await reactSourceToIr(source);
  if (result.error) {
    res.status(result.error.includes("ANTHROPIC_API_KEY") ? 503 : 400).json({ error: result.error });
    return;
  }
  res.json({ ir: result.ir });
});

/** POST /api/figma/keys - Generate readKey and writeKey for plugin */
router.post("/keys", (_req, res) => {
  const readKey = randomUUID();
  const writeKey = randomUUID();
  figmaPendingByWriteKey.set(writeKey, { readKey });
  figmaReadKeyToWriteKey.set(readKey, writeKey);
  res.json({ readKey, writeKey });
});

/** GET /api/figma/poll?readKey= - Plugin polls until login result is available */
router.get("/poll", (req, res) => {
  const readKey = typeof req.query.readKey === "string" ? req.query.readKey.trim() : "";
  if (!readKey) {
    res.status(400).json({ error: "readKey required" });
    return;
  }
  const writeKey = figmaReadKeyToWriteKey.get(readKey);
  if (!writeKey) {
    res.status(204).send();
    return;
  }
  const pending = figmaPendingByWriteKey.get(writeKey);
  if (!pending?.result) {
    res.status(204).send();
    return;
  }
  figmaReadKeyToWriteKey.delete(readKey);
  figmaPendingByWriteKey.delete(writeKey);
  res.json({ token: pending.result.token, user: pending.result.user });
});

/** POST /api/figma/complete - Frontend calls after user signs in with state and access_token */
router.post("/complete", async (req, res) => {
  const writeKey =
    typeof req.body?.state === "string"
      ? req.body.state.trim()
      : (req.body?.writeKey && typeof req.body.writeKey === "string" ? req.body.writeKey.trim() : "");
  const access_token =
    typeof req.body?.access_token === "string" ? req.body.access_token.trim() : "";
  if (!writeKey || !access_token) {
    res.status(400).json({ error: "Body must be { state: writeKey, access_token }" });
    return;
  }
  const pending = figmaPendingByWriteKey.get(writeKey);
  if (!pending) {
    res.status(400).json({ error: "Invalid or expired state" });
    return;
  }
  let name = "User";
  let photoUrl = null;
  try {
    const decoded = jwt.verify(access_token, process.env.JWT_SECRET);
    const userId = decoded.id;
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      if (user?.name) name = user.name;
    }
  } catch {
    let payload = null;
    try {
      const idVerifier = getCognitoVerifier();
      if (idVerifier) payload = await idVerifier.verify(access_token);
    } catch {
      // Not ID token; try access token
    }
    if (!payload) {
      try {
        const accessVerifier = getCognitoAccessVerifier();
        if (accessVerifier) payload = await accessVerifier.verify(access_token);
      } catch {
        // Token invalid or expired; keep generic name
      }
    }
    if (payload) {
      const userRecord = await findOrCreateUserFromCognitoPayload(payload, "manager");
      if (userRecord?.name) name = userRecord.name;
    }
  }
  pending.result = { token: access_token, user: { name, photoUrl } };
  res.json({ ok: true, message: "You can close this window and return to Figma." });
});

export default router;
export { figmaPendingByWriteKey };
