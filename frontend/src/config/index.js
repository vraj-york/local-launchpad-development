/**
 * ============================================================
 * FRONTEND CONFIGURATION
 * ============================================================
 * 
 * This is the SINGLE SOURCE OF TRUTH for all frontend config.
 * 
 * HOW TO SWITCH ENVIRONMENTS:
 * ---------------------------
 * Option 1: Edit the default values below
 * Option 2: Set environment variables (recommended for production)
 *           Create a .env file in frontend root:
 *           VITE_API_URL=http://43.205.121.85:5000
 * 
 * ENVIRONMENT VALUES:
 * -------------------
 * Local Development: http://localhost:5000
 * EC2 Production:    http://43.205.121.85:5000
 * 
 * ============================================================
 */

const config = {
    // Backend API URL - where the frontend sends all API requests
    API_URL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
    FRONTEND_URL: import.meta.env.VITE_FRONTEND_URL || 'http://localhost:5173',

    // Current environment (development/production)
    NODE_ENV: import.meta.env.MODE || 'development',

    // Helper to check if running in production
    isProduction: import.meta.env.MODE === 'production',
    GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID || "516448789962-jhsndv38lfpdt30h334j8khu825fried.apps.googleusercontent.com",
};

export default config;
