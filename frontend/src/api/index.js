import axios from 'axios';

const API_URL = 'http://localhost:5000';

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