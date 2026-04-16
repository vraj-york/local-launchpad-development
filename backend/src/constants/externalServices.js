/**
 * Stable third-party API roots, Launchpad webhook path suffixes, and shared patterns.
 * Prefer importing from here instead of duplicating literals across services.
 */

/** GitHub REST API root (no trailing slash). */
export const GITHUB_API = "https://api.github.com";

/** Bitbucket Cloud 2.0 API root. */
export const BITBUCKET_API = "https://api.bitbucket.org/2.0";

/** Atlassian Cloud API root (Jira 3LO, profile, accessible resources). */
export const ATLASSIAN_API = "https://api.atlassian.com";

/** Bitbucket Cloud OAuth 2 token endpoint (authorization_code / refresh_token). */
export const BITBUCKET_OAUTH_TOKEN_URL = "https://bitbucket.org/site/oauth2/access_token";

/** Cursor Cloud Agents HTTP API root. */
export const CURSOR_API_BASE_URL = "https://api.cursor.com";

/** OpenAI Chat Completions (v1) endpoint. */
export const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Path only — must match `app.use("/api/webhooks", …)` + `webhooks.routes.js` routes.
 * Used when comparing GitHub hook `config.url` pathnames to Launchpad’s callback.
 */
export const LAUNCHPAD_GITHUB_HOOK_PATH = "/api/webhooks/github/push";

export const LAUNCHPAD_BITBUCKET_HOOK_PATH = "/api/webhooks/bitbucket/push";

/** Git commit SHA hex (short or full). */
export const GIT_SHA_RE = /^[0-9a-f]{7,40}$/i;
