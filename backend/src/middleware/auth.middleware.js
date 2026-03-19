import jwt from "jsonwebtoken";
import {
  getCognitoVerifier,
  getCognitoAccessVerifier,
  findOrCreateUserFromCognitoPayload,
} from "../utils/cognitoAuth.js";
import { isExcludedPath } from "../utils/pathExclusion.js";

/**
 * Return a safe message for the client. Never expose Cognito client IDs,
 * user pool, or other internal details (same approach as York IE).
 */
function sanitizeAuthError(rawMessage) {
  if (!rawMessage || typeof rawMessage !== "string") {
    return "Authentication failed. Please sign in again.";
  }
  const lower = rawMessage.toLowerCase();
  if (
    lower.includes("client id") ||
    lower.includes("client_id") ||
    lower.includes("expected:") ||
    lower.includes("not allowed") ||
    lower.includes("user pool") ||
    lower.includes("cognito")
  ) {
    return "Authentication failed. Please sign in again.";
  }
  if (lower.includes("expired")) return "Token has expired. Please refresh your token.";
  if (lower.includes("invalid") || lower.includes("malformed") || lower.includes("signature")) {
    return "Invalid token. Please login again.";
  }
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("econnrefused")) {
    return "Authentication service temporarily unavailable. Please try again.";
  }
  return "Authentication failed. Please sign in again.";
}

function sendAuthError(res, status, message) {
  res.status(status).json({ error: message });
}

/**
 * Validate Bearer token and set req.user = { id, role }.
 * - Tries app JWT (JWT_SECRET) first for backward compat.
 * - Then tries Cognito ID token, then Cognito access token (frontend uses access token for Hub and launchpad).
 * - Excluded paths skip auth (login, refresh, health, etc.).
 * - Returns JSON errors with sanitized messages (never leak Cognito details).
 */
export async function authenticateToken(req, res, next) {
  const fullPath = req.baseUrl || req.path || req.originalUrl || "";

  if (isExcludedPath(fullPath)) {
    return next();
  }

  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return sendAuthError(res, 401, "Authorization token is required");
  }

  try {
    const appDecoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: appDecoded.id, role: appDecoded.role };
    return next();
  } catch {
    // Not an app JWT; try Cognito (ID then access token)
  }

  const idVerifier = getCognitoVerifier();
  const accessVerifier = getCognitoAccessVerifier();
  if (!idVerifier && !accessVerifier) {
    return sendAuthError(res, 401, "Authentication failed. Please sign in again.");
  }

  let payload = null;
  try {
    if (idVerifier) payload = await idVerifier.verify(token);
  } catch {
    // Not an ID token; try access token
  }
  if (!payload && accessVerifier) {
    try {
      payload = await accessVerifier.verify(token);
    } catch {
      // Will fall through to error handling below
    }
  }

  if (payload) {
    try {
      const user = await findOrCreateUserFromCognitoPayload(payload, "manager");
      if (!user) return sendAuthError(res, 403, "Access denied.");
      req.user = { id: user.id, role: user.role };
      return next();
    } catch {
      return sendAuthError(res, 401, "Authentication failed. Please sign in again.");
    }
  }

  try {
    // Trigger verifier to get a proper error (e.g. expired) for response
    if (idVerifier) await idVerifier.verify(token);
    else if (accessVerifier) await accessVerifier.verify(token);
  } catch (err) {
    const name = err?.name || "";
    const message = err?.message || "";

    if (name === "TokenExpiredError" || name === "TokenExpiredException") {
      return sendAuthError(res, 401, "Token has expired. Please refresh your token.");
    }
    if (
      name === "NotAuthorizedException" ||
      name === "JwtInvalidSignatureError" ||
      name === "InvalidParameterException"
    ) {
      return sendAuthError(res, 401, "Invalid token. Please login again.");
    }
    if (
      message.includes("failed to fetch") ||
      message.includes("econnrefused") ||
      message.includes("timeout")
    ) {
      return sendAuthError(
        res,
        503,
        "Authentication service temporarily unavailable. Please try again."
      );
    }

    return sendAuthError(res, 401, sanitizeAuthError(message));
  }
}
