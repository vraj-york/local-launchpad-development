import axios from 'axios';
import config from '../config/index.js';

const API_URL = config.API_URL;

// Create axios instance with default config
const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add request interceptor to include auth token
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Add response interceptor to handle auth errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/';
        }
        return Promise.reject(error);
    }
);

// Function to handle user login
export const loginUser = async (credentials) => {
    try {
        const response = await axios.post(`${API_URL}/api/auth/login`, credentials);
        const { token, user } = response.data;

        // Store token and user data
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));

        return { token, user };
    } catch (error) {
        throw error.response?.data || { error: 'Login failed' };
    }
};

// Function to register a new user
export const registerUser = async (userData) => {
    try {
        const response = await axios.post(`${API_URL}/api/auth/register`, userData);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Registration failed' };
    }
};

// Function to fetch all managers
export const fetchManagers = async () => {
    try {
        const response = await api.get('/api/auth/managers');
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to fetch managers' };
    }
};

// Function to create a new project
export const createProject = async (projectData) => {
    console.log(projectData);
    try {
        const response = await api.post('/api/projects', projectData);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to create project' };
    }
};

// Function to fetch all projects
export const fetchProjects = async () => {
    try {
        const response = await api.get('/api/projects');
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to fetch projects' };
    }
};

// Function to fetch project details by ID
export const fetchProjectById = async (projectId) => {
    try {
        const response = await api.get(`/api/projects/${projectId}`);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to fetch project' };
    }
};

// Function to get project live URL
export const getProjectLiveUrl = async (projectId) => {
    try {
        const response = await api.get(`/api/projects/${projectId}/live-url`);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to get live URL' };
    }
};

// Function to upload project build
export const uploadProjectBuild = async (projectId, file, version = null) => {
    try {
        const formData = new FormData();
        formData.append('project', file);
        if (version) {
            formData.append('version', version);
        }

        const response = await api.post(`/api/projects/${projectId}/upload`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to upload project' };
    }
};

// Function to get project versions
export const getProjectVersions = async (projectId) => {
    try {
        const response = await api.get(`/api/projects/${projectId}/versions`);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to fetch versions' };
    }
};

// Function to activate a version
export const activateVersion = async (projectId, versionId) => {
    try {
        const response = await api.post(`/api/projects/${projectId}/versions/${versionId}/activate`);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to activate version' };
    }
};

// Function to get project diff summary
export const fetchProjectDiff = async (projectId) => {
    try {
        const response = await api.get(`/api/projects/${projectId}/diff-summary`);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to fetch project diff' };
    }
};

// Function to get detailed project git diff with file contents
export const fetchProjectGitDiff = async (projectId) => {
    try {
        const response = await api.get(`/api/projects/${projectId}/git-diff`);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to fetch project git diff' };
    }
};

// Release Management API Functions

// Function to fetch all releases for a project
export const fetchReleases = async (projectId) => {
    try {
        const response = await api.get(`/api/releases/project/${projectId}`);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to fetch releases' };
    }
};

// Function to create a new release
export const createRelease = async (releaseData) => {
    try {
        const response = await api.post('/api/releases', releaseData);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to create release' };
    }
};

// Function to lock/unlock a release
export const toggleReleaseLock = async (releaseId, locked) => {
    try {
        const response = await api.post(`/api/releases/${releaseId}/lock`, { locked });
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to toggle release lock' };
    }
};

// Function to upload ZIP to a release
export const uploadToRelease = async (releaseId, file, version = null) => {
    try {
        const formData = new FormData();
        formData.append('project', file);
        if (version) {
            formData.append('version', version);
        }

        const response = await api.post(`/api/releases/${releaseId}/upload`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to upload to release' };
    }
};


// Function to generate Jira tickets from git diff summary
export const generateJiraTickets = async (projectId) => {
    try {
        const response = await api.post(`/api/projects/${projectId}/generate-jira-tickets`);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to generate Jira tickets' };
    }
};

// Function to test Jira connection
export const testJiraConnection = async () => {
    try {
        const response = await api.get('/api/projects/jira/test-connection');
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to test Jira connection' };
    }
};

// Function to update a project
export const updateProject = async (projectId, projectData) => {
    try {
        const response = await api.put(`/api/projects/${projectId}`, projectData);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to update project' };
    }
};

// Function to delete a roadmap
export const deleteRoadmap = async (roadmapId) => {
    try {
        const response = await api.delete(`/api/roadmaps/${roadmapId}`);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to delete roadmap' };
    }
};

// Function to delete a roadmap item
export const deleteRoadmapItem = async (roadmapId, itemId) => {
    try {
        const response = await api.delete(`/api/roadmaps/${roadmapId}/items/${itemId}`);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to delete roadmap item' };
    }
};

//Get Roadmap Items by projectID
export const getRoadmapItemsByProjectId = async (projectId) => {
    try {
        const response = await api.get(`/api/roadmaps/project/${projectId}/items`);
        return response.data;
    } catch (error) {
        throw error.response?.data || { error: 'Failed to fetch roadmap items' };
    }
};
