# Final plan: iframe proxy in backend for production

**Context:** Latest from main uses `docker-compose.yml` with backend nginx on **8888:80**, API on **5000**, frontend on **3000** (see EC2_DEPLOYMENT.md). This plan adds the iframe proxy **only in the backend**, does not change any other backend behavior, and is designed to work in production on first deploy.

**Goal:** In production, the Client Link page iframe should load the project build (no 404). For html2canvas screenshot to work, the iframe must be same-origin with the parent; this plan achieves that by having the frontend use the **backend** origin for the iframe in production (see same-origin requirement below).

---

## 1. Backend: add iframe proxy only (no other changes)

### 1.1 Dependency

- **File:** `backend/package.json`
- **Change:** Add `"http-proxy-middleware": "^2.0.6"` (or a version compatible with Node 20 and existing stack). Run `npm install` in backend.

### 1.2 New proxy middleware

- **File:** `backend/src/middleware/iframeProxy.js` (new)
- **Responsibility:**
  - Match `GET /iframe-preview/:port/*` (e.g. `/iframe-preview/8001/`, `/iframe-preview/8001/assets/main.js`).
  - Proxy to `http://127.0.0.1:<port>` (project static servers run in the same container).
  - For requests that do not match the path but have a **Referer** header containing `/iframe-preview/<port>`, proxy to `http://127.0.0.1:<port>` (so JS/CSS/assets loaded inside the iframe are also proxied). Skip internal paths like `/api/` so API calls are not proxied.
  - Use `http-proxy-middleware` with `pathRewrite` to strip the `/iframe-preview/<port>` prefix before sending to the target.
  - Set appropriate headers: `Host`, `X-Forwarded-*`, etc., so the project server sees a normal request.

- **Safety:** Do not depend on any existing routes or services; only read `req.url`, `req.headers.referer`, and forward to localhost. No changes to auth, project, or release logic.

### 1.3 Mount proxy in app (before other routes)

- **File:** `backend/src/app.js`
- **Change:** Mount the iframe proxy middleware **before** `app.use("/apps", ...)` and before any static or API routes, so `/iframe-preview/...` is handled first.
  - Example: `app.use(iframeProxy);` near the top, after CORS and JSON body parser, so that proxy routes do not get JSON body or CORS logic in the way (proxy is GET/asset requests only).

- **No other changes:** Do not modify `/api/*`, `/apps`, `/login`, `/static`, error middleware, or swagger.

---

## 2. Frontend: use backend origin for iframe in production

- **File:** `frontend/src/pages/ClientLink.jsx`
- **Current behavior:** `toProxyUrl` returns a **relative** path `/iframe-preview/<port>/...`, which is same-origin in local dev (Vite serves it) but in production is requested to the frontend origin (3000), where no proxy exists → 404.
- **Change:** In **production** (e.g. when `config.isProduction` or when `import.meta.env.PROD` is true), build the iframe URL with the **backend (API) origin**:  
  `iframeSrc = config.API_URL + '/iframe-preview/' + port + pathname + search + hash`  
  so the iframe loads from the backend (e.g. `http://launchpad.yorkdevs.link:5000/iframe-preview/8001/`). In **development**, keep the current behavior so the iframe stays same-origin with the Vite dev server (relative `/iframe-preview/...`).
- **Result:** In production the iframe loads from the backend and no longer 404s. Parent page remains on frontend (3000); iframe is on backend (5000) → **different origins**, so html2canvas still cannot read the iframe document.

---

## 3. Same-origin for production (screenshot with html2canvas)

For **screenshot to work in production**, the page and the iframe must be **same-origin**. With the proxy only on the backend, that implies the **frontend app must be served from the same origin as the backend** (e.g. both on port 5000).

### 3.1 Option A – Serve frontend from backend (recommended for “works first time”)

- Backend serves the built frontend SPA (e.g. from a `frontend-dist` or `public` directory) on `/` or a path like `/app`, and continues to serve API on `/api` and proxy on `/iframe-preview`.
- Users open the app at the **backend** URL (e.g. `http://launchpad.yorkdevs.link:5000`). The Client Link page and the iframe (`/iframe-preview/8001/`) are then same-origin → html2canvas can capture the iframe.
- **Implementation outline (no code changes in this plan):**
  - Build the frontend (e.g. `npm run build` in frontend) with `VITE_API_URL` and `VITE_FRONTEND_URL` set to the backend URL (e.g. `http://launchpad.yorkdevs.link:5000`).
  - Copy or mount the frontend `dist/` into the backend container (e.g. in Dockerfile or via volume).
  - In the backend app, **before** the iframe proxy, serve static files from that directory for non-API, non-iframe-preview routes, with SPA fallback (e.g. `index.html` for `GET /`, `GET /projects/...`, etc.). The iframe proxy continues to handle only `/iframe-preview/...`.
- **Deployment:** Single backend container (or backend + nginx) exposes one origin (e.g. 5000). Frontend container can be used only to build the artifact, or removed from production compose if frontend is always served by backend.

### 3.2 Option B – Keep frontend on 3000

- If the app stays on port 3000 and the iframe loads from port 5000, they remain cross-origin and **screenshot in production will not work** unless you later add the same proxy to the frontend server (as in the earlier frontend-proxy plan) so the iframe is also served from 3000.

---

## 4. What must not change (backend)

- No changes to:
  - Auth, project, release, roadmap, feedback, figma, cursor routes or controllers.
  - `/apps`, `/login`, `/static`, error middleware, swagger.
  - Nginx config, entrypoint, or project server startup.
- Only additions: one new dependency, one new middleware file, one `app.use(iframeProxy)` in `app.js`, and the frontend `ClientLink.jsx` logic for production iframe URL.

---

## 5. Production checklist (first-time, no errors)

1. **Backend**
   - Add `http-proxy-middleware` and `iframeProxy.js`, mount it in `app.js` as above.
   - Ensure no other middleware or routes are modified.

2. **Frontend**
   - In production, set iframe `src` to `config.API_URL + '/iframe-preview/' + port + path` when using the proxy path (so the request hits the backend).

3. **Deploy**
   - Build backend image (with new dependency and middleware).
   - Build frontend with correct `VITE_API_URL` / `VITE_FRONTEND_URL` (backend URL if using Option A).
   - If using Option A: serve frontend from backend and open the app at the backend URL (e.g. `:5000`). Then Client Link iframe loads and screenshot works.
   - If using Option B: open app at frontend URL (`:3000`). Client Link iframe loads (no 404); screenshot in production will not work until you add same-origin (e.g. serve frontend from backend or add proxy to frontend).

4. **Verification**
   - Open Client Link for a project with a buildUrl.
   - Confirm iframe loads (no 404, content is the project build).
   - If same-origin (Option A): confirm feedback/screenshot captures the iframe. If cross-origin (Option B): expect screenshot to exclude or fail on iframe content.

---

## 6. Summary

| Item | Action |
|------|--------|
| Backend | Add `http-proxy-middleware`; add `iframeProxy.js`; mount in `app.js` before other routes. No other backend changes. |
| Frontend | In production, build iframe URL with `config.API_URL` so iframe loads from backend. |
| Same-origin (screenshot in prod) | Serve frontend from backend (Option A) so app and iframe share one origin. |
| EC2 / docker-compose | No change required for proxy-only; for Option A, add frontend build to backend and optionally adjust ports/flow. |

This keeps the proxy entirely in the backend, isolates it from existing behavior, and allows production to work on first deploy; for html2canvas in production, use Option A (serve frontend from backend).
