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
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use("/apps", express.static(getProjectsDir()));

app.use("/static", express.static(path.join(process.cwd(), "public")));
app.use("/api/feedback", feedbackRoutes);

app.use("/static", express.static(path.join(process.cwd(), "public")));
app.use("/api/feedback", feedbackRoutes);

app.use("/api/auth", authRoutes);
// app.use("/api/projects", projectRoutes);
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
