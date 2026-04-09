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
 * Rewrite root-absolute paths inside srcset / imagesrcset (comma-separated URLs + descriptors).
 */
function rewriteSrcsetLikeAttributes(html, prefix) {
  return html.replace(
    /\s(srcset|imagesrcset|data-srcset)\s*=\s*(["'])([^"']*)\2/gi,
    (_, attr, quote, val) => {
      const next = val.replace(
        /(^|[\s,])\s*\/(?!\/)(?!iframe-preview\/)([^\s,]+)/g,
        (_, lead, pathPart) => `${lead}${prefix}/${pathPart}`,
      );
      return ` ${attr}=${quote}${next}${quote}`;
    },
  );
}

/**
 * Transform index HTML: rewrite asset URLs to go through proxy, and inject a
 * script that sets the iframe's path to "/" so the embedded app's router matches.
 *
 * After replaceState the document URL is "/" on the parent origin; root-absolute
 * paths like /BSP.svg would hit the parent (e.g. :5173), not the preview port.
 * <base href> fixes relative URLs; attribute rewrites + img.src patch cover common cases.
 * (We avoid rewriting proxied JS/CSS bodies — easy to corrupt bundles and break the app.)
 */
function transformIframeIndexHtml(html, port) {
  const prefix = `/iframe-preview/${port}`;
  let rewritten = rewriteSrcsetLikeAttributes(html, prefix);
  // Root-absolute paths on URL-like attributes (space before name; avoid ^ multiline matching inside scripts)
  rewritten = rewritten.replace(
    /(\s)(src|href|poster|data-src|xlink:href)\s*=\s*(["'])\/(?!\/)(?!iframe-preview\/)/gi,
    (_, space, attr, quote) => `${space}${attr}=${quote}${prefix}/`,
  );
  const baseTag = `<base href="${prefix}/">`;
  const replaceStateScript = `<script>(function(){var p=window.location.pathname;if(/^\\/iframe-preview\\/\\d+\\/?$/.test(p)){try{window.history.replaceState(null,"",window.location.origin+"/"+window.location.search+window.location.hash);}catch(e){}}})();</script>`;
  // Patch img.src only (not fetch) so bundlers / module loaders are not affected.
  const imgSrcPatchScript = `<script>(function(){var P=${JSON.stringify(prefix)};function a(u){if(typeof u!=="string"||u.charAt(0)!=="/"||u.charAt(1)==="/"||u.indexOf(P)===0||u.indexOf("/api")===0)return u;return P+u;}try{var d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"src");if(d&&d.set)Object.defineProperty(HTMLImageElement.prototype,"src",{get:d.get,set:function(v){d.set.call(this,a(v));}});}catch(e){}})();</script>`;
  const headInjection = `${baseTag}\n${replaceStateScript}\n${imgSrcPatchScript}`;
  if (/<head(\s[^>]*)?>/i.test(rewritten)) {
    return rewritten.replace(
      /<head(\s[^>]*)?>/i,
      (m) => `${m}\n${headInjection}\n`,
    );
  }
  if (rewritten.includes("</head>")) {
    return rewritten.replace("</head>", `${headInjection}\n</head>`);
  }
  return headInjection + rewritten;
}

/**
 * Serve the initial iframe document with transformed HTML so the embedded app sees path "/".
 */
async function serveIframeRoot(port, req, res, next) {
  const target = `http://127.0.0.1:${port}`;
  try {
    const upstream = new URL(`http://127.0.0.1:${port}/`);
    if (req.url?.includes("?")) {
      upstream.search = `?${req.url.split("?").slice(1).join("?")}`;
    }
    const resp = await fetch(upstream, {
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
    res.setHeader("Cache-Control", "private, no-store, must-revalidate");
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
    onError(err, req, res) {
      console.warn(`[iframe-proxy] ${port} error:`, err.message);
      if (res && !res.headersSent) res.statusCode = 502;
      if (res && typeof res.end === "function") res.end();
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

  const referer = req.headers.referer || req.headers.referrer || "";
  const refMatch = referer.match(/\/iframe-preview\/(\d+)(\/|$|\?)/);
  if (refMatch) {
    const port = refMatch[1];
    if (url.startsWith("/api/") || url.startsWith("/iframe-preview/")) {
      return next();
    }
    return getProxyForPort(port)(req, res, next);
  }

  next();
}
