import { createProxyMiddleware } from "http-proxy-middleware";

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

function transformIframeIndexHtml(html, port) {
  const prefix = `/iframe-preview/${port}`;
  let rewritten = rewriteSrcsetLikeAttributes(html, prefix);
  rewritten = rewritten.replace(
    /(\s)(src|href|poster|data-src|xlink:href)\s*=\s*(["'])\/(?!\/)(?!iframe-preview\/)/gi,
    (_, space, attr, quote) => `${space}${attr}=${quote}${prefix}/`,
  );
  const baseTag = `<base href="${prefix}/">`;
  const replaceStateScript = `<script>(function(){var p=window.location.pathname;if(/^\\/iframe-preview\\/\\d+\\/?$/.test(p)){try{window.history.replaceState(null,"",window.location.origin+"/"+window.location.search+window.location.hash);}catch(e){}}})();</script>`;
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
 * Same-origin iframe proxy as Vite dev (vite.config.js): /iframe-preview/<port>/... → upstream:<port>/...
 * @param {(port: string) => string} resolveTarget - e.g. (p) => `http://localhost:${p}` or `http://backend:${p}`
 */
export function createIframePreviewMiddleware(resolveTarget) {
  const proxyCache = new Map();

  function getProxy(port) {
    if (proxyCache.has(port)) return proxyCache.get(port);
    const target = resolveTarget(port);
    const prefix = `/iframe-preview/${port}`;
    const proxy = createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: (reqPath) =>
        reqPath.replace(`/iframe-preview/${port}`, "") || "/",
      onError(err, req, res) {
        console.warn(`[iframe-preview] ${port} error:`, err.message);
        if (res && !res.headersSent) res.statusCode = 502;
        if (res && typeof res.end === "function") res.end();
      },
    });
    proxyCache.set(port, proxy);
    return proxy;
  }

  async function serveIframeRoot(port, req, res, next) {
    const targetBase = resolveTarget(port);
    try {
      const upstream = new URL("/", targetBase);
      const rawUrl = req.url || "";
      if (rawUrl.includes("?")) {
        upstream.search = `?${rawUrl.split("?").slice(1).join("?")}`;
      }
      const resp = await fetch(upstream, {
        headers: {
          accept: req.headers.accept || "text/html,*/*",
          "accept-language": req.headers["accept-language"] || "",
        },
      });
      if (!resp.ok || !resp.headers.get("content-type")?.toLowerCase().includes("text/html")) {
        return getProxy(port)(req, res, next);
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
      res.setHeader(
        "Content-Type",
        resp.headers.get("content-type") || "text/html; charset=utf-8",
      );
      res.setHeader("Cache-Control", "private, no-store, must-revalidate");
      res.statusCode = 200;
      res.end(transformed);
    } catch (err) {
      console.warn(`[iframe-preview] ${port} root fetch error:`, err.message);
      next(err);
    }
  }

  return (req, res, next) => {
    const rawUrl = req.url || "";
    const pathname = rawUrl.split("?")[0].split("#")[0];

    const directMatch = pathname.match(/^\/iframe-preview\/(\d+)(\/.*)?$/);
    if (directMatch) {
      const port = directMatch[1];
      const subPath = directMatch[2];
      const isRoot = !subPath || subPath === "/";
      if (isRoot && req.method === "GET") {
        return void serveIframeRoot(port, req, res, next).catch(next);
      }
      return getProxy(port)(req, res, next);
    }

    const referer = req.headers.referer || "";
    const refPath = referer.includes("://")
      ? (() => {
          try {
            return new URL(referer).pathname;
          } catch {
            return referer;
          }
        })()
      : referer;
    const refMatch = refPath.match(/\/iframe-preview\/(\d+)(\/|$)/);
    if (
      refMatch &&
      !req.url.startsWith("/@") &&
      !req.url.startsWith("/src/") &&
      !req.url.startsWith("/node_modules/")
    ) {
      return getProxy(refMatch[1])(req, res, next);
    }

    next();
  };
}
