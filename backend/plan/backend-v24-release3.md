# Backend plan: v24 release 3 — Launchpad Developer Integration

This document describes how to implement, extend, or connect a backend that supports the **Developer Integration** UI in this repository (`frontend/` at repo root; not the `launchpad-frontend/` submodule, which is a separate platform UI reference).

## 1. Scope and components

| Piece | Role |
|--------|------|
| `frontend/` | Vite + React app: projects, releases, client link, integrations, Hub login. |
| `backend/` | Express API + Prisma (PostgreSQL): auth, projects, releases, chat (public), OAuth, Cursor agents, Figma, feedback. |
| `launchpad-frontend/` (submodule) | Reference for grouped API constants and UI patterns; its `apiClient` is mock-only and is **not** wired to this backend. |

The frontend’s HTTP contract with the Launchpad API is centralized in `frontend/src/const/apiEndpoints.js` (`API_ENDPOINTS`). Any backend change that adds or moves routes should update that file and the Express routers under `backend/src/routes/`.

## 2. Authentication and session model

### 2.1 Hub (Anhto) + Cognito

- Users sign in via **Hub OAuth**. The browser exchanges an OAuth `code` for tokens at `GET {HUB_API_URL}/api/auth/callback` (see `frontend/src/api/index.js`, `exchangeHubAuthCode`).
- **Launchpad API** calls use **`Authorization: Bearer <id_token>`** when available (JWT from Cognito with `email` in the payload). The same token may be stored as `token` in `localStorage`.
- **Hub** calls use **`access_token`** (and optional `cognito_refresh_token`) from the same callback response.
- **Token refresh**: `POST {HUB_API_URL}/api/auth/refresh` with `{ refreshToken, email }` (Hub requires `email` for Cognito `SECRET_HASH`). On success, the frontend updates `token`, `access_token`, and `cognito_refresh_token`.
- **Logout**: best-effort `POST {HUB_API_URL}/api/auth/logout` with `Authorization: Bearer <access_token>`.

### 2.2 Launchpad backend verification

- Middleware: `backend/src/middleware/auth.middleware.js` (`authenticateToken`).
- Order of validation: app JWT (`JWT_SECRET`) for legacy compatibility, then **Cognito ID token**, then **Cognito access token** (via JWKS verifiers in `backend/src/utils/cognitoAuth.js`).
- **Public routes** skip Bearer auth (see `backend/src/utils/pathExclusion.js`): e.g. `/api/auth/login`, `/api/auth/register`, `/api/health`, `/api/feedback`, and prefix matches for nested public handlers. **Client-link chat** lives under `/api/chat/:slug/...` and uses **stakeholder email + release** gates in controllers, not the global JWT.

### 2.3 User record in Launchpad DB

- After Hub login, the frontend calls `GET /api/auth/me` and `PUT /api/auth/me` to sync the Launchpad `User` row (Prisma) with profile fields.
- Backend links Cognito identity to `User` by email (`findOrCreateUserFromCognitoPayload`).

## 3. API surface (by mount path)

All paths below are relative to the backend origin (`VITE_API_URL` in the frontend). Implementations live in `backend/src/app.js` and route modules.

| Prefix | Module | Purpose |
|--------|--------|---------|
| `/api/auth` | `auth.routes.js` | Register/login (legacy), `GET/PUT /me` for current user. |
| `/api/integrations` | `oauth.routes.js` | GitHub, Bitbucket, Jira, Figma OAuth start/callback, connection CRUD, repo/project listing, Cursor PAT sync. |
| `/api/figma` | `figma.routes.js` | Figma plugin completion, related flows. |
| `/api/cursor` | `cursor.routes.js` | Cursor Cloud agents (create, status, merge, migrate-frontend pipeline helpers). Requires `CURSOR_API_KEY` where enforced. |
| `/api/chat` | `chat.routes.js` | **Public** client-link: follow-up, messages, agent status, summary, revert-merge, refresh-build, AI preview SVG. |
| `/api/releases` | `release.routes.js` | Release CRUD, lock, status, upload (multipart, long timeout), changelog, review summary regeneration. |
| `/api/projects` | `project.routes.js` | Projects, versions, switch/activate, scratch agent, Jira ticket generation, cursor-rules catalog/import, migrate-frontend, webhooks-related helpers. |
| `/api/feedback` | `feedback.routes.js` | Feedback widget and recording pipeline. |
| `/api/webhooks` | `webhooks.routes.js` | SCM webhooks (raw body for HMAC). Mounted before `express.json` in `app.js`. |
| `/api/health` | inline | Liveness: `{ ok: true }`. |

Swagger UI is served at `/api-docs` when enabled.

## 4. Data contracts (Prisma overview)

Source of truth: `backend/prisma/schema.prisma`. Notable models for the UI:

- **User** — name, email, role, optional `image`; links to created projects and releases.
- **Project** — metadata, `slug` (client link), dev repo URL, OAuth connection FKs, stakeholder/assignee email lists, scratch/migrate-frontend flags.
- **Release** / **ProjectVersion** — versioning, tags, build URLs, lock state, agent/backend-agent fields for automation.
- **UserOAuthConnection** — encrypted tokens per provider; projects reference specific connection rows.
- **ChatHistory** — persisted client-link threads (see chat service).
- **CustomCursorRule** — instance-wide rule packs for Cursor rules import UI.
- **FeedbackRecordingSession** / **FeedbackRecordingMergeJob** — screen recording chunks and Jira merge pipeline.

Run migrations with Prisma from `backend/`; `DATABASE_URL` must point at PostgreSQL.

## 5. External services and secrets

Configure via environment variables (see repo root `.env.example` and `frontend/.env.example`):

- **AWS Cognito** — user pool + app client for JWT verification (`cognitoAuth.js`).
- **Cursor Cloud** — `CURSOR_API_KEY` for agent APIs.
- **GitHub / Bitbucket / Jira / Figma** — OAuth client IDs/secrets and redirect URLs; tokens stored encrypted (token vault utilities).
- **S3** — presigned uploads (e.g. chat images, feedback recordings) if those features are enabled.
- **OpenAI** — optional; used for release “what to review” summary regeneration when `OPENAI_API_KEY` is set.
- **Anthropic** — optional; client-link AI SVG preview path when configured.
- **Hub** — `VITE_HUB_API_URL`, callback redirect, optional `VITE_HUB_PROFILE_PIC_API_KEY` for profile images.

Never expose Cognito client secrets or raw OAuth tokens in API error messages (middleware sanitizes auth errors).

## 6. Deployment considerations

- **CORS**: Default `cors()` plus special handling for Figma iframe origins on selected paths (`app.js`).
- **Body size**: Large JSON limit for upload-related routes; `/api/webhooks` uses raw body for signature verification.
- **Timeouts**: Release ZIP upload and long-running git/deploy operations use extended client timeouts in the frontend (up to ~2h); reverse proxies (nginx) must set matching `proxy_read_timeout` for `/api`.
- **Static assets**: Built UI is served separately; backend serves `/apps` from project build directory and optional `/static`.
- **Iframe preview**: Same-origin proxy `/iframe-preview/<port>/` for live previews (see `iframeProxy` middleware and frontend Vite plugin).

Docker Compose and EC2 guides in the repo root describe orchestration (Postgres, backend, frontend, workers).

## 7. Concrete integration steps

1. **Provision PostgreSQL** and set `DATABASE_URL`; run `npx prisma migrate deploy` in `backend/`.
2. **Configure Cognito** (or temporarily use `JWT_SECRET`-only tokens for dev) so `authenticateToken` can resolve `req.user`.
3. **Set Hub OAuth** URLs: frontend `VITE_HUB_OAUTH_REDIRECT_URL`, `VITE_HUB_API_URL`; Hub app must allow the redirect URI.
4. **Set `VITE_API_URL`** to the public backend base (no trailing slash required if paths are absolute as in `API_ENDPOINTS`).
5. **OAuth providers**: Register redirect URLs pointing to `/api/integrations/.../callback` (see `oauth.routes.js` for exact paths).
6. **Optional Cursor / AI / S3**: add keys and verify `/api/cursor` and chat AI routes return clear 503/400 when misconfigured.
7. **Verify** `GET /api/health`, then log in through Hub, confirm `GET /api/auth/me` returns the synced user.
8. **Keep contracts aligned**: when adding routes, update `frontend/src/const/apiEndpoints.js` and backend Swagger if used by consumers.

## 8. Submodule vs integration frontend

- **`launchpad-frontend`**: TypeScript, Storybook, design tokens, **mock** `apiClient` — useful for UX parity and naming, not a drop-in API client for this backend.
- **`frontend`**: JavaScript, real Axios instance with Hub refresh and **centralized `API_ENDPOINTS`** aligned with that submodule’s convention.

For v24 release 3, treat **`API_ENDPOINTS` + `backend` routes** as the authoritative integration contract between this UI and the Launchpad Developer Integration API.
