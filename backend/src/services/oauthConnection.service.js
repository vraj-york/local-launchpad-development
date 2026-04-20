import axios from "axios";
import jwt from "jsonwebtoken";
import { encryptToken, decryptToken } from "../utils/tokenVault.js";
import ApiError from "../utils/apiError.js";
import { prisma } from "../lib/prisma.js";
import { API_BASE_URLS, API_ENDPOINTS } from "../constants/contstants.js";
import { getPublicFrontendBaseUrl } from "../utils/publicFrontendUrl.js";

const EXPIRY_SKEW_MS = 60_000;

function stateSecret() {
  return process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET;
}

/**
 * Internal SPA path only (prevents open redirects). Optional query string allowed.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function sanitizeOAuthReturnPath(raw) {
  if (raw == null || raw === false) return null;
  const s = String(raw).trim();
  if (!s.startsWith("/") || s.startsWith("//")) return null;
  if (/[\r\n\0]/.test(s)) return null;
  if (s.includes("://") || s.includes("\\") || s.includes("@")) return null;
  if (s.length > 512) return null;
  const q = s.indexOf("?");
  if (q === -1) return s;
  const path = s.slice(0, q);
  const query = s.slice(q + 1);
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (query.length > 256) return null;
  if (query && !/^[a-zA-Z0-9_=&.,%-]+$/.test(query)) return null;
  return s;
}

export function signOAuthState(
  userId,
  provider,
  reconnectConnectionId = null,
  returnPath = null,
) {
  const secret = stateSecret();
  if (!secret) throw new Error("JWT_SECRET or OAUTH_STATE_SECRET required for OAuth");
  const payload = {
    uid: userId,
    p: provider,
    jti: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  if (reconnectConnectionId != null) {
    const n = Number(reconnectConnectionId);
    if (Number.isInteger(n) && n > 0) payload.rcid = n;
  }
  const safeReturn = sanitizeOAuthReturnPath(returnPath);
  if (safeReturn) payload.rp = safeReturn;
  return jwt.sign(payload, secret, { expiresIn: "15m" });
}

export function verifyOAuthState(token) {
  const secret = stateSecret();
  if (!secret) throw new Error("JWT_SECRET or OAUTH_STATE_SECRET required for OAuth");
  const payload = jwt.verify(token, secret);
  if (!payload?.uid || !payload?.p) throw new Error("Invalid state");
  const rcid = payload.rcid;
  return {
    userId: Number(payload.uid),
    provider: String(payload.p),
    reconnectConnectionId:
      rcid != null && rcid !== "" && !Number.isNaN(Number(rcid)) ? Number(rcid) : null,
    returnPath: sanitizeOAuthReturnPath(payload.rp),
  };
}

/** @param {import("express").Request["query"]} query */
export function parseOAuthReconnectIdFromQuery(query) {
  const raw = query?.reconnectId ?? query?.reconnect_id;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** @param {import("express").Request["query"]} query */
export function parseOAuthReturnToFromQuery(query) {
  const raw = query?.returnTo ?? query?.return_to;
  if (raw == null || raw === "") return null;
  return sanitizeOAuthReturnPath(raw);
}

function safeReturnPathFromOAuthState(state) {
  if (!state) return null;
  try {
    return verifyOAuthState(state).returnPath || null;
  } catch {
    return null;
  }
}

/**
 * SPA integrations callback URL (same path for all providers).
 * @param {string} provider
 * @param {{ error?: string, ok?: boolean, returnPath?: string | null }} opts
 */
export function buildIntegrationsOAuthCallbackRedirectUrl(provider, opts = {}) {
  const q = new URLSearchParams({ provider });
  if (opts.ok) q.set("ok", "1");
  if (opts.error != null && opts.error !== "") {
    q.set("error", String(opts.error).slice(0, 200));
  }
  if (opts.returnPath) q.set("return_to", opts.returnPath);
  return `${getPublicFrontendBaseUrl()}/integrations/callback?${q.toString()}`;
}

/** Default Figma REST OAuth scopes (override with `FIGMA_OAUTH_SCOPES`). Space-separated. */
const DEFAULT_FIGMA_OAUTH_SCOPES = [
  "current_user:read",
  "file_comments:read",
  "file_comments:write",
  "file_content:read",
  "file_metadata:read",
  "file_versions:read",
  "library_assets:read",
  "library_content:read",
  "team_library_content:read",
  "file_dev_resources:read",
  "file_dev_resources:write",
  "projects:read",
  "webhooks:read",
  "webhooks:write",
].join(" ");

/**
 * Build Figma authorize URL for GET /integrations/figma/start.
 * @param {number} userId
 * @param {import("express").Request["query"]} query
 * @returns {{ ok: true, authorizeUrl: string } | { ok: false, status: number, clientMessage: string }}
 */
export function getFigmaOAuthStartResult(userId, query) {
  const clientId = process.env.FIGMA_OAUTH_CLIENT_ID;
  const redirectUri = process.env.FIGMA_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return {
      ok: false,
      status: 503,
      clientMessage: "Figma OAuth is not configured on the server",
    };
  }
  const reconnectId = parseOAuthReconnectIdFromQuery(query);
  const returnPath = parseOAuthReturnToFromQuery(query);
  const state = signOAuthState(userId, "figma", reconnectId, returnPath);
  const scope = process.env.FIGMA_OAUTH_SCOPES?.trim() || DEFAULT_FIGMA_OAUTH_SCOPES;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    response_type: "code",
  });
  const authorizeUrl = `https://www.figma.com/oauth?${params.toString()}`;
  return { ok: true, authorizeUrl };
}

/**
 * Run Figma OAuth callback logic and return the frontend callback redirect URL.
 * @param {import("express").Request["query"]} query
 * @returns {Promise<string>}
 */
export async function completeFigmaOAuthCallbackRedirect(query) {
  const code = typeof query.code === "string" ? query.code : "";
  const state = typeof query.state === "string" ? query.state : "";
  const oauthError = typeof query.error === "string" ? query.error : "";
  const returnPathOnError = safeReturnPathFromOAuthState(state);

  if (oauthError) {
    return buildIntegrationsOAuthCallbackRedirectUrl("figma", {
      error: oauthError,
      returnPath: returnPathOnError,
    });
  }
  if (!code || !state) {
    return buildIntegrationsOAuthCallbackRedirectUrl("figma", {
      error: "missing_code_or_state",
      returnPath: returnPathOnError,
    });
  }
  try {
    const decoded = verifyOAuthState(state);
    if (decoded.provider !== "figma") {
      return buildIntegrationsOAuthCallbackRedirectUrl("figma", {
        error: "invalid_state",
        returnPath: decoded.returnPath || null,
      });
    }
    await completeFigmaOAuth(code, state);
    return buildIntegrationsOAuthCallbackRedirectUrl("figma", {
      ok: true,
      returnPath: decoded.returnPath || null,
    });
  } catch (e) {
    const rp = safeReturnPathFromOAuthState(state);
    return buildIntegrationsOAuthCallbackRedirectUrl("figma", {
      error: e?.message || "oauth_failed",
      returnPath: rp,
    });
  }
}

function tokenExpiryDate(expiresInSec) {
  return typeof expiresInSec === "number" && expiresInSec > 0
    ? new Date(Date.now() + expiresInSec * 1000)
    : null;
}

async function githubLoginFromToken(accessToken) {
  const loginRes = await axios.get(`${API_BASE_URLS.GITHUB}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  return loginRes.data?.login || null;
}

export async function createGithubConnectionRecord(userId, accessToken, refreshToken, expiresInSec) {
  const githubLogin = await githubLoginFromToken(accessToken);
  return prisma.userOAuthConnection.create({
    data: {
      userId,
      provider: "github",
      encryptedAccessToken: encryptToken(accessToken),
      encryptedRefreshToken: encryptToken(refreshToken || ""),
      accessTokenExpiresAt: tokenExpiryDate(expiresInSec),
      githubLogin,
    },
  });
}

export async function updateGithubConnectionTokens(
  connectionId,
  userId,
  accessToken,
  refreshToken,
  expiresInSec,
) {
  const row = await prisma.userOAuthConnection.findFirst({
    where: { id: connectionId, userId, provider: "github" },
  });
  if (!row) throw new Error("GitHub connection not found");
  const githubLogin = await githubLoginFromToken(accessToken);
  return prisma.userOAuthConnection.update({
    where: { id: connectionId },
    data: {
      encryptedAccessToken: encryptToken(accessToken),
      encryptedRefreshToken: encryptToken(refreshToken || ""),
      accessTokenExpiresAt: tokenExpiryDate(expiresInSec),
      githubLogin,
    },
  });
}

async function exchangeGithubCode(code) {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("GitHub OAuth env not configured");
  }
  const { data } = await axios.post(
    "https://github.com/login/oauth/access_token",
    {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    },
    { headers: { Accept: "application/json" } },
  );
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    expiresIn: data.expires_in,
  };
}

async function refreshGithubTokens(refreshTokenPlain) {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshTokenPlain) {
    throw new Error("Cannot refresh GitHub token");
  }
  const { data } = await axios.post(
    "https://github.com/login/oauth/access_token",
    {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshTokenPlain,
    },
    { headers: { Accept: "application/json" } },
  );
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshTokenPlain,
    expiresIn: data.expires_in,
  };
}

async function exchangeAtlassianCode(code) {
  const clientId = process.env.ATLASSIAN_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.ATLASSIAN_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Atlassian OAuth env not configured");
  }
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const { data } = await axios.post("https://auth.atlassian.com/oauth/token", params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    expiresIn: data.expires_in,
  };
}

async function refreshAtlassianTokens(refreshTokenPlain) {
  const clientId = process.env.ATLASSIAN_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshTokenPlain) {
    throw new Error("Cannot refresh Atlassian token");
  }
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshTokenPlain,
  });
  const { data } = await axios.post("https://auth.atlassian.com/oauth/token", params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshTokenPlain,
    expiresIn: data.expires_in,
  };
}

async function fetchAtlassianProfile(accessToken) {
  const { data } = await axios.get(`${API_BASE_URLS.ATLASSIAN}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { email: data.email || data.name || null };
}

async function fetchAtlassianAccessibleResources(accessToken) {
  const { data } = await axios.get(`${API_BASE_URLS.ATLASSIAN}/oauth/token/accessible-resources`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("No accessible Jira sites for this Atlassian account");
  }
  const first = data[0];
  const url = typeof first.url === "string" ? first.url.replace(/\/$/, "") : null;
  return { jiraBaseUrl: url, atlassianCloudId: first.id || null };
}

export async function createJiraConnectionRecord(
  userId,
  accessToken,
  refreshToken,
  expiresInSec,
  { jiraBaseUrl, atlassianCloudId, atlassianAccountEmail },
) {
  return prisma.userOAuthConnection.create({
    data: {
      userId,
      provider: "jira_atlassian",
      encryptedAccessToken: encryptToken(accessToken),
      encryptedRefreshToken: encryptToken(refreshToken || ""),
      accessTokenExpiresAt: tokenExpiryDate(expiresInSec),
      jiraBaseUrl: jiraBaseUrl || null,
      atlassianCloudId: atlassianCloudId || null,
      atlassianAccountEmail: atlassianAccountEmail || null,
    },
  });
}

export async function updateJiraConnectionTokens(
  connectionId,
  userId,
  accessToken,
  refreshToken,
  expiresInSec,
  meta,
) {
  const row = await prisma.userOAuthConnection.findFirst({
    where: { id: connectionId, userId, provider: "jira_atlassian" },
  });
  if (!row) throw new Error("Jira connection not found");
  return prisma.userOAuthConnection.update({
    where: { id: connectionId },
    data: {
      encryptedAccessToken: encryptToken(accessToken),
      encryptedRefreshToken: encryptToken(refreshToken || ""),
      accessTokenExpiresAt: tokenExpiryDate(expiresInSec),
      jiraBaseUrl: meta.jiraBaseUrl ?? row.jiraBaseUrl,
      atlassianCloudId: meta.atlassianCloudId ?? row.atlassianCloudId,
      atlassianAccountEmail: meta.atlassianAccountEmail ?? row.atlassianAccountEmail,
    },
  });
}

export async function completeGithubOAuth(code, stateToken) {
  const { userId, reconnectConnectionId } = verifyOAuthState(stateToken);
  const tokens = await exchangeGithubCode(code);
  if (reconnectConnectionId != null) {
    await updateGithubConnectionTokens(
      reconnectConnectionId,
      userId,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiresIn,
    );
    return userId;
  }
  const loginRes = await axios.get(`${API_BASE_URLS.GITHUB}/user`, {
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const login = loginRes.data?.login ? String(loginRes.data.login).trim() : null;
  if (login) {
    const rows = await prisma.userOAuthConnection.findMany({
      where: { userId, provider: "github" },
      select: { id: true, githubLogin: true },
    });
    const existing = rows.find(
      (r) => r.githubLogin && r.githubLogin.toLowerCase() === login.toLowerCase(),
    );
    if (existing) {
      await updateGithubConnectionTokens(
        existing.id,
        userId,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.expiresIn,
      );
      return userId;
    }
  }
  await createGithubConnectionRecord(
    userId,
    tokens.accessToken,
    tokens.refreshToken,
    tokens.expiresIn,
  );
  return userId;
}

export async function completeJiraOAuth(code, stateToken) {
  const { userId, reconnectConnectionId } = verifyOAuthState(stateToken);
  const tokens = await exchangeAtlassianCode(code);
  const resources = await fetchAtlassianAccessibleResources(tokens.accessToken);
  let email = null;
  try {
    const profile = await fetchAtlassianProfile(tokens.accessToken);
    email = profile.email;
  } catch {
    // optional
  }
  const meta = {
    ...resources,
    atlassianAccountEmail: email,
  };
  if (reconnectConnectionId != null) {
    await updateJiraConnectionTokens(
      reconnectConnectionId,
      userId,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiresIn,
      meta,
    );
    return userId;
  }
  const cloudId = meta.atlassianCloudId ? String(meta.atlassianCloudId).trim() : "";
  if (cloudId) {
    const existing = await prisma.userOAuthConnection.findFirst({
      where: { userId, provider: "jira_atlassian", atlassianCloudId: cloudId },
    });
    if (existing) {
      await updateJiraConnectionTokens(
        existing.id,
        userId,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.expiresIn,
        meta,
      );
      return userId;
    }
  }
  await createJiraConnectionRecord(
    userId,
    tokens.accessToken,
    tokens.refreshToken,
    tokens.expiresIn,
    meta,
  );
  return userId;
}

/**
 * Ensure decrypted access token is valid; refresh if near expiry. Persists new tokens on this row.
 * @param {import("@prisma/client").UserOAuthConnection} row
 */
export async function ensureFreshGithubConnection(row) {
  const access = decryptToken(row.encryptedAccessToken);
  const refresh = row.encryptedRefreshToken ? decryptToken(row.encryptedRefreshToken) : "";
  const exp = row.accessTokenExpiresAt ? row.accessTokenExpiresAt.getTime() : null;
  const expiredOrSoon = exp != null && exp - EXPIRY_SKEW_MS <= Date.now();

  if (expiredOrSoon && refresh) {
    const t = await refreshGithubTokens(refresh);
    const githubLogin = await githubLoginFromToken(t.accessToken);
    const updated = await prisma.userOAuthConnection.update({
      where: { id: row.id },
      data: {
        encryptedAccessToken: encryptToken(t.accessToken),
        encryptedRefreshToken: encryptToken(t.refreshToken || ""),
        accessTokenExpiresAt: tokenExpiryDate(t.expiresIn),
        githubLogin,
      },
    });
    return {
      accessToken: decryptToken(updated.encryptedAccessToken),
      githubLogin: updated.githubLogin,
    };
  }

  if (expiredOrSoon && !refresh) {
    throw new Error("GitHub token expired; reconnect OAuth in Integrations.");
  }

  if (!access) throw new Error("GitHub connection has no access token");
  return { accessToken: access, githubLogin: row.githubLogin };
}

export async function ensureFreshJiraConnection(row) {
  const access = decryptToken(row.encryptedAccessToken);
  const refresh = row.encryptedRefreshToken ? decryptToken(row.encryptedRefreshToken) : "";
  const exp = row.accessTokenExpiresAt ? row.accessTokenExpiresAt.getTime() : null;
  const expiredOrSoon = exp != null && exp - EXPIRY_SKEW_MS <= Date.now();

  if (expiredOrSoon && refresh) {
    const t = await refreshAtlassianTokens(refresh);
    const resources = await fetchAtlassianAccessibleResources(t.accessToken);
    let email = row.atlassianAccountEmail;
    try {
      const profile = await fetchAtlassianProfile(t.accessToken);
      if (profile.email) email = profile.email;
    } catch {
      // keep previous
    }
    const updated = await prisma.userOAuthConnection.update({
      where: { id: row.id },
      data: {
        encryptedAccessToken: encryptToken(t.accessToken),
        encryptedRefreshToken: encryptToken(t.refreshToken || ""),
        accessTokenExpiresAt: tokenExpiryDate(t.expiresIn),
        jiraBaseUrl: resources.jiraBaseUrl || row.jiraBaseUrl,
        atlassianCloudId: resources.atlassianCloudId || row.atlassianCloudId,
        atlassianAccountEmail: email,
      },
    });
    return {
      accessToken: decryptToken(updated.encryptedAccessToken),
      jiraBaseUrl: updated.jiraBaseUrl,
      atlassianAccountEmail: updated.atlassianAccountEmail,
      atlassianCloudId: updated.atlassianCloudId,
    };
  }

  if (expiredOrSoon && !refresh) {
    throw new Error("Jira token expired; reconnect OAuth in Integrations.");
  }

  if (!access) throw new Error("Jira connection has no access token");

  let siteRow = row;
  if (!row.atlassianCloudId && access) {
    try {
      const resources = await fetchAtlassianAccessibleResources(access);
      siteRow = await prisma.userOAuthConnection.update({
        where: { id: row.id },
        data: {
          jiraBaseUrl: resources.jiraBaseUrl || row.jiraBaseUrl,
          atlassianCloudId: resources.atlassianCloudId || row.atlassianCloudId,
        },
      });
    } catch {
      // keep row; validation layer will surface reconnect if still missing
    }
  }

  return {
    accessToken: access,
    jiraBaseUrl: siteRow.jiraBaseUrl,
    atlassianAccountEmail: siteRow.atlassianAccountEmail,
    atlassianCloudId: siteRow.atlassianCloudId,
  };
}

export async function getIntegrationsStatus(userId) {
  const rows = await prisma.userOAuthConnection.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      provider: true,
      label: true,
      githubLogin: true,
      bitbucketUsername: true,
      jiraBaseUrl: true,
      atlassianAccountEmail: true,
      atlassianCloudId: true,
      figmaUserId: true,
      figmaHandle: true,
      figmaEmail: true,
      accessTokenExpiresAt: true,
    },
  });
  const gh = rows.filter((r) => r.provider === "github");
  const bb = rows.filter((r) => r.provider === "bitbucket");
  const ji = rows.filter((r) => r.provider === "jira_atlassian");
  const fg = rows.filter((r) => r.provider === "figma");
  return {
    github: {
      connections: gh.map((r) => ({
        id: r.id,
        label: r.label,
        login: r.githubLogin || null,
        expiresAt: r.accessTokenExpiresAt?.toISOString() || null,
      })),
    },
    bitbucket: {
      connections: bb.map((r) => ({
        id: r.id,
        label: r.label,
        login: r.bitbucketUsername || null,
        expiresAt: r.accessTokenExpiresAt?.toISOString() || null,
      })),
    },
    jira: {
      connections: ji.map((r) => ({
        id: r.id,
        label: r.label,
        baseUrl: r.jiraBaseUrl || null,
        cloudId: r.atlassianCloudId || null,
        accountEmail: r.atlassianAccountEmail || null,
        expiresAt: r.accessTokenExpiresAt?.toISOString() || null,
      })),
    },
    figma: {
      connections: fg.map((r) => ({
        id: r.id,
        label: r.label,
        figmaUserId: r.figmaUserId || null,
        handle: r.figmaHandle || null,
        email: r.figmaEmail || null,
        expiresAt: r.accessTokenExpiresAt?.toISOString() || null,
      })),
    },
  };
}

export async function deleteGithubConnection(userId, connectionId) {
  const n = Number(connectionId);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError(400, "Invalid connection id");
  }
  await prisma.userOAuthConnection.deleteMany({
    where: { id: n, userId, provider: "github" },
  });
}

export async function deleteJiraConnection(userId, connectionId) {
  const n = Number(connectionId);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError(400, "Invalid connection id");
  }
  await prisma.userOAuthConnection.deleteMany({
    where: { id: n, userId, provider: "jira_atlassian" },
  });
}

export async function deleteBitbucketConnection(userId, connectionId) {
  const n = Number(connectionId);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError(400, "Invalid connection id");
  }
  await prisma.userOAuthConnection.deleteMany({
    where: { id: n, userId, provider: "bitbucket" },
  });
}

/**
 * Resolve a GitHub OAuth row the caller may use for repo listing.
 * Own connections always allowed. With projectId, creator or admin may use the project creator's connection.
 */
export async function assertGithubConnectionRowForListing(requestUser, connectionId, projectId) {
  const id = Number(connectionId);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, "connectionId is required");
  }
  const row = await prisma.userOAuthConnection.findFirst({
    where: { id, provider: "github" },
  });
  if (!row) throw new ApiError(400, "Invalid GitHub connection");

  if (Number(row.userId) === Number(requestUser.id)) return row;

  if (projectId != null) {
    const pid = Number(projectId);
    if (!Number.isInteger(pid) || pid < 1) throw new ApiError(400, "Invalid projectId");
    const project = await prisma.project.findUnique({
      where: { id: pid },
      select: { createdById: true },
    });
    if (!project) throw new ApiError(404, "Project not found");
    if (Number(row.userId) !== Number(project.createdById)) {
      throw new ApiError(400, "GitHub connection is not for this project's creator");
    }
    const allowed =
      requestUser.role === "admin" || Number(requestUser.id) === Number(project.createdById);
    if (!allowed) {
      throw new ApiError(403, "Only the project creator or an admin can browse repositories here");
    }
    return row;
  }

  throw new ApiError(403, "Not allowed to use this GitHub connection");
}

export async function assertBitbucketConnectionRowForListing(requestUser, connectionId, projectId) {
  const id = Number(connectionId);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, "connectionId is required");
  }
  const row = await prisma.userOAuthConnection.findFirst({
    where: { id, provider: "bitbucket" },
  });
  if (!row) throw new ApiError(400, "Invalid Bitbucket connection");

  if (Number(row.userId) === Number(requestUser.id)) return row;

  if (projectId != null) {
    const pid = Number(projectId);
    if (!Number.isInteger(pid) || pid < 1) throw new ApiError(400, "Invalid projectId");
    const project = await prisma.project.findUnique({
      where: { id: pid },
      select: { createdById: true },
    });
    if (!project) throw new ApiError(404, "Project not found");
    if (Number(row.userId) !== Number(project.createdById)) {
      throw new ApiError(400, "Bitbucket connection is not for this project's creator");
    }
    const allowed =
      requestUser.role === "admin" || Number(requestUser.id) === Number(project.createdById);
    if (!allowed) {
      throw new ApiError(403, "Only the project creator or an admin can browse repositories here");
    }
    return row;
  }

  throw new ApiError(403, "Not allowed to use this Bitbucket connection");
}

export async function assertJiraConnectionRowForListing(requestUser, connectionId, projectId) {
  const id = Number(connectionId);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, "connectionId is required");
  }
  const row = await prisma.userOAuthConnection.findFirst({
    where: { id, provider: "jira_atlassian" },
  });
  if (!row) throw new ApiError(400, "Invalid Jira connection");

  if (Number(row.userId) === Number(requestUser.id)) return row;

  if (projectId != null) {
    const pid = Number(projectId);
    if (!Number.isInteger(pid) || pid < 1) throw new ApiError(400, "Invalid projectId");
    const project = await prisma.project.findUnique({
      where: { id: pid },
      select: { createdById: true },
    });
    if (!project) throw new ApiError(404, "Project not found");
    if (Number(row.userId) !== Number(project.createdById)) {
      throw new ApiError(400, "Jira connection is not for this project's creator");
    }
    const allowed =
      requestUser.role === "admin" || Number(requestUser.id) === Number(project.createdById);
    if (!allowed) {
      throw new ApiError(403, "Only the project creator or an admin can list Jira projects here");
    }
    return row;
  }

  throw new ApiError(403, "Not allowed to use this Jira connection");
}

export async function listGithubReposPage(accessToken, { page = 1, perPage = 100 } = {}) {
  const pp = Math.min(100, Math.max(1, Number(perPage) || 100));
  const pg = Math.max(1, Number(page) || 1);
  const url = new URL(`${API_BASE_URLS.GITHUB}/user/repos`);
  url.searchParams.set("per_page", String(pp));
  url.searchParams.set("page", String(pg));
  url.searchParams.set("affiliation", "owner,collaborator,organization_member");
  url.searchParams.set("sort", "updated");
  url.searchParams.set("direction", "desc");
  const res = await axios.get(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    const msg =
      typeof res.data?.message === "string"
        ? res.data.message
        : `GitHub returned ${res.status}`;
    throw new Error(msg);
  }
  const link = res.headers?.link || "";
  const hasMore = /rel="next"/.test(link);
  const repos = (Array.isArray(res.data) ? res.data : []).map((r) => ({
    fullName: r.full_name,
    gitRepoPath: `github.com/${r.full_name}`,
    private: Boolean(r.private),
    defaultBranch: r.default_branch || null,
  }));
  return { repos, page: pg, hasMore };
}

export async function listJiraProjectsForConnection(accessToken, cloudId) {
  if (!cloudId || String(cloudId).trim() === "") {
    throw new Error("Jira connection has no cloud id; reconnect OAuth.");
  }
  const url = `${API_BASE_URLS.ATLASSIAN}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/project`;
  const { data, status } = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    validateStatus: () => true,
  });
  if (status !== 200) {
    const msg = typeof data?.message === "string" ? data.message : `Atlassian returned ${status}`;
    throw new Error(msg);
  }
  const arr = Array.isArray(data) ? data : [];
  return arr.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
  }));
}

/**
 * Bitbucket Cloud CHANGE-2770: global GET /2.0/repositories?role=member is deprecated.
 * Use workspace membership + GET /2.0/repositories/{workspace} with permission filtering.
 */
function mapBitbucketRepoRow(r) {
  const fullName = r.full_name || "";
  const parts = String(fullName).split("/");
  const ws = parts[0] || "";
  const slug = parts[1] || "";
  return {
    fullName,
    gitRepoPath: ws && slug ? `bitbucket.org/${ws}/${slug}` : fullName,
    private: Boolean(r.is_private),
    defaultBranch: r.mainbranch?.name || r.mainbranch || null,
    updatedOn: typeof r.updated_on === "string" ? r.updated_on : "",
  };
}

async function bitbucketGetJson(accessToken, url) {
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    const msg =
      typeof res.data?.error?.message === "string"
        ? res.data.error.message
        : `Bitbucket returned ${res.status}`;
    throw new Error(msg);
  }
  return res.data || {};
}

async function listBitbucketMemberWorkspaceSlugs(accessToken) {
  const slugs = [];
  let nextUrl = `${API_BASE_URLS.BITBUCKET}/workspaces?role=member&pagelen=100`;
  while (nextUrl) {
    const data = await bitbucketGetJson(accessToken, nextUrl);
    const values = Array.isArray(data.values) ? data.values : [];
    for (const w of values) {
      const s = w?.slug != null ? String(w.slug).trim() : "";
      if (s) slugs.push(s);
    }
    nextUrl = typeof data.next === "string" && data.next ? data.next : null;
  }
  return slugs;
}

async function listReposInBitbucketWorkspace(accessToken, workspaceSlug) {
  const rows = [];
  const base = new URL(
    `${API_BASE_URLS.BITBUCKET}/repositories/${encodeURIComponent(workspaceSlug)}`,
  );
  base.searchParams.set("role", "member");
  base.searchParams.set("pagelen", "100");
  base.searchParams.set("sort", "-updated_on");
  let nextUrl = base.toString();
  while (nextUrl) {
    const data = await bitbucketGetJson(accessToken, nextUrl);
    const values = Array.isArray(data.values) ? data.values : [];
    for (const r of values) rows.push(mapBitbucketRepoRow(r));
    nextUrl = typeof data.next === "string" && data.next ? data.next : null;
  }
  return rows;
}

export async function listBitbucketReposPage(accessToken, { page = 1, pagelen = 100 } = {}) {
  const pl = Math.min(100, Math.max(1, Number(pagelen) || 100));
  const pg = Math.max(1, Number(page) || 1);

  const workspaces = await listBitbucketMemberWorkspaceSlugs(accessToken);
  if (!workspaces.length) {
    return { repos: [], page: pg, hasMore: false };
  }

  const perWs = await Promise.all(
    workspaces.map((ws) => listReposInBitbucketWorkspace(accessToken, ws)),
  );
  const byFullName = new Map();
  for (const inWs of perWs) {
    for (const row of inWs) {
      if (row.fullName && !byFullName.has(row.fullName)) byFullName.set(row.fullName, row);
    }
  }

  const merged = [...byFullName.values()].sort((a, b) =>
    String(b.updatedOn).localeCompare(String(a.updatedOn)),
  );
  const start = (pg - 1) * pl;
  const pageSlice = merged.slice(start, start + pl);
  const repos = pageSlice.map(({ updatedOn: _u, ...repo }) => repo);
  const hasMore = start + pl < merged.length;

  return { repos, page: pg, hasMore };
}

/* ---------- Bitbucket Cloud OAuth ---------- */

function bitbucketBasicAuthHeader() {
  const clientId = process.env.BITBUCKET_OAUTH_CLIENT_ID;
  const clientSecret = process.env.BITBUCKET_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const b64 = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  return `Basic ${b64}`;
}

async function exchangeBitbucketCode(code) {
  const redirectUri = process.env.BITBUCKET_OAUTH_REDIRECT_URI;
  const auth = bitbucketBasicAuthHeader();
  if (!auth || !redirectUri) {
    throw new Error("Bitbucket OAuth env not configured");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const { data } = await axios.post(API_ENDPOINTS.BITBUCKET_OAUTH_TOKEN, body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: auth,
    },
  });
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    expiresIn: data.expires_in,
  };
}

async function refreshBitbucketTokens(refreshTokenPlain) {
  const auth = bitbucketBasicAuthHeader();
  if (!auth || !refreshTokenPlain) {
    throw new Error("Cannot refresh Bitbucket token");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshTokenPlain,
  });
  const { data } = await axios.post(API_ENDPOINTS.BITBUCKET_OAUTH_TOKEN, body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: auth,
    },
  });
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshTokenPlain,
    expiresIn: data.expires_in,
  };
}

async function bitbucketProfileFromToken(accessToken) {
  const { data } = await axios.get(`${API_BASE_URLS.BITBUCKET}/user`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const uuid = data.uuid ? String(data.uuid).replace(/[{}]/g, "") : null;
  const username = data.username ? String(data.username).trim() : null;
  return { uuid, username };
}

export async function createBitbucketConnectionRecord(userId, accessToken, refreshToken, expiresInSec) {
  const { uuid, username } = await bitbucketProfileFromToken(accessToken);
  return prisma.userOAuthConnection.create({
    data: {
      userId,
      provider: "bitbucket",
      encryptedAccessToken: encryptToken(accessToken),
      encryptedRefreshToken: encryptToken(refreshToken || ""),
      accessTokenExpiresAt: tokenExpiryDate(expiresInSec),
      bitbucketUuid: uuid,
      bitbucketUsername: username,
    },
  });
}

export async function updateBitbucketConnectionTokens(
  connectionId,
  userId,
  accessToken,
  refreshToken,
  expiresInSec,
) {
  const row = await prisma.userOAuthConnection.findFirst({
    where: { id: connectionId, userId, provider: "bitbucket" },
  });
  if (!row) throw new Error("Bitbucket connection not found");
  const { uuid, username } = await bitbucketProfileFromToken(accessToken);
  return prisma.userOAuthConnection.update({
    where: { id: connectionId },
    data: {
      encryptedAccessToken: encryptToken(accessToken),
      encryptedRefreshToken: encryptToken(refreshToken || ""),
      accessTokenExpiresAt: tokenExpiryDate(expiresInSec),
      bitbucketUuid: uuid || row.bitbucketUuid,
      bitbucketUsername: username || row.bitbucketUsername,
    },
  });
}

export async function completeBitbucketOAuth(code, stateToken) {
  const { userId, reconnectConnectionId } = verifyOAuthState(stateToken);
  const tokens = await exchangeBitbucketCode(code);
  if (reconnectConnectionId != null) {
    await updateBitbucketConnectionTokens(
      reconnectConnectionId,
      userId,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiresIn,
    );
    return userId;
  }
  const { uuid } = await bitbucketProfileFromToken(tokens.accessToken);
  if (uuid) {
    const rows = await prisma.userOAuthConnection.findMany({
      where: { userId, provider: "bitbucket" },
      select: { id: true, bitbucketUuid: true },
    });
    const norm = uuid.replace(/[{}]/g, "").toLowerCase();
    const existing = rows.find(
      (r) => r.bitbucketUuid && String(r.bitbucketUuid).replace(/[{}]/g, "").toLowerCase() === norm,
    );
    if (existing) {
      await updateBitbucketConnectionTokens(
        existing.id,
        userId,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.expiresIn,
      );
      return userId;
    }
  }
  await createBitbucketConnectionRecord(
    userId,
    tokens.accessToken,
    tokens.refreshToken,
    tokens.expiresIn,
  );
  return userId;
}

/* ---------- Figma REST API OAuth ---------- */

/**
 * @returns {{ id: string; handle: string; email: string }}
 */
async function fetchFigmaUserProfile(accessToken) {
  const empty = { id: "", handle: "", email: "" };
  if (!accessToken) return empty;
  try {
    const { data, status } = await axios.get("https://api.figma.com/v1/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true,
    });
    if (status !== 200 || !data || typeof data !== "object") return empty;
    const id = data.id != null ? String(data.id).trim() : "";
    const handle = typeof data.handle === "string" ? data.handle.trim() : "";
    const email = typeof data.email === "string" ? data.email.trim() : "";
    return { id, handle, email };
  } catch {
    return empty;
  }
}

function figmaBasicAuthHeader() {
  const clientId = process.env.FIGMA_OAUTH_CLIENT_ID;
  const clientSecret = process.env.FIGMA_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const b64 = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  return `Basic ${b64}`;
}

async function exchangeFigmaCode(code) {
  const redirectUri = process.env.FIGMA_OAUTH_REDIRECT_URI;
  const auth = figmaBasicAuthHeader();
  if (!auth || !redirectUri) {
    throw new Error("Figma OAuth env not configured");
  }
  const body = new URLSearchParams({
    redirect_uri: redirectUri,
    code,
    grant_type: "authorization_code",
  });
  const { data } = await axios.post("https://api.figma.com/v1/oauth/token", body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: auth,
    },
  });
  if (data.error) {
    throw new Error(data.error_description || data.error || String(data.error));
  }
  const userIdString =
    data.user_id_string != null && data.user_id_string !== ""
      ? String(data.user_id_string).trim()
      : "";
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    expiresIn: data.expires_in,
    userIdString,
  };
}

async function refreshFigmaTokens(refreshTokenPlain) {
  const auth = figmaBasicAuthHeader();
  if (!auth || !refreshTokenPlain) {
    throw new Error("Cannot refresh Figma token");
  }
  const body = new URLSearchParams({ refresh_token: refreshTokenPlain });
  const { data } = await axios.post("https://api.figma.com/v1/oauth/refresh", body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: auth,
    },
  });
  if (data.error) {
    throw new Error(data.error_description || data.error || String(data.error));
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshTokenPlain,
    expiresIn: data.expires_in,
  };
}

export async function createFigmaConnectionRecord(
  userId,
  accessToken,
  refreshToken,
  expiresInSec,
  { figmaUserId, figmaHandle, figmaEmail },
) {
  return prisma.userOAuthConnection.create({
    data: {
      userId,
      provider: "figma",
      encryptedAccessToken: encryptToken(accessToken),
      encryptedRefreshToken: encryptToken(refreshToken || ""),
      accessTokenExpiresAt: tokenExpiryDate(expiresInSec),
      figmaUserId: figmaUserId || null,
      figmaHandle: figmaHandle || null,
      figmaEmail: figmaEmail || null,
    },
  });
}

export async function updateFigmaConnectionTokens(
  connectionId,
  userId,
  accessToken,
  refreshToken,
  expiresInSec,
  { figmaUserId, figmaHandle, figmaEmail },
) {
  const row = await prisma.userOAuthConnection.findFirst({
    where: { id: connectionId, userId, provider: "figma" },
  });
  if (!row) throw new Error("Figma connection not found");
  return prisma.userOAuthConnection.update({
    where: { id: connectionId },
    data: {
      encryptedAccessToken: encryptToken(accessToken),
      encryptedRefreshToken: encryptToken(refreshToken || ""),
      accessTokenExpiresAt: tokenExpiryDate(expiresInSec),
      figmaUserId: figmaUserId || row.figmaUserId,
      figmaHandle: figmaHandle != null && figmaHandle !== "" ? figmaHandle : row.figmaHandle,
      figmaEmail: figmaEmail != null && figmaEmail !== "" ? figmaEmail : row.figmaEmail,
    },
  });
}

function resolveFigmaProfileFields(tokens, profile) {
  const figmaUserId =
    (profile.id && profile.id.trim()) || (tokens.userIdString && tokens.userIdString.trim()) || "";
  const figmaHandle = profile.handle || "";
  const figmaEmail = profile.email || "";
  return {
    figmaUserId: figmaUserId || null,
    figmaHandle: figmaHandle || null,
    figmaEmail: figmaEmail || null,
  };
}

export async function completeFigmaOAuth(code, stateToken) {
  const { userId, reconnectConnectionId } = verifyOAuthState(stateToken);
  const tokens = await exchangeFigmaCode(code);
  const profile = await fetchFigmaUserProfile(tokens.accessToken);
  const meta = resolveFigmaProfileFields(tokens, profile);

  if (reconnectConnectionId != null) {
    await updateFigmaConnectionTokens(
      reconnectConnectionId,
      userId,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.expiresIn,
      meta,
    );
    return userId;
  }
  if (meta.figmaUserId) {
    const existing = await prisma.userOAuthConnection.findFirst({
      where: { userId, provider: "figma", figmaUserId: meta.figmaUserId },
    });
    if (existing) {
      await updateFigmaConnectionTokens(
        existing.id,
        userId,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.expiresIn,
        meta,
      );
      return userId;
    }
  }
  await createFigmaConnectionRecord(
    userId,
    tokens.accessToken,
    tokens.refreshToken,
    tokens.expiresIn,
    meta,
  );
  return userId;
}

export async function ensureFreshFigmaConnection(row) {
  const access = decryptToken(row.encryptedAccessToken);
  const refresh = row.encryptedRefreshToken ? decryptToken(row.encryptedRefreshToken) : "";
  const exp = row.accessTokenExpiresAt ? row.accessTokenExpiresAt.getTime() : null;
  const expiredOrSoon = exp != null && exp - EXPIRY_SKEW_MS <= Date.now();

  if (expiredOrSoon && refresh) {
    const t = await refreshFigmaTokens(refresh);
    const profile = await fetchFigmaUserProfile(t.accessToken);
    const data = {
      encryptedAccessToken: encryptToken(t.accessToken),
      encryptedRefreshToken: encryptToken(t.refreshToken || ""),
      accessTokenExpiresAt: tokenExpiryDate(t.expiresIn),
    };
    if (profile.id) data.figmaUserId = profile.id.trim();
    if (profile.handle) data.figmaHandle = profile.handle;
    if (profile.email) data.figmaEmail = profile.email;
    const updated = await prisma.userOAuthConnection.update({
      where: { id: row.id },
      data,
    });
    return {
      accessToken: decryptToken(updated.encryptedAccessToken),
      figmaUserId: updated.figmaUserId,
    };
  }

  if (expiredOrSoon && !refresh) {
    throw new Error("Figma token expired; reconnect OAuth in Integrations.");
  }
  if (!access) throw new Error("Figma connection has no access token");
  return { accessToken: access, figmaUserId: row.figmaUserId };
}

export async function deleteFigmaConnection(userId, connectionId) {
  const n = Number(connectionId);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError(400, "Invalid connection id");
  }
  await prisma.userOAuthConnection.deleteMany({
    where: { id: n, userId, provider: "figma" },
  });
}

export async function ensureFreshBitbucketConnection(row) {
  const access = decryptToken(row.encryptedAccessToken);
  const refresh = row.encryptedRefreshToken ? decryptToken(row.encryptedRefreshToken) : "";
  const exp = row.accessTokenExpiresAt ? row.accessTokenExpiresAt.getTime() : null;
  const expiredOrSoon = exp != null && exp - EXPIRY_SKEW_MS <= Date.now();

  if (expiredOrSoon && refresh) {
    const t = await refreshBitbucketTokens(refresh);
    const { uuid, username } = await bitbucketProfileFromToken(t.accessToken);
    const updated = await prisma.userOAuthConnection.update({
      where: { id: row.id },
      data: {
        encryptedAccessToken: encryptToken(t.accessToken),
        encryptedRefreshToken: encryptToken(t.refreshToken || ""),
        accessTokenExpiresAt: tokenExpiryDate(t.expiresIn),
        bitbucketUuid: uuid || row.bitbucketUuid,
        bitbucketUsername: username || row.bitbucketUsername,
      },
    });
    return {
      accessToken: decryptToken(updated.encryptedAccessToken),
      bitbucketUsername: updated.bitbucketUsername,
    };
  }

  if (expiredOrSoon && !refresh) {
    throw new Error("Bitbucket token expired; reconnect OAuth in Integrations.");
  }
  if (!access) throw new Error("Bitbucket connection has no access token");
  return { accessToken: access, bitbucketUsername: row.bitbucketUsername };
}
