import { prisma } from "../lib/prisma.js";
import { cursorRequest } from "./cursor.service.js";
import { ensureFreshGithubConnection } from "./oauthConnection.service.js";

/**
 * @param {number} userId
 * @returns {Promise<{
 *   cursorApiKeyConfigured: boolean,
 *   cursorBaseUrlConfigured: boolean,
 *   cursorBaseUrl: string | null,
 *   userEmail: string,
 *   reachable: boolean,
 *   patConfigured: boolean | null,
 *   hasGithubOAuth: boolean,
 *   lastError: string | null,
 * }>}
 */
export async function getCursorIntegrationStatus(userId) {
  const apiKey = Boolean(process.env.CURSOR_API_KEY?.trim());
  const base = String(process.env.CURSOR_BASE_URL ?? "").trim();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const userEmail = user?.email?.trim() || "";

  const githubConn = await prisma.userOAuthConnection.findFirst({
    where: { userId, provider: "github" },
    orderBy: { id: "asc" },
  });

  let reachable = false;
  let patConfigured = null;
  let lastError = null;

  if (!apiKey || !base || !userEmail) {
    console.warn("[cursor-integration] skip cursor-cloud-agent probe (config or email)", {
      userId,
      cursorApiKeyConfigured: apiKey,
      cursorBaseUrlConfigured: Boolean(base),
      hasUserEmail: Boolean(userEmail),
    });
    return {
      cursorApiKeyConfigured: apiKey,
      cursorBaseUrlConfigured: Boolean(base),
      cursorBaseUrl: base || null,
      userEmail,
      reachable: false,
      patConfigured: null,
      hasGithubOAuth: Boolean(githubConn),
      lastError: !apiKey
        ? "CURSOR_API_KEY is not set on the server"
        : !base
          ? "CURSOR_BASE_URL is not set on the server"
          : !userEmail
            ? "User email missing"
            : null,
    };
  }

  try {
    console.warn("[cursor-integration] probing cursor-cloud-agent GET /v0/credentials/github", {
      userId,
      baseUrlHost: (() => {
        try {
          return new URL(base).host;
        } catch {
          return "(invalid CURSOR_BASE_URL)";
        }
      })(),
    });
    const { status, data } = await cursorRequest({
      method: "GET",
      path: "/v0/credentials/github",
      query: { email: userEmail },
    });
    reachable = status >= 200 && status < 600;
    if (status === 200 && data && typeof data === "object" && "configured" in data) {
      patConfigured = Boolean(data.configured);
    } else if (data && typeof data === "object" && data.error) {
      lastError = String(data.error);
    }
    console.warn("[cursor-integration] cursor-cloud-agent credentials probe result", {
      userId,
      httpStatus: status,
      reachable,
      patConfigured,
      lastError,
    });
  } catch (e) {
    const cause = e?.cause;
    lastError = e?.message || String(e);
    reachable = false;
    console.warn(
      "[cursor-integration] cursor-cloud-agent unreachable or request threw",
      {
        userId,
        message: e?.message,
        code: e?.code,
        cause:
          cause && typeof cause === "object"
            ? { message: cause.message, code: cause.code, errno: cause.errno }
            : cause,
      },
    );
  }

  return {
    cursorApiKeyConfigured: true,
    cursorBaseUrlConfigured: true,
    cursorBaseUrl: base,
    userEmail,
    reachable,
    patConfigured,
    hasGithubOAuth: Boolean(githubConn),
    lastError,
  };
}

/**
 * Register GitHub token with cursor-cloud-agent for this user's email.
 * @param {number} userId
 * @param {string | null | undefined} manualToken — if set, used instead of OAuth
 * @returns {Promise<{ status: number, data: object }>}
 */
export async function syncCursorGithubPatForUser(userId, manualToken) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const email = user?.email?.trim();
  if (!email) {
    const err = new Error("User email missing");
    err.code = "USER_EMAIL_MISSING";
    throw err;
  }

  let token = typeof manualToken === "string" ? manualToken.trim() : "";
  if (!token) {
    const row = await prisma.userOAuthConnection.findFirst({
      where: { userId, provider: "github" },
      orderBy: { updatedAt: "desc" },
    });
    if (!row) {
      const err = new Error(
        "No GitHub account connected. Add GitHub under Integrations or paste a personal access token.",
      );
      err.code = "GITHUB_OAUTH_REQUIRED";
      throw err;
    }
    const fresh = await ensureFreshGithubConnection(row);
    token = fresh.accessToken?.trim() || "";
  }

  if (!token) {
    const err = new Error("GitHub token is empty");
    err.code = "GITHUB_TOKEN_EMPTY";
    throw err;
  }

  return cursorRequest({
    method: "POST",
    path: "/v0/credentials/github",
    query: { email },
    body: { githubToken: token },
  });
}
