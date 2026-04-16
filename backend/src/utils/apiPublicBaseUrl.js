import { WEBHOOK_PATHS } from "../constants/contstants.js";

/**
 * Public origin used to build SCM webhook callback URLs (`{origin}/api/webhooks/...`).
 * No trailing slash.
 *
 * Resolution order (first non-empty wins):
 * 1. `NGROK_URL` — local tunnel (e.g. `npm run dev:ngrok` or manual ngrok)
 * 2. `FRONTEND_URL` — explicit public origin (optional; many deployments omit this on the backend)
 * 3. `VITE_FRONTEND_URL` — same public origin as the SPA; **often the only one set** in `backend/.env` because
 *    `app.js` loads repo-root `.env` first (Docker / monorepo usually define `VITE_*` there, not `FRONTEND_URL`)
 * 4. `BASE_URL` — this API’s own origin (fallback; localhost is not reachable by GitHub/Bitbucket for delivery)
 *
 * @returns {string | null}
 */
export function getApiPublicBaseUrl() {
  const candidates = [
    process.env.NGROK_URL,
    process.env.FRONTEND_URL,
    process.env.VITE_FRONTEND_URL,
    process.env.BASE_URL,
  ];
  for (const c of candidates) {
    const raw = (c || "").trim();
    if (raw) return raw.replace(/\/+$/, "");
  }
  return null;
}

/** @returns {string | null} */
export function getLaunchpadGithubPushWebhookUrl() {
  const b = getApiPublicBaseUrl();
  return b ? `${b}${WEBHOOK_PATHS.GITHUB_PUSH}` : null;
}

/** @returns {string | null} */
export function getLaunchpadBitbucketPushWebhookUrl() {
  const b = getApiPublicBaseUrl();
  return b ? `${b}${WEBHOOK_PATHS.BITBUCKET_PUSH}` : null;
}
