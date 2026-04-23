/**
 * ============================================================
 * FRONTEND CONFIGURATION
 * ============================================================
 *
 * This is the SINGLE SOURCE OF TRUTH for all frontend config.
 *
 * Platform UI reference: the `launchpad-frontend` git submodule (root of this repo)
 * carries the Launchpad design-system / routing patterns used elsewhere; this app is
 * the Developer Integration shell. API path groupings mirror that submodule’s
 * `API_ENDPOINTS` style via `src/const/apiEndpoints.js`.
 *
 * HOW TO SWITCH ENVIRONMENTS:
 * ---------------------------
 * Option 1: Edit the default values below
 * Option 2: Set environment variables (recommended)
 *           Copy frontend/.env.example to frontend/.env and set:
 *           VITE_API_URL=http://localhost:5000
 *           (Vite loads frontend/.env when you run npm run dev from frontend/)
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
  API_URL: import.meta.env.VITE_API_URL || "http://localhost:5000",
  FRONTEND_URL: import.meta.env.VITE_FRONTEND_URL || "http://localhost:5173",

  // Hub (Anhto) API URL - for Google OAuth flow (redirect + callback exchange)
  HUB_API_URL: (
    import.meta.env.VITE_HUB_API_URL || "https://api.uat-hub.allcloudworks.com"
  ).replace(/\/$/, ""),

  /** Hub OAuth return URL — set VITE_HUB_OAUTH_REDIRECT_URL or defaults to FRONTEND_URL/auth/callback */
  HUB_OAUTH_REDIRECT_URL: (
    import.meta.env.VITE_HUB_OAUTH_REDIRECT_URL ||
    `${(import.meta.env.VITE_FRONTEND_URL || "http://localhost:5173").trim().replace(/\/$/, "")}/auth/callback`
  ).replace(/\/$/, ""),

  /** Sent as x-api-key on Hub GET …/get-profile-pic/:email (returns { url }) */
  HUB_PROFILE_PIC_API_KEY: import.meta.env.VITE_HUB_PROFILE_PIC_API_KEY,

  // Current environment (development/production)
  NODE_ENV: import.meta.env.VITE_MODE || "development",

  // Helper to check if running in production
  isProduction: import.meta.env.VITE_MODE === "production",
};

export default config;
