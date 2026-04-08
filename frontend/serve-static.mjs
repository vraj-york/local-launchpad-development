/**
 * Production static server with /iframe-preview/<port>/ proxy (Docker & local).
 * Set IFRAME_PREVIEW_HOST=http://backend in docker-compose so previews resolve inside the stack.
 */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createIframePreviewMiddleware } from "./iframePreviewProxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "dist");

const port = Number(process.env.PORT || 80);
const host = process.env.IFRAME_PREVIEW_HOST || "http://127.0.0.1";

const resolveTarget = (portStr) => `${host}:${portStr}`;

const app = express();
app.use(createIframePreviewMiddleware(resolveTarget));
app.use(express.static(dist, { index: false }));
app.get("*", (req, res) => {
  res.sendFile(path.join(dist, "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(
    `Static + iframe-preview proxy listening on ${port} (IFRAME_PREVIEW_HOST=${host})`,
  );
});
