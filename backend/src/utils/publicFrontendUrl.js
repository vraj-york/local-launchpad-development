/**
 * Browser-facing SPA base URL (no trailing slash).
 * OAuth callbacks and similar redirects must land on the same origin where the user logged in
 * (localStorage token).
 *
 * Set at least one of:
 * - FRONTEND_URL (preferred for backend)
 * - VITE_FRONTEND_URL (often already set for the frontend build; backend may reuse it)
 */
export function getPublicFrontendBaseUrl() {
  const raw = (
    process.env.FRONTEND_URL ||
    process.env.VITE_FRONTEND_URL ||
    ""
  ).trim();
  if (!raw) {
    throw new Error(
      "Missing FRONTEND_URL and VITE_FRONTEND_URL: set one in the backend environment (e.g. root .env for Docker, backend/.env for local).",
    );
  }
  return raw.replace(/\/+$/, "");
}
