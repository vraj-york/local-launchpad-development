import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { createIframePreviewMiddleware } from "./iframePreviewProxy.js"

/** Vite dev: same-origin /iframe-preview/<port>/ proxy as production (serve-static.mjs). */
function iframeProxyPlugin() {
  return {
    name: "iframe-proxy",
    configureServer(server) {
      server.middlewares.use(
        createIframePreviewMiddleware((port) => `http://127.0.0.1:${port}`),
      )
    },
  }
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