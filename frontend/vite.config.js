import path from "path"
import { createProxyMiddleware } from "http-proxy-middleware"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/**
 * Vite plugin that proxies /iframe-preview/<port>/... to http://localhost:<port>/...
 * so cross-origin project iframes become same-origin for html2canvas capture.
 */
function iframeProxyPlugin() {
  const proxyCache = new Map();

  function getProxy(port) {
    if (proxyCache.has(port)) return proxyCache.get(port);
    const proxy = createProxyMiddleware({
      target: `http://localhost:${port}`,
      changeOrigin: true,
      pathRewrite: (reqPath) => reqPath.replace(`/iframe-preview/${port}`, "") || "/",
    });
    proxyCache.set(port, proxy);
    return proxy;
  }

  return {
    name: "iframe-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // 1) Direct match: /iframe-preview/<port>/...
        const directMatch = req.url?.match(/^\/iframe-preview\/(\d+)(\/.*)?$/);
        if (directMatch) {
          return getProxy(directMatch[1])(req, res, next);
        }

        // 2) Sub-resource loaded by the iframe (e.g. /assets/main.js).
        //    The browser sets the Referer to the iframe's URL which contains
        //    /iframe-preview/<port>/, so we proxy to the same port.
        //    Skip Vite-internal paths (/@..., /src/, /node_modules/).
        const referer = req.headers.referer || "";
        const refMatch = referer.match(/\/iframe-preview\/(\d+)(\/|$|\?)/);
        if (
          refMatch &&
          !req.url.startsWith("/@") &&
          !req.url.startsWith("/src/") &&
          !req.url.startsWith("/node_modules/")
        ) {
          return getProxy(refMatch[1])(req, res, next);
        }

        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [iframeProxyPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})