import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import {
  createJiraTicketWithConfig,
  addAttachmentToJiraIssue,
} from "../utils/jiraIntegration.js";

const prisma = new PrismaClient();

const router = express.Router();

// All feedback screenshots stored in one folder (local)
const SCREENSHOTS_DIR = path.join(process.cwd(), "screenshots");
const SCREENSHOTS_DIR_BACKEND = path.join(process.cwd(), "backend", "screenshots");

function getScreenshotsDir() {
  if (fs.existsSync(SCREENSHOTS_DIR)) return SCREENSHOTS_DIR;
  if (fs.existsSync(SCREENSHOTS_DIR_BACKEND)) return SCREENSHOTS_DIR_BACKEND;
  return SCREENSHOTS_DIR;
}

const screenshotsDir = getScreenshotsDir();
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, screenshotsDir);
  },
  filename: (req, file, cb) => {
    const base = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    cb(null, `${base}.png`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      console.warn("[feedback] Upload rejected: invalid file type", file.mimetype);
      cb(new Error("Invalid file type. Only PNG, JPEG, WebP allowed."));
    }
  },
});

/**
 * POST /api/feedback
 * Accepts: multipart/form-data
 *   - screenshot: image file (required)
 *   - description: string (required)
 *   - metadata: JSON string (optional)
 *   - projectId: string (optional)
 * Saves screenshot to local folder and a .json file with description + metadata.
 */
router.post("/", (req, res, next) => {
  console.log("[feedback] POST /api/feedback received | projectId:", req.body?.projectId ?? "(none)");
  next();
}, upload.single("screenshot"), (err, req, res, next) => {
  if (err) {
    console.error("[feedback] Upload middleware error:", err.message);
    return res.status(400).json({ success: false, message: err.message || "Upload failed." });
  }
  next();
}, async (req, res) => {
  try {
    console.log("[feedback] Handler entered | hasFile:", !!req.file, "| projectId:", req.body?.projectId ?? "(none)", "| description length:", (req.body?.description || "").length);
    if (!req.file) {
      console.warn("[feedback] POST /api/feedback rejected: no screenshot file");
      return res.status(400).json({
        success: false,
        message: "No screenshot file uploaded.",
      });
    }

    const description = req.body.description || "";
    const projectId = req.body.projectId || null;
    console.log("[feedback] Saving feedback | projectId:", projectId, "| file:", req.file.filename);
    let metadata = null;
    if (req.body.metadata) {
      try {
        metadata = JSON.parse(req.body.metadata);
      } catch {
        metadata = { raw: req.body.metadata };
      }
    }

    const baseName = path.basename(req.file.filename, path.extname(req.file.filename));
    const jsonPath = path.join(screenshotsDir, `${baseName}.json`);
    const payload = {
      description,
      projectId,
      metadata,
      screenshotFile: req.file.filename,
      submittedAt: new Date().toISOString(),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf-8");
    console.log("[feedback] Saved | screenshot:", req.file.filename, "| json:", path.basename(jsonPath));

    let jiraTicket = null;
    let jiraUrl = null;

    if (!projectId) {
      console.log("[feedback] No projectId provided — skipping Jira ticket creation");
    } else {
      console.log("[feedback] projectId:", projectId, "— fetching project for Jira config");
      try {
        const project = await prisma.project.findUnique({
          where: { id: Number(projectId) },
          select: {
            jiraBaseUrl: true,
            jiraProjectKey: true,
            jiraApiToken: true,
            jiraUsername: true,
            jiraIssueType: true,
          },
        });
        if (!project) {
          console.warn("[feedback] Project not found for id:", projectId, "— skipping Jira");
        } else {
          const hasJiraConfig =
            project?.jiraBaseUrl &&
            project?.jiraProjectKey &&
            project?.jiraApiToken &&
            project?.jiraUsername;
          if (!hasJiraConfig) {
            console.log("[feedback] Project", projectId, "has no Jira config (baseUrl/projectKey/apiToken/username) — skipping Jira ticket");
          } else {
            console.log("[feedback] Jira config present for project", projectId, "| baseUrl:", project.jiraBaseUrl, "| projectKey:", project.jiraProjectKey);
            const summaryTitle =
              description.length > 250
                ? description.slice(0, 247) + "..."
                : description || "Feedback from widget";
            console.log("[feedback] Creating Jira ticket | summary length:", summaryTitle.length, "| hasMetadata:", !!metadata);
            const ticketResult = await createJiraTicketWithConfig(
              {
                title: summaryTitle,
                description,
                metadata,
              },
              {
                baseUrl: project.jiraBaseUrl,
                projectKey: project.jiraProjectKey,
                apiToken: project.jiraApiToken,
                email: project.jiraUsername,
                issueType: project.jiraIssueType || "Task",
              }
            );
            if (ticketResult.success && ticketResult.ticketKey) {
              jiraTicket = ticketResult.ticketKey;
              jiraUrl = ticketResult.ticketUrl;
              console.log("[feedback] Jira ticket created:", jiraTicket, "| url:", jiraUrl);
              const screenshotPath = path.join(screenshotsDir, req.file.filename);
              console.log("[feedback] Attaching screenshot to Jira issue | file:", req.file.filename, "| path:", screenshotPath);
              const attachResult = await addAttachmentToJiraIssue(
                ticketResult.ticketKey,
                screenshotPath,
                {
                  baseUrl: project.jiraBaseUrl,
                  apiToken: project.jiraApiToken,
                  email: project.jiraUsername,
                }
              );
              if (attachResult.success) {
                console.log("[feedback] Screenshot attached to Jira issue", jiraTicket);
              } else {
                console.warn("[feedback] Jira ticket created but attachment failed:", attachResult.error);
              }
            } else {
              console.warn("[feedback] Jira ticket creation failed:", ticketResult.error);
            }
          }
        }
      } catch (jiraErr) {
        console.error("[feedback] Jira flow error:", jiraErr.message, jiraErr.stack);
      }
    }

    console.log("[feedback] Response | success: true | screenshotFile:", req.file.filename, "| jiraTicket:", jiraTicket ?? "none");
    return res.status(200).json({
      success: true,
      message: "Feedback saved.",
      screenshotFile: req.file.filename,
      ...(jiraTicket && { jiraTicket }),
      ...(jiraUrl && { jiraUrl }),
    });
  } catch (err) {
    console.error("[feedback] Save error:", err.message, err.stack);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to save feedback.",
    });
  }
});

/**
 * GET /api/feedback/screenshot/:filename
 * Serve a screenshot image (for use in admin or list view).
 */
router.get("/screenshot/:filename", (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    if (!filename || filename.includes("..")) {
      console.warn("[feedback] GET screenshot rejected: invalid filename", req.params.filename);
      return res.status(400).json({ message: "Invalid filename" });
    }
    const dir = getScreenshotsDir();
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      console.warn("[feedback] GET screenshot not found:", filename);
      return res.status(404).json({ message: "Screenshot not found" });
    }
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    console.error("[feedback] Screenshot serve error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

export default router;
