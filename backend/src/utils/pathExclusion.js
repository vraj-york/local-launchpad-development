/**
 * Paths that do not require Bearer auth (e.g. login, refresh, health).
 * Used so auth middleware can skip validation for these routes when applied globally.
 */
const EXCLUDED_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/google",
  "/api/auth/refresh",
  "/api/health",
  "/api/feedback",
  "/api-docs",
  "/static",
];

/**
 * Check if the request path should skip auth (same logic as York IE isExcludedPath).
 * @param {string} fullPath - req.baseUrl or req.originalUrl (path only)
 * @returns {boolean}
 */
export function isExcludedPath(fullPath) {
  if (!fullPath || typeof fullPath !== "string") return false;
  const path = fullPath.split("?")[0].replace(/\/$/, "") || "/";
  return EXCLUDED_PATHS.some((excluded) => path === excluded || path.startsWith(excluded + "/"));
}
