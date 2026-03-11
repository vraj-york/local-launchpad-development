import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { getProjectsDir } from "./utils/instanceRoot.js";
import authRoutes from "./routes/auth.routes.js";
import projectRoutes from "./routes/project.routes.js";
import releaseRoutes from "./routes/release.routes.js";
import errorMiddleware from "./middleware/error.middleware.js";
import roadmapRoutes from "./routes/roadmap.route.js";
import feedbackRoutes from "./routes/feedback.routes.js";
import figmaRoutes, { figmaPendingByWriteKey } from "./routes/figma.routes.js";
import cursorRoutes from "./routes/cursor.routes.js";

dotenv.config();

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
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        if (req.method === "OPTIONS") {
            res.sendStatus(204);
            return;
        }
    }
    next();
});
app.use(cors());
app.use(express.json({limit: '1024mb'}));

app.use("/apps", express.static(getProjectsDir()));
// Figma plugin: GET /login redirects to frontend /login?state=writeKey
app.get("/login", (req, res) => {
    const stateParam = typeof req.query.state === "string" ? req.query.state.trim() : "";
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
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
// app.use("/api/projects", projectRoutes);

app.use("/api/figma", figmaRoutes);
app.use("/api/cursor", cursorRoutes);
app.use("/api/releases", releaseRoutes);
app.use("/api/roadmaps", roadmapRoutes);
app.use("/api/projects", projectRoutes);

// MUST be last
app.use(errorMiddleware);

// Swagger Documentation
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger.js";

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

export default app;
