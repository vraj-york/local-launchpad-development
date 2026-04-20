import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { getBackendRoot, getProjectsDir } from "./utils/instanceRoot.js";
import authRoutes from "./routes/auth.routes.js";
import projectRoutes from "./routes/project.routes.js";
import releaseRoutes from "./routes/release.routes.js";
import errorMiddleware from "./middleware/error.middleware.js";
import { iframeProxyMiddleware } from "./middleware/iframeProxy.js";
import feedbackRoutes from "./routes/feedback.routes.js";
import figmaRoutes from "./routes/figma.routes.js";
import { figmaPendingByWriteKey } from "./services/figmaPluginAuth.service.js";
import cursorRoutes from "./routes/cursor.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import integrationsRoutes from "./routes/oauth.routes.js";
import { getPublicFrontendBaseUrl } from "./utils/publicFrontendUrl.js";
import webhooksRoutes from "./routes/webhooks.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, "..");
const repoRoot = path.join(backendDir, "..");
// Monorepo: pick up VITE_* / NGROK_* from repo root .env when running `cd backend && npm start`.
dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(backendDir, ".env"), override: true });

const app = express();
// CORS for Figma plugin (iframe origin can be null or https://www.figma.com)
// Use a specific origin (never *) so the browser sends the Authorization header.
const FIGMA_ORIGIN = process.env.FIGMA_ORIGIN || "https://www.figma.com";
app.use((req, res, next) => {
    const isFigma = req.path.startsWith("/api/figma") || req.path.startsWith("/api/projects") || req.path === "/login";
    if (isFigma) {
        const origin = req.headers.origin;
        const allowOrigin = origin && origin.length > 0 ? origin : FIGMA_ORIGIN;
        res.setHeader("Access-Control-Allow-Origin", allowOrigin);
        res.setHeader(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        );
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        if (req.method === "OPTIONS") {
            res.sendStatus(204);
            return;
        }
    }
    next();
});
app.use(cors());
// Push webhooks need raw body bytes for HMAC verification (before express.json).
app.use("/api/webhooks", webhooksRoutes);
app.use(express.json({limit: '1024mb'}));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Iframe preview proxy: /iframe-preview/<port>/* → localhost:<port> (same-origin for html2canvas)
app.use(iframeProxyMiddleware);

app.use("/apps", express.static(getProjectsDir()));
// Figma plugin: GET /login redirects to frontend /login?state=writeKey
app.get("/login", (req, res) => {
    const stateParam = typeof req.query.state === "string" ? req.query.state.trim() : "";
    const frontendUrl = getPublicFrontendBaseUrl();
    if (stateParam && figmaPendingByWriteKey.has(stateParam)) {
        const loginUrl = `${frontendUrl}/login?state=${encodeURIComponent(stateParam)}`;
        res.redirect(302, loginUrl);
        return;
    }
    res.status(400).json({ error: "Invalid or missing state" });
});

app.use("/static", express.static(path.join(process.cwd(), "public")));
app.use("/api/feedback", feedbackRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/integrations", integrationsRoutes);

app.use("/api/figma", figmaRoutes);
app.use("/api/cursor", cursorRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/releases", releaseRoutes);
app.use("/api/projects", projectRoutes);

// MUST be last
app.use(errorMiddleware);

// Swagger Documentation
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger.js";

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

export default app;
