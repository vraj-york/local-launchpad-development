import { PrismaClient } from "@prisma/client";
import axios from "axios";
import jwt from "jsonwebtoken";
import { encryptToken, decryptToken } from "../utils/tokenVault.js";
import ApiError from "../utils/apiError.js";

const prisma = new PrismaClient();

const EXPIRY_SKEW_MS = 60_000;

function stateSecret() {
  return process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET;
}

export function signOAuthState(userId, provider, reconnectConnectionId = null) {
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
  };
}

function tokenExpiryDate(expiresInSec) {
  return typeof expiresInSec === "number" && expiresInSec > 0
    ? new Date(Date.now() + expiresInSec * 1000)
    : null;
}

async function githubLoginFromToken(accessToken) {
  const loginRes = await axios.get("https://api.github.com/user", {
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
  const { data } = await axios.get("https://api.atlassian.com/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { email: data.email || data.name || null };
}

async function fetchAtlassianAccessibleResources(accessToken) {
  const { data } = await axios.get("https://api.atlassian.com/oauth/token/accessible-resources", {
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
  const loginRes = await axios.get("https://api.github.com/user", {
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
      jiraBaseUrl: true,
      atlassianAccountEmail: true,
      atlassianCloudId: true,
      accessTokenExpiresAt: true,
    },
  });
  const gh = rows.filter((r) => r.provider === "github");
  const ji = rows.filter((r) => r.provider === "jira_atlassian");
  return {
    github: {
      connections: gh.map((r) => ({
        id: r.id,
        label: r.label,
        login: r.githubLogin || null,
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
  const url = new URL("https://api.github.com/user/repos");
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
  const url = `https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/project`;
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
