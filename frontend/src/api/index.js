import axios from "axios";
import config from "../config/index.js";

const API_URL = config.API_URL;
const HUB_API_URL = (
  config.HUB_API_URL ||
  import.meta.env.VITE_HUB_API_URL ||
  ""
).replace(/\/$/, "");

// Create axios instance with default config
const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add request interceptor to include auth token
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

// Add response interceptor to handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const isHub = localStorage.getItem("token_source") === "hub";
      if (isHub) {
        return Promise.reject(error);
      }
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("token_source");
      window.location.href = "/";
    }
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

/** Parse Hub /api/auth/callback response (several possible shapes). */
function parseHubAuthResponse(body) {
  if (!body || typeof body !== "object") return null;
  const d =
    body.data != null && typeof body.data === "object" ? body.data : body;
  const token =
    d.token ||
    d.accessToken ||
    d.access_token ||
    body.token ||
    body.accessToken;
  let user = d.user || d.userProfile || d.profile || body.user;
  if (user && typeof user === "string") {
    try {
      user = JSON.parse(user);
    } catch {
      user = null;
    }
  }
  if (!token) return null;
  if (!user || typeof user !== "object") {
    user = {
      id: d.id ?? body.id ?? "user",
      email: d.email ?? body.email ?? "",
      name: d.name ?? d.username ?? body.name ?? "User",
    };
  }
  return { token, user };
}

const hubAuthByCode = new Map();

/**
 * Exchange Hub OAuth code for token. Same code returns cached result (avoids double-call issues).
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
    localStorage.setItem("token", parsed.token);
    localStorage.setItem("user", JSON.stringify(parsed.user));
    localStorage.setItem("token_source", "hub");
    return parsed;
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
