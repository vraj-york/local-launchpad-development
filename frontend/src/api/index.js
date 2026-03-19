import axios from "axios";
import config from "../config/index.js";
import { isTokenExpiringSoon } from "../utils/auth.js";

const API_URL = config.API_URL;

/** Refresh token proactively this many seconds before access token expires. */
const PROACTIVE_REFRESH_BUFFER_SEC = 5 * 60; // 5 minutes
/** How often to check if we should refresh (ms). */
const REFRESH_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
const HUB_API_URL = (config.HUB_API_URL || "").replace(/\/$/, "");

// Create axios instance with default config
const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Backend/launchpad APIs: always use app token (from login, Google, or Cognito exchange)
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

/** Same token is used for launchpad and Hub APIs. */
export function getCognitoAccessToken() {
  return localStorage.getItem("token") || localStorage.getItem("cognito_access_token");
}

/** Get employee data from /auth/callback format (email, employee_id, first_name, last_name, account_status, user_type). */
export function getEmployeeData() {
  try {
    const raw = localStorage.getItem("employee_data");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Get permissions array from callback (stored as JSON). */
export function getPermissions() {
  try {
    const raw = localStorage.getItem("permissions");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function clearAuthAndRedirect() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("token_source");
  localStorage.removeItem("cognito_access_token");
  localStorage.removeItem("cognito_id_token");
  localStorage.removeItem("cognito_refresh_token");
  localStorage.removeItem("employee_data");
  localStorage.removeItem("token_expires_in");
  localStorage.removeItem("permissions");
  window.location.href = "/";
}

/**
 * Call Hub's refresh API to get new tokens. Hub requires refreshToken + email (for Cognito SECRET_HASH).
 * POST HUB_API_URL/api/auth/refresh with { refreshToken, email }.
 */
function getStoredEmail() {
  try {
    const user = localStorage.getItem("user");
    if (user) {
      const parsed = JSON.parse(user);
      if (parsed?.email) return parsed.email;
    }
    const emp = localStorage.getItem("employee_data");
    if (emp) {
      const parsed = JSON.parse(emp);
      if (parsed?.email) return parsed.email;
    }
  } catch { }
  return null;
}

const DEBUG_REFRESH = import.meta.env.DEV && import.meta.env.VITE_DEBUG_REFRESH === "true";

/** Call Hub API to refresh tokens (Hub validates with Cognito; email required for SECRET_HASH). */
export async function refreshAppToken() {
  const refreshToken = localStorage.getItem("cognito_refresh_token");
  const email = getStoredEmail();
  if (!refreshToken || !email) {
    if (DEBUG_REFRESH) console.log("[Refresh] Skip: no refreshToken or email");
    return null;
  }
  if (!HUB_API_URL) {
    if (DEBUG_REFRESH) console.log("[Refresh] Skip: HUB_API_URL not set");
    return null;
  }
  try {
    if (DEBUG_REFRESH) console.log("[Refresh] Calling Hub", HUB_API_URL + "/api/auth/refresh");
    const { data } = await axios.post(`${HUB_API_URL}/api/auth/refresh`, {
      refreshToken,
      email,
    });
    const body = data?.data ?? data;
    const idToken = body?.idToken ?? body?.id_token;
    const accessToken = body?.accessToken ?? body?.access_token;
    const newRefreshToken = body?.refreshToken ?? body?.refresh_token;
    const newToken = idToken ?? accessToken;
    if (newToken) {
      localStorage.setItem("token", newToken);
      if (idToken) localStorage.setItem("cognito_id_token", idToken);
      if (accessToken) localStorage.setItem("cognito_access_token", accessToken);
      if (newRefreshToken) localStorage.setItem("cognito_refresh_token", newRefreshToken);
      if (body?.user) localStorage.setItem("user", JSON.stringify(body.user));
      if (DEBUG_REFRESH) console.log("[Refresh] Success: new token stored");
      return newToken;
    }
  } catch (err) {
    if (DEBUG_REFRESH) console.warn("[Refresh] Failed", err?.response?.status, err?.response?.data || err?.message);
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
  if (token && !isTokenExpiringSoon(token, PROACTIVE_REFRESH_BUFFER_SEC)) return false;
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

// Function to handle user login
export const loginUser = async (credentials) => {
  try {
    const response = await axios.post(`${API_URL}/api/auth/login`, credentials);
    const { token, user } = response.data;

    // Store token and user data
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("token_source", "app");

    return { token, user };
  } catch (error) {
    throw error.response?.data || { error: "Login failed" };
  }
};

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

// Function to register a new user
export const registerUser = async (userData) => {
  try {
    const response = await axios.post(`${API_URL}/api/auth/register`, userData);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Registration failed" };
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

// Function to get project live URL
export const getProjectLiveUrl = async (projectId) => {
  try {
    const response = await api.get(`/api/projects/${projectId}/live-url`);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to get live URL" };
  }
};

// Function to upload project build
export const uploadProjectBuild = async (projectId, file, version = null) => {
  try {
    const formData = new FormData();
    formData.append("project", file);
    if (version) {
      formData.append("version", version);
    }

    const response = await api.post(
      `/api/projects/${projectId}/upload`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
    );
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to upload project" };
  }
};

// Function to get project versions
export const getProjectVersions = async (projectId) => {
  try {
    const response = await api.get(`/api/projects/${projectId}/versions`);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to fetch versions" };
  }
};

// Function to activate a version
export const activateVersion = async (projectId, versionId) => {
  try {
    const response = await api.post(
      `/api/projects/${projectId}/versions/${versionId}/activate`,
    );
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to activate version" };
  }
};

// Function to get project diff summary
export const fetchProjectDiff = async (projectId) => {
  try {
    const response = await api.get(`/api/projects/${projectId}/diff-summary`);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to fetch project diff" };
  }
};

// Function to get detailed project git diff with file contents
export const fetchProjectGitDiff = async (projectId) => {
  try {
    const response = await api.get(`/api/projects/${projectId}/git-diff`);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to fetch project git diff" };
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

export const publicLockRelease = async (releaseId, locked, token) => {
  try {
    const response = await api.post(`/api/releases/${releaseId}/public-lock`, {
      locked,
      token,
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to lock release" };
  }
};

// Function to upload ZIP to a release
export const uploadToRelease = async (
  releaseId,
  file,
  version = null,
  roadmapItemIds,
) => {
  try {
    const formData = new FormData();
    formData.append("project", file);
    if (version) {
      formData.append("version", version);
    }
    if (roadmapItemIds) {
      formData.append("roadmapItemIds", roadmapItemIds);
    }
    const response = await api.post(
      `/api/releases/${releaseId}/upload`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
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

// Function to test Jira connection
export const testJiraConnection = async () => {
  try {
    const response = await api.get("/api/projects/jira/test-connection");
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to test Jira connection" };
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

// Function to delete a roadmap
export const deleteRoadmap = async (roadmapId) => {
  try {
    const response = await api.delete(`/api/roadmaps/${roadmapId}`);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to delete roadmap" };
  }
};

// Function to delete a roadmap item
export const deleteRoadmapItem = async (roadmapId, itemId) => {
  try {
    const response = await api.delete(
      `/api/roadmaps/${roadmapId}/items/${itemId}`,
    );
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to delete roadmap item" };
  }
};

//Get Roadmap Items by projectID
export const getRoadmapItemsByProjectId = async (projectId) => {
  try {
    const response = await api.get(`/api/roadmaps/project/${projectId}/items`);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to fetch roadmap items" };
  }
};

//Update Roadmap Items by ProjectID
export const updateRoadmapByProjectId = async (projectId, roadmapData) => {
  try {
    const res = await api.put(
      `/api/roadmaps/project/${projectId}`,
      roadmapData,
    );
    return res.data;
  } catch (error) {
    throw error.response?.data || { error: "Failed to update roadmap" };
  }
};

// Function to handle Google Login (local backend, ID token)
export const googleLogin = async (token) => {
  try {
    const response = await axios.post(`${API_URL}/api/auth/google`, { token });
    const { token: jwtToken, user } = response.data;
    // Store token and user data
    localStorage.setItem("token", jwtToken);
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("token_source", "app");
    return { token: jwtToken, user };
  } catch (error) {
    throw error.response?.data || { error: "Google Login failed" };
  }
};

/**
 * Parse Hub /auth/callback response format:
 * { success, data: { accessToken, refreshToken, idToken, expiresIn, permissions, employeeData: { email, employee_id, account_status, user_type, first_name, last_name } } }
 */
function parseHubAuthResponse(body) {
  if (!body || typeof body !== "object") return null;
  const d =
    body.data != null && typeof body.data === "object" ? body.data : body;
  const accessToken =
    d.accessToken ?? d.access_token ?? body.accessToken ?? body.access_token;
  const idToken = d.idToken ?? d.id_token ?? body.idToken ?? body.id_token;
  const refreshToken =
    d.refreshToken ?? d.refresh_token ?? body.refreshToken ?? body.refresh_token;
  const token =
    idToken ??
    accessToken ??
    d.token ??
    d.accessToken ??
    d.access_token ??
    body.token ??
    body.accessToken;
  if (!token) return null;

  const emp = d.employeeData && typeof d.employeeData === "object" ? d.employeeData : null;
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
  let user =
    d.user || d.userProfile || d.profile || body.user;
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
    token,
    idToken: idToken || token,
    accessToken: accessToken || token,
    refreshToken: refreshToken || null,
    expiresIn: d.expiresIn ?? body.expiresIn,
    permissions: d.permissions ?? body.permissions ?? [],
    employeeData: emp || null,
    user,
  };
}

const hubAuthByCode = new Map();

/**
 * Exchange Hub OAuth code for Cognito tokens. Same token is used for launchpad APIs and Hub APIs.
 * Backend verifies Cognito credentials and links to launchpad DB user on each request.
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
    const token = parsed.idToken || parsed.token;
    if (!token) throw new Error("No token in callback response");
    localStorage.setItem("token", token);
    if (parsed.accessToken)
      localStorage.setItem("cognito_access_token", parsed.accessToken);
    if (parsed.idToken) localStorage.setItem("cognito_id_token", parsed.idToken);
    if (parsed.refreshToken)
      localStorage.setItem("cognito_refresh_token", parsed.refreshToken);
    if (parsed.employeeData) {
      localStorage.setItem("employee_data", JSON.stringify(parsed.employeeData));
    }
    if (parsed.expiresIn != null) {
      localStorage.setItem("token_expires_in", String(parsed.expiresIn));
    }
    if (Array.isArray(parsed.permissions)) {
      localStorage.setItem("permissions", JSON.stringify(parsed.permissions));
    }
    const nameFromCallback =
      parsed.user?.name ??
      [parsed.employeeData?.first_name, parsed.employeeData?.last_name].filter(Boolean).join(" ").trim();
    const imageFromCallback =
      parsed.user?.image ??
      parsed.employeeData?.profile_pic
    let user = {
      ...parsed.user,
      email: parsed.user?.email ?? parsed.employeeData?.email,
      name: nameFromCallback || parsed.user?.name,
      image: imageFromCallback ?? parsed.user?.image,
    };
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
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("token_source", "cognito");
    return { token, user, cognitoAccessToken: parsed.accessToken || token, employeeData: parsed.employeeData };
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

// get project data publically
export const getProjectDataPublically = async (projectId) => {
  try {
    const response = await api.get(`/api/projects/public/${projectId}`);
    return response.data;
  } catch (error) {
    throw (
      error.response?.data || { error: "Failed to get project data publically" }
    );
  }
};
