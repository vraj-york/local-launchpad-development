import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { PrismaClient } from "@prisma/client";
import {
  createJiraTicketWithConfig,
  addAttachmentToJiraIssue,
} from "../utils/jiraIntegration.js";

const prisma = new PrismaClient();

const router = express.Router();

// In-memory upload only — no screenshot storage on disk
const upload = multer({
  storage: multer.memoryStorage(),
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
 * Does not store screenshots on disk; optionally attaches to Jira when project has Jira config.
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
  let tempFilePath = null;
  try {
    if (!req.file) {
      console.warn("[feedback] POST /api/feedback rejected: no screenshot file");
      return res.status(400).json({
        success: false,
        message: "No screenshot file uploaded.",
      });
    }

    const description = req.body.description || "";
    const projectId = req.body.projectId || null;
    console.log("[feedback] Processing feedback | projectId:", projectId);
    let metadata = null;
    if (req.body.metadata) {
      try {
        metadata = JSON.parse(req.body.metadata);
      } catch {
        metadata = { raw: req.body.metadata };
      }
    }

    let jiraTicket = null;
    let jiraUrl = null;

    if (!projectId) {
      console.log("[feedback] No projectId provided — skipping Jira ticket creation");
    } else {
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
            console.log("[feedback] Project", projectId, "has no Jira config — skipping Jira ticket");
          } else {
            const summaryTitle =
              description.length > 250
                ? description.slice(0, 247) + "..."
                : description || "Feedback from widget";
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
              console.log("[feedback] Jira ticket created:", jiraTicket);
              // Write buffer to temp file only for Jira attachment, then remove
              const ext = path.extname(req.file.originalname) || ".png";
              tempFilePath = path.join(os.tmpdir(), `feedback-${Date.now()}${ext}`);
              fs.writeFileSync(tempFilePath, req.file.buffer);
              const attachResult = await addAttachmentToJiraIssue(
                ticketResult.ticketKey,
                tempFilePath,
                {
                  baseUrl: project.jiraBaseUrl,
                  apiToken: project.jiraApiToken,
                  email: project.jiraUsername,
                }
              );
              if (attachResult.success) {
                console.log("[feedback] Screenshot attached to Jira issue", jiraTicket);
              } else {
                console.warn("[feedback] Jira attachment failed:", attachResult.error);
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

    return res.status(200).json({
      success: true,
      message: "Feedback saved.",
      ...(jiraTicket && { jiraTicket }),
      ...(jiraUrl && { jiraUrl }),
    });
  } catch (err) {
    console.error("[feedback] Save error:", err.message, err.stack);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to save feedback.",
    });
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {
        console.warn("[feedback] Could not remove temp file:", tempFilePath, e.message);
      }
    }
  }
});

export default router;
