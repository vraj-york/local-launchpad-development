/**
 * Iframe preview proxy: /iframe-preview/<port>/* → http://127.0.0.1:<port>/*
 * Project static servers run in the same container on localhost. This makes the
 * iframe same-origin when the app is behind a reverse proxy that routes
 * /iframe-preview to the backend (e.g. launchpad.yorkdevs.link/iframe-preview/8001/).
 * Same-origin allows html2canvas to capture the iframe content.
 */
import { createProxyMiddleware } from "http-proxy-middleware";

const proxyCache = new Map();

function getProxyForPort(port) {
  if (proxyCache.has(port)) return proxyCache.get(port);
  const prefix = `/iframe-preview/${port}`;
  const proxy = createProxyMiddleware({
    target: `http://127.0.0.1:${port}`,
    changeOrigin: true,
    pathRewrite: { [`^${prefix}`]: "" },
    on: {
      error(err, req, res) {
        console.warn(`[iframe-proxy] ${port} error:`, err.message);
      },
    },
  });
  proxyCache.set(port, proxy);
  return proxy;
}

/**
 * Express middleware: handle /iframe-preview/<port>/... and Referer-based
 * sub-resource requests. Must be mounted before /apps, /api, etc.
 */
export function iframeProxyMiddleware(req, res, next) {
  const url = req.url?.split("?")[0] ?? "";

  // 1) Direct: /iframe-preview/<port>/ or /iframe-preview/<port>/path
  const directMatch = url.match(/^\/iframe-preview\/(\d+)(\/.*)?$/);
  if (directMatch) {
    const port = directMatch[1];
    return getProxyForPort(port)(req, res, next);
  }

  // 2) Sub-resource: Referer contains /iframe-preview/<port>/ so the request
  //    is for an asset loaded inside the iframe (e.g. /assets/main.js).
  const referer = req.headers.referer || req.headers.referrer || "";
  const refMatch = referer.match(/\/iframe-preview\/(\d+)(\/|$|\?)/);
  if (refMatch) {
    const port = refMatch[1];
    // Do not proxy API or other backend paths
    if (url.startsWith("/api/") || url.startsWith("/iframe-preview/")) {
      return next();
    }
    return getProxyForPort(port)(req, res, next);
  }

  next();
}
