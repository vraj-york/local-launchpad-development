import axios from "axios";
import config from "../config/index.js";
import { isTokenExpiringSoon } from "../utils/auth.js";

const API_URL = config.API_URL;

/** Refresh token proactively this many seconds before access token expires. */
const PROACTIVE_REFRESH_BUFFER_SEC = 5 * 60; // 5 minutes
/** How often to check if we should refresh (ms). */
const REFRESH_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
const HUB_API_URL = config.HUB_API_URL;

// Create axios instance with default config
const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Launchpad APIs: use id token (stored as "token") so backend gets email from payload; Hub uses access_token separately
api.interceptors.request.use(
  (config) => {
    const path = typeof config.url === "string" ? config.url : "";
    const isPublicClientLinkChat = path.includes("/api/chat/");
    const token = localStorage.getItem("token");
    if (token && !isPublicClientLinkChat) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

const STORAGE_KEYS = ["token", "access_token", "user", "cognito_refresh_token"];

/** Removed features / older clients; safe to delete if present. */
const LEGACY_LOCAL_STORAGE_KEYS = [
  "authToken",
  "persist:auth",
  "hasCompletedTour",
  "meetings",
];

export function clearAuthStorageOnly() {
  [...STORAGE_KEYS, ...LEGACY_LOCAL_STORAGE_KEYS].forEach((k) =>
    localStorage.removeItem(k),
  );
}

/** Drop stale keys without clearing an active session. */
export function clearLegacyLocalStorageKeys() {
  LEGACY_LOCAL_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
}

function sanitizeUserForStorage(user) {
  if (!user || typeof user !== "object") return null;
  return {
    id: user.id ?? null,
    role: user.role ?? null,
    email: typeof user.email === "string" ? user.email : "",
    name: typeof user.name === "string" ? user.name : "",
  };
}

function clearAuthAndRedirect() {
  clearAuthStorageOnly();
  window.location.href = "/";
}

/**
 * Call Hub logout API with access token in Authorization header.
 * Uses access_token (Hub requires access token); does not clear local storage (caller clears after).
 */
export async function hubLogout() {
  const accessToken =
    localStorage.getItem("access_token") || localStorage.getItem("token");
  const refreshToken = localStorage.getItem("cognito_refresh_token");
  if (!HUB_API_URL || !accessToken) return;
  try {
    await axios.post(
      `${HUB_API_URL}/api/auth/logout`,
      refreshToken ? { refreshToken } : {},
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch {
    // Best-effort; caller always clears local state (e.g. even if Hub returns 401)
  }
}

/**
 * Call Hub's refresh API to get new tokens. Hub requires refreshToken + email (for Cognito SECRET_HASH).
 * POST HUB_API_URL/api/auth/refresh with { refreshToken, email }.
 */
function getStoredEmail() {
  try {
    const raw = localStorage.getItem("user");
    const user = raw ? JSON.parse(raw) : null;
    return user?.email ?? null;
  } catch {}
  return null;
}

/** Call Hub API to refresh tokens (Hub validates with Cognito; email required for SECRET_HASH). */
export async function refreshAppToken() {
  const refreshToken = localStorage.getItem("cognito_refresh_token");
  const email = getStoredEmail();
  if (!refreshToken || !email) return null;
  if (!HUB_API_URL) return null;
  try {
    const { data } = await axios.post(`${HUB_API_URL}/api/auth/refresh`, {
      refreshToken,
      email,
    });
    const body = data?.data ?? data;
    const idToken = body?.idToken ?? body?.id_token;
    const accessToken = body?.accessToken ?? body?.access_token;
    const newRefreshToken = body?.refreshToken ?? body?.refresh_token;
    const launchpadToken = idToken ?? accessToken;
    if (launchpadToken) {
      localStorage.setItem("token", launchpadToken);
      if (accessToken) localStorage.setItem("access_token", accessToken);
      if (newRefreshToken)
        localStorage.setItem("cognito_refresh_token", newRefreshToken);
      const userForStorage = sanitizeUserForStorage(body?.user);
      if (userForStorage) {
        localStorage.setItem("user", JSON.stringify(userForStorage));
      }
      return launchpadToken;
    }
  } catch {
    // Refresh failed; caller may redirect to login
  }
  return null;
}

/**
 * If we have a refresh token and the access token is missing or expiring soon, refresh in the background.
 * Returns true if a new token was stored, false otherwise.
 */
export async function tryProactiveRefresh() {
  const refreshToken = localStorage.getItem("cognito_refresh_token");
  if (!refreshToken) return false;
  const token = localStorage.getItem("token");
  if (token && !isTokenExpiringSoon(token, PROACTIVE_REFRESH_BUFFER_SEC))
    return false;
  const newToken = await refreshAppToken();
  return !!newToken;
}

let refreshCheckTimerId = null;

/**
 * Start a timer that checks every REFRESH_CHECK_INTERVAL_MS and refreshes the token
 * when it will expire within PROACTIVE_REFRESH_BUFFER_SEC. Call on login.
 * Stops automatically when there is no refresh token (e.g. after logout).
 */
export function startTokenRefreshTimer() {
  if (refreshCheckTimerId != null) clearInterval(refreshCheckTimerId);
  refreshCheckTimerId = setInterval(async () => {
    if (!localStorage.getItem("cognito_refresh_token")) {
      clearInterval(refreshCheckTimerId);
      refreshCheckTimerId = null;
      return;
    }
    await tryProactiveRefresh();
  }, REFRESH_CHECK_INTERVAL_MS);
}

/** Stop the proactive refresh timer (e.g. on logout). */
export function stopTokenRefreshTimer() {
  if (refreshCheckTimerId != null) {
    clearInterval(refreshCheckTimerId);
    refreshCheckTimerId = null;
  }
}

// On 401: try refresh (frontend sends refresh token to backend), then retry; else logout
let isRefreshing = false;
let refreshSubscribers = [];

function subscribeTokenRefresh(cb) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status !== 401) return Promise.reject(error);
    if (!originalRequest) return Promise.reject(error);
    if (originalRequest.url?.includes("/api/chat/")) {
      return Promise.reject(error);
    }
    // Don't retry refresh endpoint to avoid loop
    if (originalRequest.url?.includes("/api/auth/refresh")) {
      clearAuthAndRedirect();
      return Promise.reject(error);
    }

    const refreshToken = localStorage.getItem("cognito_refresh_token");
    if (!refreshToken) {
      clearAuthAndRedirect();
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve) => {
        subscribeTokenRefresh((newToken) => {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          resolve(api(originalRequest));
        });
      });
    }

    isRefreshing = true;
    try {
      const newToken = await refreshAppToken();
      if (newToken) {
        onRefreshed(newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      }
    } catch {
      // refresh failed
    }
    isRefreshing = false;
    clearAuthAndRedirect();
    return Promise.reject(error);
  },
);

/** Call after login when opened by Figma plugin (URL has ?state=writeKey). Tells backend to associate token with writeKey so plugin poll gets it. */
export const figmaComplete = async (state, access_token) => {
  try {
    const response = await axios.post(`${API_URL}/api/figma/complete`, {
      state,
      access_token,
    });
    return response.data;
  } catch (error) {
    const data = error.response?.data || {};
    return { error: data.error || "Failed to complete Figma login" };
  }
};

// Function to fetch all managers
export const fetchManagers = async () => {
  try {
    const response = await api.get("/api/auth/managers");
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to fetch managers" };
  }
};

/** OAuth / integrations (GitHub, Bitbucket, Jira) — Bearer required via api interceptor */
export const fetchIntegrationsStatus = async () => {
  const { data } = await api.get("/api/integrations/status");
  return data;
};

export const getGithubOAuthAuthorizeUrl = async (
  reconnectConnectionId,
  { returnTo } = {},
) => {
  const params = {};
  if (reconnectConnectionId != null && reconnectConnectionId !== "") {
    params.reconnectId = reconnectConnectionId;
  }
  if (returnTo) params.returnTo = returnTo;
  const { data } = await api.get("/api/integrations/github/start", {
    params,
    headers: { Accept: "application/json" },
  });
  if (!data?.url) throw new Error("GitHub OAuth is not available");
  return data.url;
};

export const getJiraOAuthAuthorizeUrl = async (
  reconnectConnectionId,
  { returnTo } = {},
) => {
  const params = {};
  if (reconnectConnectionId != null && reconnectConnectionId !== "") {
    params.reconnectId = reconnectConnectionId;
  }
  if (returnTo) params.returnTo = returnTo;
  const { data } = await api.get("/api/integrations/jira/start", {
    params,
    headers: { Accept: "application/json" },
  });
  if (!data?.url) throw new Error("Jira OAuth is not available");
  return data.url;
};

export const getBitbucketOAuthAuthorizeUrl = async (
  reconnectConnectionId,
  { returnTo } = {},
) => {
  const params = {};
  if (reconnectConnectionId != null && reconnectConnectionId !== "") {
    params.reconnectId = reconnectConnectionId;
  }
  if (returnTo) params.returnTo = returnTo;
  const { data } = await api.get("/api/integrations/bitbucket/start", {
    params,
    headers: { Accept: "application/json" },
  });
  if (!data?.url) throw new Error("Bitbucket OAuth is not available");
  return data.url;
};

export const disconnectGithubIntegration = async (connectionId) => {
  await api.delete(`/api/integrations/github/${connectionId}`);
};

export const disconnectBitbucketIntegration = async (connectionId) => {
  await api.delete(`/api/integrations/bitbucket/${connectionId}`);
};

export const disconnectJiraIntegration = async (connectionId) => {
  await api.delete(`/api/integrations/jira/${connectionId}`);
};

/** Paginated GitHub repos visible to the OAuth connection (affiliation owner/collaborator/org member). */
export const fetchGithubReposPage = async (connectionId, { page = 1, projectId } = {}) => {
  const params = { connectionId, page };
  if (projectId != null && projectId !== "") params.projectId = projectId;
  const { data } = await api.get("/api/integrations/github/repos", { params });
  return data;
};

/** Paginated Bitbucket repos for the OAuth connection. */
export const fetchBitbucketReposPage = async (connectionId, { page = 1, projectId } = {}) => {
  const params = { connectionId, page };
  if (projectId != null && projectId !== "") params.projectId = projectId;
  const { data } = await api.get("/api/integrations/bitbucket/repos", { params });
  return data;
};

/** Jira projects for an OAuth connection; includes jiraBaseUrl for the site. */
export const fetchJiraProjectsForConnection = async (connectionId, { projectId } = {}) => {
  const params = { connectionId };
  if (projectId != null && projectId !== "") params.projectId = projectId;
  const { data } = await api.get("/api/integrations/jira/projects", { params });
  return data;
};

/** Creator's OAuth connections (for edit-project UI); creator or admin only. */
export const fetchCreatorIntegrationConnections = async (projectId) => {
  const { data } = await api.get(
    `/api/integrations/creator-connections/${projectId}`,
  );
  return data;
};

// Function to create a new project
export const createProject = async (projectData) => {
  try {
    const response = await api.post("/api/projects", projectData);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to create project" };
  }
};

// Function to fetch all projects
export const fetchProjects = async () => {
  try {
    const response = await api.get("/api/projects");
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to fetch projects" };
  }
};

// Function to fetch project details by ID
export const fetchProjectById = async (projectId) => {
  try {
    const response = await api.get(`/api/projects/${projectId}`);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to fetch project" };
  }
};

/** Catalog: merged list of PatrickJS/awesome-cursorrules folders plus shared custom packs (backend). */
export const fetchCursorRulesCatalog = async (projectId) => {
  try {
    const response = await api.get(
      `/api/projects/${projectId}/cursor-rules/catalog`,
    );
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to load Cursor rules catalog" };
  }
};

/** List shared custom Cursor rules (same for all projects; projectId is only for API auth). */
export const fetchProjectCustomCursorRules = async (projectId) => {
  try {
    const response = await api.get(
      `/api/projects/${projectId}/cursor-rules/custom`,
    );
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to load custom Cursor rules" };
  }
};

/** Create or update a shared custom rule pack (instance-wide; projectId is only for API auth). */
export const createProjectCustomCursorRule = async (projectId, { folderName, body }) => {
  try {
    const response = await api.post(
      `/api/projects/${projectId}/cursor-rules/custom`,
      { folderName, body },
    );
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to save custom Cursor rules" };
  }
};

/** Push selected rule packs to the GitHub developer repository under `.cursor/rules/awesome-cursorrules/...`. */
export const importCursorRulesFolders = async (projectId, folders) => {
  try {
    const response = await api.post(
      `/api/projects/${projectId}/cursor-rules/import`,
      { folders },
    );
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to import Cursor rules" };
  }
};

/** Start deferred from-scratch Cursor agent (release 1.0.0 + agent). */
export const startProjectScratchAgent = async (projectId, prompt) => {
  try {
    const response = await api.post(`/api/projects/${projectId}/scratch-agent`, {
      prompt,
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to start scratch agent" };
  }
};

// Release Management API Functions

// Function to fetch all releases for a project
export const fetchReleases = async (projectId) => {
  try {
    const response = await api.get(`/api/releases/project/${projectId}`);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to fetch releases" };
  }
};

// Function to create a new release
export const createRelease = async (releaseData) => {
  try {
    const response = await api.post("/api/releases", releaseData);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to create release" };
  }
};

// Function to lock/unlock a release
export const toggleReleaseLock = async (releaseId, locked) => {
  try {
    const response = await api.post(`/api/releases/${releaseId}/lock`, {
      locked,
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to toggle release lock" };
  }
};

export const publicLockRelease = async (releaseId, lockedBy) => {
  try {
    const response = await api.post(`/api/releases/${releaseId}/public-lock`, {
      lockedBy,
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to lock release" };
  }
};

/** Public client-link chat (routes under /api/chat). No JWT. */
export const clientLinkSendFollowup = async (
  slug,
  releaseId,
  text,
  clientEmail,
  replacementImage = null,
) => {
  const enc = encodeURIComponent(String(slug).trim());
  const body = {
    r: Number(releaseId),
    t: text,
    clientEmail: String(clientEmail || "").trim(),
  };
  if (
    replacementImage &&
    typeof replacementImage === "object" &&
    typeof replacementImage.data === "string"
  ) {
    body.replacementImage = {
      data: replacementImage.data,
      mimeType: replacementImage.mimeType || "image/png",
      width: Number(replacementImage.width) || 512,
      height: Number(replacementImage.height) || 512,
    };
  }
  const response = await api.post(`/api/chat/${enc}/followup`, body);
  return response.data;
};

export const clientLinkFetchAgentStatus = async (slug, releaseId) => {
  const enc = encodeURIComponent(String(slug).trim());
  const response = await api.get(`/api/chat/${enc}/agent-status`, {
    params: { r: Number(releaseId) },
  });
  return response.data;
};

/** Public: summary after agent finishes for the selected release. */
export const clientLinkFetchExecutionSummary = async (slug, releaseId) => {
  const enc = encodeURIComponent(String(slug).trim());
  const response = await api.get(`/api/chat/${enc}/summary`, {
    params: { r: Number(releaseId) },
  });
  return response.data;
};

/** Public: persisted chat messages for client-link release. */
export const clientLinkFetchChatMessages = async (slug, releaseId) => {
  const enc = encodeURIComponent(String(slug).trim());
  const response = await api.get(`/api/chat/${enc}/messages`, {
    params: { r: Number(releaseId) },
  });
  return response.data;
};

/** Public: git-revert a merged chat message on launchpad. */
export const clientLinkRevertMerge = async (
  slug,
  releaseId,
  messageId,
  clientEmail = "",
) => {
  const enc = encodeURIComponent(String(slug).trim());
  const response = await api.post(`/api/chat/${enc}/revert-merge`, {
    r: Number(releaseId),
    m: Number(messageId),
    clientEmail: String(clientEmail || "").trim(),
  });
  return response.data;
};

/** Public: re-fetch tag, rebuild, redeploy live preview (long-running; same timeout as release upload). */
export const clientLinkRefreshLiveBuild = async (
  slug,
  releaseId,
  clientEmail = "",
) => {
  const enc = encodeURIComponent(String(slug).trim());
  const response = await api.post(
    `/api/chat/${enc}/refresh-build`,
    { r: Number(releaseId), clientEmail: String(clientEmail || "").trim() },
    { timeout: 2 * 60 * 60 * 1000 },
  );
  return response.data;
};


// Function to upload ZIP to a release
export const uploadToRelease = async (releaseId, file) => {
  try {
    const formData = new FormData();
    formData.append("project", file);
    const response = await api.post(
      `/api/releases/${releaseId}/upload`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        timeout: 2 * 60 * 60 * 1000, // align with nginx proxy_read_timeout for /api (2h)
      },
    );
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to upload to release" };
  }
};

// Function to generate Jira tickets from git diff summary
export const generateJiraTickets = async (projectId) => {
  try {
    const response = await api.post(
      `/api/projects/${projectId}/generate-jira-tickets`,
    );
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to generate Jira tickets" };
  }
};

// Function to update a project
export const updateProject = async (projectId, projectData) => {
  try {
    const response = await api.put(`/api/projects/${projectId}`, projectData);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to update project" };
  }
};

/**
 * Parse Hub /auth/callback response. We store both: idToken for launchpad (has email), accessToken for Hub.
 * Format: { success, data: { accessToken, refreshToken, idToken?, expiresIn, permissions, employeeData } }
 */
function parseHubAuthResponse(body) {
  if (!body || typeof body !== "object") return null;
  const d =
    body.data != null && typeof body.data === "object" ? body.data : body;
  const idToken = d.idToken ?? d.id_token ?? body.idToken ?? body.id_token;
  const accessToken =
    d.accessToken ?? d.access_token ?? body.accessToken ?? body.access_token;
  const refreshToken =
    d.refreshToken ??
    d.refresh_token ??
    body.refreshToken ??
    body.refresh_token;
  const launchpadToken = idToken ?? accessToken ?? d.token ?? body.token;
  if (!launchpadToken) return null;

  const emp =
    d.employeeData && typeof d.employeeData === "object"
      ? d.employeeData
      : null;
  const nameFromEmp =
    emp?.first_name != null || emp?.last_name != null
      ? [emp.first_name, emp.last_name].filter(Boolean).join(" ").trim()
      : null;
  const imageFromEmp =
    emp?.profile_pic ??
    emp?.image ??
    d.picture ??
    d.image ??
    body.picture ??
    body.image;
  let user = d.user || d.userProfile || d.profile || body.user;
  if (user && typeof user === "string") {
    try {
      user = JSON.parse(user);
    } catch {
      user = null;
    }
  }
  if (!user || typeof user !== "object") {
    user = {
      id: emp?.employee_id ?? d.id ?? body.id ?? "user",
      email: emp?.email ?? d.email ?? body.email ?? "",
      name: nameFromEmp ?? d.name ?? d.username ?? body.name ?? "User",
      image: imageFromEmp ?? user?.image,
      employee_id: emp?.employee_id,
      first_name: emp?.first_name,
      last_name: emp?.last_name,
      account_status: emp?.account_status,
      user_type: emp?.user_type,
    };
  } else if (emp) {
    user = {
      ...user,
      image: imageFromEmp ?? user.image,
      employee_id: emp.employee_id ?? user.employee_id,
      first_name: emp.first_name ?? user.first_name,
      last_name: emp.last_name ?? user.last_name,
      account_status: emp.account_status ?? user.account_status,
      user_type: emp.user_type ?? user.user_type,
      name: nameFromEmp || user.name,
      email: emp.email ?? user.email,
    };
  }
  return {
    token: launchpadToken,
    idToken: idToken || launchpadToken,
    accessToken: accessToken || launchpadToken,
    refreshToken: refreshToken || null,
    expiresIn: d.expiresIn ?? body.expiresIn,
    permissions: d.permissions ?? body.permissions ?? [],
    employeeData: emp || null,
    user,
  };
}

const hubAuthByCode = new Map();

/**
 * Exchange Hub OAuth code for Cognito tokens. Store id token for launchpad (email in payload), access token for Hub.
 */
export async function exchangeHubAuthCode(code, redirectUri) {
  if (hubAuthByCode.has(code)) return hubAuthByCode.get(code);

  const redirect_uri = redirectUri || config.HUB_OAUTH_REDIRECT_URL;
  const promise = (async () => {
    const { data } = await axios.get(`${HUB_API_URL}/api/auth/callback`, {
      params: { code, redirect_uri },
    });
    const parsed = parseHubAuthResponse(data);
    if (!parsed) {
      const err = new Error(
        data?.message || data?.error || "Unexpected response from Hub",
      );
      throw err;
    }
    const idToken = parsed.idToken || parsed.token;
    const accessToken = parsed.accessToken || parsed.token;
    if (!idToken && !accessToken)
      throw new Error("No token in callback response");
    const nameFromCallback =
      parsed.user?.name ??
      [parsed.employeeData?.first_name, parsed.employeeData?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
    const imageFromCallback =
      parsed.user?.image ??
      parsed.employeeData?.profile_pic ??
      parsed.user?.image;
    let user = {
      ...parsed.user,
      email: parsed.user?.email ?? parsed.employeeData?.email,
      name: nameFromCallback || parsed.user?.name,
      image: imageFromCallback,
      employee_data: parsed.employeeData ?? undefined,
      permissions: Array.isArray(parsed.permissions)
        ? parsed.permissions
        : undefined,
    };
    localStorage.setItem("token", idToken || accessToken);
    if (accessToken) localStorage.setItem("access_token", accessToken);
    localStorage.setItem("cognito_refresh_token", parsed.refreshToken || "");
    try {
      const meRes = await api.get("/api/auth/me");
      if (meRes.data?.user) {
        user = { ...user, ...meRes.data.user };
      }
      const syncPayload = {};
      if (nameFromCallback) syncPayload.name = nameFromCallback;
      if (imageFromCallback) syncPayload.image = imageFromCallback;
      if (Object.keys(syncPayload).length > 0) {
        const syncRes = await api.put("/api/auth/me", syncPayload);
        if (syncRes.data?.user) user = { ...user, ...syncRes.data.user };
      }
    } catch {
      // Token valid; DB user will be linked on first protected request
    }
    const userForStorage = sanitizeUserForStorage(user);
    if (userForStorage) {
      localStorage.setItem("user", JSON.stringify(userForStorage));
      user = userForStorage;
    }
    return {
      token: idToken || accessToken,
      user,
      employeeData: parsed.employeeData,
    };
  })();

  hubAuthByCode.set(code, promise);
  promise.catch(() => hubAuthByCode.delete(code));
  return promise;
}

// Active release versions
export const activateReleaseVersions = async (projectId, versionId) => {
  try {
    const response = await api.post(
      `/api/projects/${projectId}/versions/${versionId}/activate`,
    );
    return response.data;
  } catch (error) {
    throw (
      error.response?.data || { error: "Failed to activate release version" }
    );
  }
};

// Switch project version (preview) – returns buildUrl for iframe
export const switchProjectVersion = async (
  projectId,
  versionId,
  isPermanent = false,
) => {
  try {
    const response = await api.post(`/api/projects/${projectId}/switch`, {
      versionId: Number(versionId),
      isPermanent,
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to switch version" };
  }
};

/** GET /api/projects/public/:slug — no auth; id, name, releases/versions for client link. */
export const fetchPublicProjectBySlug = async (slug) => {
  try {
    const enc = encodeURIComponent(String(slug).trim());
    const response = await api.get(`/api/projects/public/${enc}`);
    return response.data;
  } catch (error) {
    throw (
      error.response?.data || { error: "Failed to load public project" }
    );
  }
};

export const getProjectDataPublically = fetchPublicProjectBySlug;

export async function fetchHubProfilePicSignedUrl(email) {
  const endpoint = `${config.HUB_API_URL}/api/external/interview/get-profile-pic/${email}`;
  const picKey = config.HUB_PROFILE_PIC_API_KEY;
  const headers = picKey ? { "x-api-key": picKey } : {};
  try {
    const { data } = await axios.get(endpoint, {
      headers,
      validateStatus: (s) => s === 200,
    });
    const raw = data?.url ?? data?.data?.url;
    if (raw == null || typeof raw !== "string" || !raw.trim()) return null;
    return raw.trim();
  } catch {
    return null;
  }
}

// fetch project list form hub
export const fetchExternalHubProjects = async () => {
  if (!HUB_API_URL) {
    throw new Error("Hub API URL is not configured");
  }

  try {
    const token = localStorage.getItem("access_token");

    const res = await axios.get(`${HUB_API_URL}/api/projects/external/list`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    return res.data?.data || [];
  } catch (err) {
    throw new Error(
      err?.response?.data?.message ||
        err?.message ||
        "Failed to fetch projects",
    );
  }
};

/** Set release lifecycle status: draft | active | locked */
export const updateReleaseStatus = async (releaseId, status, reason) => {
  try {
    const response = await api.patch(`/api/releases/${releaseId}/status`, {
      status,
      reason: reason ?? "",
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to update release status" };
  }
};

export const patchRelease = async (releaseId, payload) => {
  try {
    const response = await api.patch(`/api/releases/${releaseId}`, payload);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to update release" };
  }
};

export const fetchReleaseChangelog = async (releaseId) => {
  try {
    const response = await api.get(`/api/releases/${releaseId}/changelog`);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to load release history" };
  }
};

/** POST — regenerate AI “what to review” summary for client link (requires server OPENAI_API_KEY). */
export const regenerateReleaseReviewSummary = async (
  releaseId,
  opts = {},
) => {
  try {
    const body = Object.prototype.hasOwnProperty.call(
      opts,
      "clientReviewAiGenerationContext",
    )
      ? { clientReviewAiGenerationContext: opts.clientReviewAiGenerationContext }
      : {};
    const response = await api.post(
      `/api/releases/${releaseId}/regenerate-review-summary`,
      body,
    );
    return response.data;
  } catch (error) {
    throw (
      error.response?.data || {
        error: "Failed to regenerate review summary",
      }
    );
  }
};
