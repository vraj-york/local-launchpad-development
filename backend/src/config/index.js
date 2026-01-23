/**
 * ============================================================
 * BACKEND CONFIGURATION
 * ============================================================
 * 
 * This is the SINGLE SOURCE OF TRUTH for all backend config.
 * 
 * HOW TO SWITCH ENVIRONMENTS:
 * ---------------------------
 * Option 1: Edit the default values below
 * Option 2: Set environment variables (recommended for production)
 *           export BASE_URL=http://43.205.121.85:5000
 *           export PORT=5000
 * 
 * ENVIRONMENT VALUES:
 * -------------------
 * Local Development: http://localhost:5000
 * EC2 Production:    http://43.205.121.85:5000
 * 
 * ============================================================
 */

const config = {
    // Base URL - used for generating build URLs and API responses
    BASE_URL: process.env.BASE_URL || 'http://localhost:5000',

    // Server port
    PORT: process.env.PORT || 5000,

    // Current environment (development/production)
    NODE_ENV: process.env.NODE_ENV || 'development',

    // Helper to check if running in production
    isProduction: process.env.NODE_ENV === 'production',
};

export default config;
