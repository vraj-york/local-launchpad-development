import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { prisma } from "../lib/prisma.js";
import {
  createJiraTicketWithConfig,
  addAttachmentToJiraIssue,
} from "../utils/jiraIntegration.js";
import {
  resolveJiraCredentialsFromProject,
  jiraIntegrationConfigFromResolved,
} from "../services/integrationCredential.service.js";
import { assertPublicClientStakeholderEmail } from "../utils/publicClientStakeholder.utils.js";
import ApiError from "../utils/apiError.js";

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
 *   - clientEmail: string (required when projectId is set — must be a configured stakeholder)
 * Does not store screenshots on disk; optionally attaches to Jira when project has Jira config.
 */
router.post(
  "/",
  upload.single("screenshot"),
  (err, req, res, next) => {
    if (err) {
      console.error("[feedback] Upload middleware error:", err.message);
      return res
        .status(400)
        .json({ success: false, message: err.message || "Upload failed." });
    }
    next();
  },
  async (req, res) => {
    let tempFilePath = null;
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No screenshot file uploaded.",
        });
      }

      const description = req.body.description || "";
      const projectId = req.body.projectId || null;
      const clientEmail =
        typeof req.body.clientEmail === "string"
          ? req.body.clientEmail
          : typeof req.body.email === "string"
            ? req.body.email
            : "";
      // Issue type from widget: "Bug" (default) or "Improvements" -> Jira "Story"
      const rawIssueType = (req.body.issueType || "Bug").trim();
      const jiraIssueType =
        rawIssueType === "Improvements" ? "Story" : rawIssueType;
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
      let jiraError = null;

      if (!projectId) {
        /* no Jira without project */
      } else {
        try {
          const project = await prisma.project.findUnique({
            where: { id: Number(projectId) },
            select: {
              stakeholderEmails: true,
              jiraBaseUrl: true,
              jiraProjectKey: true,
              jiraApiToken: true,
              jiraUsername: true,
              jiraConnectionId: true,
              createdById: true,
            },
          });
          if (!project) {
            /* skip Jira */
          } else {
            assertPublicClientStakeholderEmail(
              project.stakeholderEmails,
              clientEmail,
              { context: "issueReporter" },
            );
            const hasJiraConfig =
              project?.jiraBaseUrl &&
              project?.jiraProjectKey &&
              (project.jiraConnectionId ||
                (project.jiraApiToken && project.jiraUsername));
            if (!hasJiraConfig) {
              /* skip Jira */
            } else {
              let jiraCfg;
              try {
                const jc = await resolveJiraCredentialsFromProject(project);
                jiraCfg = jiraIntegrationConfigFromResolved(jc, {
                  jiraProjectKey: project.jiraProjectKey,
                  jiraIssueType: jiraIssueType,
                });
              } catch (resolveErr) {
                jiraError = resolveErr.message || "Jira credentials unavailable";
              }
              if (!jiraCfg) {
                // skipped
              } else {
              const oneLine = (description || "Feedback from widget")
                .replace(/[\r\n\u2028\u2029]+/g, " ")
                .replace(/\s+/g, " ")
                .trim();
              const rawTitle =
                oneLine.length > 250 ? oneLine.slice(0, 247) + "..." : oneLine;
              const summaryTitle = rawTitle.startsWith("[LaunchPad]")
                ? rawTitle
                : `[LaunchPad] ${rawTitle}`;
              const reporterEmailForJira =
                typeof clientEmail === "string"
                  ? clientEmail.trim().toLowerCase()
                  : "";
              const ticketResult = await createJiraTicketWithConfig(
                {
                  title: summaryTitle,
                  description,
                  metadata,
                  reporterEmail: reporterEmailForJira,
                },
                jiraCfg,
              );
              if (ticketResult.success && ticketResult.ticketKey) {
                jiraTicket = ticketResult.ticketKey;
                jiraUrl = ticketResult.ticketUrl;
                // Write buffer to temp file only for Jira attachment, then remove
                const ext = path.extname(req.file.originalname) || ".png";
                tempFilePath = path.join(
                  os.tmpdir(),
                  `feedback-${Date.now()}${ext}`,
                );
                fs.writeFileSync(tempFilePath, req.file.buffer);
                const attachResult = await addAttachmentToJiraIssue(
                  ticketResult.ticketKey,
                  tempFilePath,
                  jiraCfg,
                );
                if (!attachResult.success) {
                  jiraError = attachResult.error || jiraError;
                }
              } else {
                jiraError =
                  ticketResult.error || "Jira ticket creation failed.";
              }
              }
            }
          }
        } catch (jiraErr) {
          if (jiraErr instanceof ApiError) {
            throw jiraErr;
          }
          console.error(
            "[feedback] Jira flow error:",
            jiraErr.message,
            jiraErr.stack,
          );
          jiraError = jiraErr.message || "Jira request failed.";
        }
      }

      return res.status(200).json({
        success: true,
        message: "Feedback saved.",
        ...(jiraTicket && { jiraTicket }),
        ...(jiraUrl && { jiraUrl }),
        ...(jiraError && { jiraError }),
      });
    } catch (err) {
      if (err instanceof ApiError) {
        return res.status(err.statusCode).json({
          success: false,
          message: err.message,
        });
      }
      console.error("[feedback] Save error:", err.message, err.stack);
      return res.status(500).json({
        success: false,
        message: err.message || "Failed to save feedback.",
      });
    } finally {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          /* ignore */
        }
      }
    }
  },
);

export default router;
