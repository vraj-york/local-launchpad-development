/**
 * Per-project static file servers on each project's assigned port.
 * Makes http://localhost:<port>/index.html (and nginx proxy) work for each project.
 */
import http from "http";
import express from "express";
import path from "path";
import fs from "fs-extra";
import { getBackendRoot } from "./utils/instanceRoot.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const HOST = "0.0.0.0"; // so nginx container and host can reach
const activeServers = new Map(); // port -> server

const EMPTY_PLACEHOLDER_HTML = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Project</title></head>
<body>
  <p>Project folder is empty or no release deployed yet.</p>
  <p>Deploy a release from the platform to see your app here, or open <code>/apps/&lt;project-name&gt;/</code> on the main API (port 5000).</p>
</body></html>
`;

const PREVIEW_COOKIE = "preview";
const PREVIEW_COOKIE_MAX_AGE = 60 * 60; // 1 hour — matches PREVIEW_TTL_MS cleanup in project.service

/** Strip ?preview=1 from URL bar; keep cookie so assets still load from preview */
const PREVIEW_CLEANUP_SCRIPT = `
<script>
(function(){
  if (window.location.search.indexOf('preview=1') !== -1) {
    try { history.replaceState({}, '', window.location.pathname + window.location.hash); } catch(e) {}
  }
})();
</script>
</head>
`;

function parsePreviewCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return false;
  const m = raw.match(new RegExp("(?:^|;\\s*)" + PREVIEW_COOKIE + "=1(?:;|$)"));
  return !!m;
}

function createStaticServer(absoluteDir, projectId = null) {
  const backendRoot = getBackendRoot();
  const previewDir = projectId != null
    ? path.join(backendRoot, "_preview", `project_${projectId}`, "serve")
    : null;

  const app = express();
  app.use((_req, res, next) => {
    res.setHeader("Content-Security-Policy", "connect-src 'self'");
    next();
  });

  const chooseRoot = (req) => {
    if (!previewDir || !fs.existsSync(previewDir)) return absoluteDir;
    const isDocRequest = req.path === "/" || req.path === "/index.html";
    if (isDocRequest && !(req.query && req.query.preview === "1")) {
      return absoluteDir;
    }
    if (req.query && req.query.preview === "1") return previewDir;
    if (!isDocRequest && parsePreviewCookie(req)) return previewDir;
    return absoluteDir;
  };

  const clearPreviewCookie = (res) => {
    res.setHeader("Set-Cookie", `${PREVIEW_COOKIE}=; Path=/; Max-Age=0`);
  };

  const setPreviewCookie = (res) => {
    res.setHeader("Set-Cookie", `${PREVIEW_COOKIE}=1; Path=/; Max-Age=${PREVIEW_COOKIE_MAX_AGE}; SameSite=Lax`);
  };

  const ASSET_EXT_RE =
    /\.(?:mjs|cjs|js|css|map|json|txt|xml|webmanifest|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|pdf)$/i;
  const isStaticAssetRequest = (req) => ASSET_EXT_RE.test(String(req.path || ""));

  // Keep preview cookie state aligned before static file lookup.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!previewDir || !fs.existsSync(previewDir)) {
      if (req.path === "/" || req.path === "/index.html") clearPreviewCookie(res);
      return next();
    }
    if (req.query && req.query.preview === "1") {
      setPreviewCookie(res);
    } else if ((req.path === "/" || req.path === "/index.html") && !parsePreviewCookie(req)) {
      // Visiting the live doc without an existing preview session should clear stale preview state.
      clearPreviewCookie(res);
    }
    next();
  });

  // Fallback for / or /index.html when file is missing (empty project dir)
  app.use((req, res, next) => {
    if ((req.path !== "/" && req.path !== "/index.html") || (req.method !== "GET" && req.method !== "HEAD")) return next();
    const root = chooseRoot(req);
    if (req.path === "/" || req.path === "/index.html") {
      if (root === absoluteDir) clearPreviewCookie(res);
    }
    const indexPath = path.join(root, "index.html");
    if (!fs.existsSync(indexPath)) {
      if (root === absoluteDir) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(200).send(EMPTY_PLACEHOLDER_HTML);
      }
    }
    next();
  });

  app.use((req, res, next) => {
    const root = chooseRoot(req);
    express.static(root, { index: false })(req, res, next);
  });

  // SPA fallback: serve index.html for any path that didn't match a file (so refresh/direct URL works)
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (isStaticAssetRequest(req)) return res.status(404).end();
    const root = chooseRoot(req);
    const indexPath = path.join(root, "index.html");
    if (!fs.existsSync(indexPath)) return next();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (root === previewDir) {
      fs.readFile(indexPath, "utf-8", (err, html) => {
        if (err) return res.status(200).sendFile(indexPath);
        const injected = html.replace("</head>", PREVIEW_CLEANUP_SCRIPT);
        res.status(200).send(injected);
      });
    } else {
      res.status(200).sendFile(indexPath);
    }
  });

  return http.createServer(app);
}

/**
 * Start a static file server for one project on the given port.
 * Idempotent: if port already in use, skips.
 * @param {number} port
 * @param {string} projectPathOrDir - live root (projects/ folder)
 * @param {number} [projectId] - if set, ?preview=1 serves from _preview/project_<id>/serve (same port)
 */
export function startProjectServer(port, projectPathOrDir, projectId = null) {
  if (!port || port < 1) return;
  if (activeServers.has(port)) return;

  const backendRoot = getBackendRoot();
  const absoluteDir = path.isAbsolute(projectPathOrDir)
    ? projectPathOrDir
    : path.join(backendRoot, projectPathOrDir);

  fs.ensureDirSync(absoluteDir);
  const hasIndex = fs.existsSync(path.join(absoluteDir, "index.html"));
  if (!hasIndex) {
    console.warn(`[project-server] Port ${port}: no index.html in ${absoluteDir} (deploy a release to see content)`);
  }

  const server = createStaticServer(absoluteDir, projectId);
  server.listen(port, HOST, () => {
    activeServers.set(port, server);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[project-server] Port ${port} already in use, skipping`);
    } else {
      console.error(`[project-server] Port ${port} error:`, err.message);
    }
  });
}

/**
 * Start static servers for all projects that have a port and projectPath.
 * Call once on backend startup. Retries once after delay if DB isn't ready.
 */
export async function startAllProjectServers() {
  const tryStart = async () => {
    const projects = await prisma.project.findMany({
      where: { port: { not: null } },
      select: { id: true, port: true, projectPath: true, name: true },
    });
    const backendRoot = getBackendRoot();
    if (projects.length === 0) {
      return;
    }
    for (const p of projects) {
      if (p.port && p.projectPath) {
        const absoluteDir = path.join(backendRoot, p.projectPath);
        startProjectServer(p.port, absoluteDir, p.id);
      }
    }
  };

  try {
    await tryStart();
  } catch (err) {
    console.warn("[project-server] First attempt failed (DB may not be ready), retrying in 3s...", err.message);
    await new Promise((r) => setTimeout(r, 3000));
    try {
      await tryStart();
    } catch (e) {
      console.error("[project-server] Failed to start project servers:", e.message);
    }
  }
}
