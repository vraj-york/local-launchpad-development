import jwt from "jsonwebtoken";
import { getCognitoVerifier, findOrCreateUserFromCognitoPayload } from "../utils/cognitoAuth.js";
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
 * - Then tries Cognito ID token: verifies with Cognito, finds/creates launchpad DB user.
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
    // Not an app JWT; try Cognito
  }

  const verifier = getCognitoVerifier();
  if (!verifier) {
    return sendAuthError(res, 401, "Authentication failed. Please sign in again.");
  }

  try {
    const payload = await verifier.verify(token);
    const user = await findOrCreateUserFromCognitoPayload(payload, "manager");
    if (!user) {
      return sendAuthError(res, 403, "Access denied.");
    }
    req.user = { id: user.id, role: user.role };
    return next();
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
