import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import {
  getCognitoVerifier,
  getCognitoAccessVerifier,
  findOrCreateUserFromCognitoPayload,
} from "../utils/cognitoAuth.js";
import ApiError from "../utils/apiError.js";

/** In-memory store for Figma plugin OAuth flow (same as Server Figma to React v2) */
export const figmaPendingByWriteKey = new Map();
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

export function createFigmaPluginKeys() {
  const readKey = randomUUID();
  const writeKey = randomUUID();
  figmaPendingByWriteKey.set(writeKey, { readKey });
  figmaReadKeyToWriteKey.set(readKey, writeKey);
  return { readKey, writeKey };
}

/**
 * @returns {{ kind: "no_content" } | { kind: "ok"; token: string; user: { name: string; photoUrl: null } }}
 */
export function pollFigmaPluginAuth(readKey) {
  const trimmed = typeof readKey === "string" ? readKey.trim() : "";
  if (!trimmed) {
    throw new ApiError(400, "readKey required");
  }
  const writeKey = figmaReadKeyToWriteKey.get(trimmed);
  if (!writeKey) {
    return { kind: "no_content" };
  }
  const pending = figmaPendingByWriteKey.get(writeKey);
  if (!pending?.result) {
    return { kind: "no_content" };
  }
  figmaReadKeyToWriteKey.delete(trimmed);
  figmaPendingByWriteKey.delete(writeKey);
  return {
    kind: "ok",
    token: pending.result.token,
    user: pending.result.user,
  };
}

export async function completeFigmaPluginAuth(body) {
  const writeKey =
    typeof body?.state === "string"
      ? body.state.trim()
      : body?.writeKey && typeof body.writeKey === "string"
        ? body.writeKey.trim()
        : "";
  const access_token =
    typeof body?.access_token === "string" ? body.access_token.trim() : "";
  if (!writeKey || !access_token) {
    throw new ApiError(400, "Body must be { state: writeKey, access_token }");
  }
  const pending = figmaPendingByWriteKey.get(writeKey);
  if (!pending) {
    throw new ApiError(400, "Invalid or expired state");
  }
  let name = "User";
  const photoUrl = null;
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
  return {
    ok: true,
    message: "You can close this window and return to Figma.",
  };
}
