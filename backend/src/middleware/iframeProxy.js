/**
 * Iframe preview proxy: /iframe-preview/<port>/* → http://127.0.0.1:<port>/*
 * Project static servers run in the same container on localhost. This makes the
 * iframe same-origin when the app is behind a reverse proxy that routes
 * /iframe-preview to the backend (e.g. launchpad.yorkdevs.link/iframe-preview/8001/).
 * Same-origin allows html2canvas to capture the iframe content.
 *
 * For the initial document (root of /iframe-preview/<port>/), we transform the
 * HTML so the embedded app's router sees path "/" (fixes "No routes matched").
 */
import { createProxyMiddleware } from "http-proxy-middleware";

const proxyCache = new Map();

/**
 * Transform index HTML: rewrite asset URLs to go through proxy, and inject a
 * script that sets the iframe's path to "/" so the embedded app's router matches.
 */
function transformIframeIndexHtml(html, port) {
  const prefix = `/iframe-preview/${port}`;
  // Rewrite same-origin relative URLs (e.g. /assets/...) so assets still hit our proxy; skip already-rewritten
  const rewritten = html.replace(
    /(\s)(src|href)=(["'])\/(?!\/)(?!iframe-preview\/)/g,
    (_, space, attr, quote) => `${space}${attr}=${quote}${prefix}/`
  );
  const injectScript = `<script>(function(){var p=window.location.pathname;if(/^\\/iframe-preview\\/\\d+\\/?$/.test(p)){try{window.history.replaceState(null,"",window.location.origin+"/"+window.location.search+window.location.hash);}catch(e){}}})();</script>`;
  if (rewritten.includes("</head>")) {
    return rewritten.replace("</head>", injectScript + "\n</head>");
  }
  if (rewritten.includes("<head>")) {
    return rewritten.replace("<head>", "<head>" + injectScript);
  }
  return injectScript + rewritten;
}

/**
 * Serve the initial iframe document with transformed HTML so the embedded app sees path "/".
 */
async function serveIframeRoot(port, req, res, next) {
  const target = `http://127.0.0.1:${port}`;
  try {
    const path = (req.url && req.url.split("?")[0]) || "/";
    const query = (req.url && req.url.includes("?") ? "?" + req.url.split("?").slice(1).join("?") : "") || "";
    const resp = await fetch(target + path + query, {
      headers: {
        accept: req.headers.accept || "text/html,*/*",
        "accept-language": req.headers["accept-language"] || "",
      },
    });
    if (!resp.ok || !resp.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      return getProxyForPort(port)(req, res, next);
    }
    const html = await resp.text();
    const transformed = transformIframeIndexHtml(html, port);
    // Preserve preview cookie set by the project static server (?preview=1 document load),
    // otherwise subsequent asset requests won't route to _preview/serve.
    if (typeof resp.headers.getSetCookie === "function") {
      const upstreamCookies = resp.headers.getSetCookie();
      if (Array.isArray(upstreamCookies) && upstreamCookies.length > 0) {
        res.setHeader("Set-Cookie", upstreamCookies);
      }
    } else {
      const upstreamCookie = resp.headers.get("set-cookie");
      if (upstreamCookie) {
        res.setHeader("Set-Cookie", upstreamCookie);
      }
    }
    res.setHeader("Content-Type", resp.headers.get("content-type") || "text/html; charset=utf-8");
    res.send(transformed);
  } catch (err) {
    console.warn(`[iframe-proxy] ${port} root fetch error:`, err.message);
    next(err);
  }
}

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

  // 1) Direct: /iframe-preview/<port>/ or /iframe-preview/<port> (root) → transformed HTML
  const directMatch = url.match(/^\/iframe-preview\/(\d+)(\/.*)?$/);
  if (directMatch) {
    const port = directMatch[1];
    const subPath = directMatch[2];
    const isRoot = !subPath || subPath === "/";
    if (isRoot && req.method === "GET") {
      return serveIframeRoot(port, req, res, next);
    }
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
