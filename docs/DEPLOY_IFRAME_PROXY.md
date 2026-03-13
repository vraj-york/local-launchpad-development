# Deploy: Iframe proxy (Client Link + screenshot)

Use this checklist when deploying so the **Client Link** iframe and **html2canvas screenshot** work in production (e.g. `launchpad.yorkdevs.link`).

---

## 1. Reverse proxy: route `/iframe-preview` to the backend

Your app and API are on the same host (e.g. `launchpad.yorkdevs.link` and `launchpad.yorkdevs.link/api`). The iframe uses the path `/iframe-preview/<port>/...`, which must be sent to the **backend** (same place as `/api`), not to the frontend.

**Add this to your production reverse proxy (nginx, Caddy, etc.):**

```nginx
# Iframe preview proxy — same origin as the app for html2canvas
location /iframe-preview/ {
    proxy_pass http://localhost:5000;   # backend (or your backend upstream name)
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

- **Important:** This block must be on the **same server/vhost** that serves the frontend and `/api`, so the browser sees one origin (e.g. `https://launchpad.yorkdevs.link`).
- If you use an upstream name for the API (e.g. `proxy_pass http://backend;`), use that same upstream for `/iframe-preview/`.

---

## 2. Deploy order and build

1. **Backend**  
   - Ensure `http-proxy-middleware` is in `backend/package.json` and run `npm install` before building the image.  
   - Rebuild backend image:  
     `docker compose build backend`  
   - Restart:  
     `docker compose up -d backend`

2. **Frontend**  
   - No code changes needed for the iframe.  
   - Rebuild only if you changed frontend:  
     `docker compose build frontend`  
     `docker compose up -d frontend`

3. **Reverse proxy**  
   - Add or update the `/iframe-preview/` location block (step 1).  
   - Reload nginx (or your proxy):  
     `sudo nginx -t && sudo systemctl reload nginx`

---

## 3. Keep in mind at deploy time

| Item | Why |
|------|-----|
| **Same origin** | Frontend, `/api`, and `/iframe-preview/` must be served from the **same host** (e.g. `launchpad.yorkdevs.link`). If `/iframe-preview/` goes to a different host or port, the iframe will be cross-origin and screenshot will fail. |
| **Backend port** | The proxy in the backend runs inside the Node app (port 5000). Your reverse proxy must forward `/iframe-preview/` to that same backend (e.g. `http://localhost:5000` or the backend container). |
| **Project ports** | Project builds run inside the backend container on 8001, 8002, etc. The backend proxy forwards to `127.0.0.1:<port>`; no extra firewall or port exposure needed for the iframe path. |
| **No frontend change** | The frontend keeps using the relative URL `/iframe-preview/8001/`. Do **not** point the iframe to a different host/port (e.g. `:5000`) when you have a single-host reverse proxy. |
| **HTTPS** | If the site is HTTPS, ensure `X-Forwarded-Proto` is set (as in the snippet) so the backend and proxied app see the correct scheme. |

---

## 4. Verify after deploy

1. Open the app: `https://launchpad.yorkdevs.link` (or your URL).
2. Go to a project and open **Client Link** (or the public project page with the iframe).
3. **Iframe loads:** The preview content (project build) should appear in the iframe, not a 404 or blank.
4. **Screenshot:** Use the feedback/screenshot feature. The captured image should include the **iframe content** (not a grey/blank area). If it does, same-origin is correct.

If the iframe is 404: check that the reverse proxy forwards `/iframe-preview/` to the backend and that the backend container is running.  
If the iframe loads but screenshot does not include it: the iframe is likely cross-origin; ensure `/iframe-preview/` is on the same host as the app (reverse proxy config).

---

## 5. Quick reference

- **Backend middleware:** `backend/src/middleware/iframeProxy.js` (proxies `/iframe-preview/<port>/*` → `http://127.0.0.1:<port>/*`).
- **Mounted in:** `backend/src/app.js` (before `/apps`, `/api`, etc.).
- **Frontend:** No changes; uses relative path `/iframe-preview/<port>/...` in `ClientLink.jsx`.
- **Local dev:** Vite dev server has its own iframe proxy; no reverse proxy needed locally.
