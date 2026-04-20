import express from "express";
import { prisma } from "../lib/prisma.js";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { createJiraTicketsFromSummary, testJiraConnection, getJiraProjectInfo } from "../utils/jiraIntegration.js";
import path from "path";
import fs from "fs-extra";
import { execSync } from "child_process";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { getProjectLiveAbsolutePath } from "../utils/instanceRoot.js";
import { projectController } from "../controllers/project.controller.js";
import {
  createProjectValidation,
  updateProjectValidation,
  startScratchAgentValidation,
} from "../validators/project.validator.js";
import { validate } from "../validators/validate.middleware.js";
import { clearProjectLock as releaseClearProjectLock } from "../services/release.service.js";
import { projectRepositoryWebUrl } from "../utils/projectGithubUrl.js";
import { parseStoredEmailListToSet } from "../utils/emailList.utils.js";
import ApiError from "../utils/apiError.js";
dotenv.config();

const router = express.Router();

// Project locks to prevent concurrent uploads
const projectLocks = new Map();

// Helper functions


function sanitizeCommand(command) {
  const dangerousChars = /[;&|`$(){}[\]\\]/g;
  if (dangerousChars.test(command)) {
    throw new Error('Command contains potentially dangerous characters');
  }
  return command;
}

function runCommand(command, cwd, options = {}) {
  const sanitizedCommand = sanitizeCommand(command);

  const defaultOptions = {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      NODE_PATH: cwd + '/node_modules',
      PATH: process.env.PATH + ':' + cwd + '/node_modules/.bin'
    },
    timeout: 30000, // 30 second default timeout
    maxBuffer: 10 * 1024 * 1024 // 10MB max buffer to prevent memory issues
  };

  const finalOptions = { ...defaultOptions, ...options };

  try {
    return execSync(sanitizedCommand, finalOptions);
  } catch (error) {
    console.error(`Command failed: ${sanitizedCommand} - ${error.message}`);

    // Provide more specific error messages
    if (error.code === 'TIMEOUT') {
      throw new Error(`Command timed out after ${finalOptions.timeout}ms: ${sanitizedCommand}`);
    } else if (error.message.includes('maxBuffer')) {
      throw new Error(`Command output too large (>10MB): ${sanitizedCommand}`);
    }

    throw error;
  }
}

// Utility function to split diff into chunks based on file boundaries
function splitDiffIntoChunks(diff, maxChunkSize = 150000) { // 150KB per chunk (configurable)
  if (diff.length <= maxChunkSize) {
    return [diff];
  }

  const chunks = [];
  const lines = diff.split('\n');
  let currentChunk = '';
  let currentSize = 0;
  let currentFile = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineSize = line.length + 1; // +1 for newline

    // Detect file boundaries (lines starting with "diff --git" or "+++" or "---")
    const isFileBoundary = line.startsWith('diff --git') ||
      line.startsWith('+++') ||
      line.startsWith('---');

    // If this is a file boundary and we have content, consider splitting
    if (isFileBoundary && currentChunk.length > 0 && currentSize > maxChunkSize * 0.7) {
      chunks.push(currentChunk);
      currentChunk = '';
      currentSize = 0;
    }

    // If a single line exceeds maxChunkSize, we need to handle it specially
    if (lineSize > maxChunkSize) {
      // If we have content in current chunk, save it first
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
        currentSize = 0;
      }
      // Split the large line itself (this is rare but possible)
      const lineChunks = splitLargeLine(line, maxChunkSize);
      chunks.push(...lineChunks);
      continue;
    }

    // If adding this line would exceed the chunk size, start a new chunk
    if (currentSize + lineSize > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = '';
      currentSize = 0;
    }

    currentChunk += line + '\n';
    currentSize += lineSize;

    // Track current file for better chunking
    if (line.startsWith('diff --git')) {
      currentFile = line;
    }
  }

  // Add the last chunk if it has content
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

// Helper function to split very large lines
function splitLargeLine(line, maxSize) {
  if (line.length <= maxSize) {
    return [line];
  }

  const chunks = [];
  for (let i = 0; i < line.length; i += maxSize) {
    chunks.push(line.substring(i, i + maxSize));
  }
  return chunks;
}

// Semaphore class to limit concurrent requests
class Semaphore {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    return new Promise((resolve) => {
      if (this.current < this.maxConcurrent) {
        this.current++;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      this.current++;
      next();
    }
  }
}

// Function to call webhook with a single chunk (with retry logic)
async function callWebhookWithChunk(chunk, chunkIndex, totalChunks, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const webhookResponse = await fetch(
        "https://workflow.yorkdevs.link/webhook/generatesummary",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            diff: chunk,
            chunkIndex,
            totalChunks,
            isPartial: totalChunks > 1
          }),
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      if (!webhookResponse.ok) {
        const errorText = await webhookResponse.text();
        throw new Error(`Webhook call failed for chunk ${chunkIndex}: ${errorText}`);
      }

      return await webhookResponse.json();
    } catch (error) {
      lastError = error;
      console.error(`Webhook attempt ${attempt} failed for chunk ${chunkIndex + 1}:`, error.message);

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`All ${maxRetries} attempts failed for chunk ${chunkIndex + 1}. Last error: ${lastError.message}`);
}

// Function to process chunks in parallel with semaphore
async function processChunksInParallel(chunks, maxConcurrent = 5) {
  const semaphore = new Semaphore(maxConcurrent);
  const results = new Array(chunks.length); // Pre-allocate array for better performance

  const processChunk = async (chunk, index) => {
    await semaphore.acquire();
    const chunkStartTime = Date.now();

    try {
      const response = await callWebhookWithChunk(chunk, index, chunks.length);
      results[index] = { success: true, data: response };
    } catch (error) {
      const chunkTime = (Date.now() - chunkStartTime) / 1000;
      console.error(`❌ Chunk ${index + 1} failed after ${chunkTime.toFixed(2)}s:`, error.message);
      results[index] = {
        success: false,
        error: error.message,
        data: {
          summary: `Chunk ${index + 1} processing failed: ${error.message}`,
          error: true
        }
      };
    } finally {
      semaphore.release();
    }
  };

  // Start all chunk processing in parallel (limited by semaphore)
  const promises = chunks.map((chunk, index) => processChunk(chunk, index));
  await Promise.all(promises);

  return results;
}

// Function to aggregate multiple webhook responses into a single summary
function aggregateWebhookResponses(parallelResults) {
  if (parallelResults.length === 1) {
    // For single chunk, return the data directly or wrap it properly
    const singleResult = parallelResults[0];
    if (singleResult.success) {
      return singleResult.data;
    } else {
      return {
        summary: singleResult.data.summary || 'Processing failed',
        error: true
      };
    }
  }

  // Separate successful and failed responses
  const successfulResponses = parallelResults.filter(r => r.success);
  const failedResponses = parallelResults.filter(r => !r.success);

  // Combine summaries from successful chunks
  const successfulSummaries = successfulResponses.map(r => {
    // Extract the actual summary text from the response
    if (typeof r.data === 'string') {
      return r.data;
    } else if (r.data && typeof r.data.summary === 'string') {
      return r.data.summary;
    } else if (r.data && r.data.output && typeof r.data.output.Summary === 'string') {
      return r.data.output.Summary;
    } else if (r.data && typeof r.data === 'object') {
      // Try to find any text content in the object
      return JSON.stringify(r.data, null, 2);
    } else {
      return 'No summary available for this chunk';
    }
  });

  const failedSummaries = failedResponses.map(r => {
    if (typeof r.data === 'string') {
      return r.data;
    } else if (r.data && typeof r.data.summary === 'string') {
      return r.data.summary;
    } else {
      return r.error || 'Chunk processing failed';
    }
  });

  let combinedSummary = successfulSummaries.join('\n\n--- Chunk Summary ---\n\n');

  // Add failed chunks information if any
  if (failedSummaries.length > 0) {
    combinedSummary += '\n\n--- Failed Chunks ---\n\n' + failedSummaries.join('\n\n');
  }

  const result = {
    summary: combinedSummary,
    totalChunks: parallelResults.length,
    successfulChunks: successfulResponses.length,
    failedChunks: failedResponses.length,
    aggregated: true
  };

  return result;
}

// File locking mechanism
async function withProjectLock(projectName, operation) {
  if (projectLocks.has(projectName)) {
    throw new Error('Project is currently being processed. Please try again in a moment.');
  }

  projectLocks.set(projectName, true);
  try {
    return await operation();
  } finally {
    projectLocks.delete(projectName);
  }
}

/**
 * @swagger
 * tags:
 *   name: Projects
 *   description: Project management API
 */

/**
 * @swagger
 * /projects:
 *   get:
 *     summary: Get all projects
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get(
  "/",
  authenticateToken,
  projectController.list
);

/**
 * @swagger
 * /projects:
 *   post:
 *     summary: Create a new project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.post(
  "/",
  authenticateToken,
  createProjectValidation,
  validate,
  projectController.create
);

router.post(
  "/:projectId/scratch-agent",
  authenticateToken,
  startScratchAgentValidation,
  validate,
  projectController.startScratchAgent,
);

/**
 * @swagger
 * /projects/{id}/live-url:
 *   get:
 *     summary: Get project live URL
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Success
 */
router.get(
  "/:id/live-url",
  authenticateToken,
  projectController.getLiveUrl
);

/**
 * @swagger
 * /projects/{id}/versions:
 *   get:
 *     summary: Get all project versions
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Success
 */
router.get(
  "/:id/versions",
  authenticateToken,
  projectController.listVersions
);


/**
 * @swagger
 * /projects/{id}/versions/{versionId}/activate:
 *   post:
 *     summary: Activate a specific project version
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: versionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Success
 */
router.post(
  "/:id/versions/:versionId/activate",
  authenticateToken,
  projectController.activateVersion
);


/**
 * @swagger
 * /projects/{id}/releases/{releaseId}/activate:
 *   post:
 *     summary: Set active status for a release
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: releaseId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Success
 */
router.post(
  "/:id/releases/:releaseId/activate",
  authenticateToken,
  projectController.setReleaseStatus
);

router.post(
  "/:id/releases/:releaseId/revert-to-baseline",
  authenticateToken,
  projectController.revertActiveReleaseToBaseline
);

router.post(
  "/:id/releases/:releaseId/migrate-frontend",
  authenticateToken,
  projectController.migrateFrontendRelease
);

/**
 * @swagger
 * /projects/public/{slug}:
 *   get:
 *     summary: Get public project (id, name, releases with versions only)
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         description: Project URL slug
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/public/:slug", projectController.getProjectPublicDetail);


router.get(
  "/:projectId/cursor-rules/catalog",
  authenticateToken,
  projectController.cursorRulesCatalog,
);

router.get(
  "/:projectId/cursor-rules/custom",
  authenticateToken,
  projectController.listCustomCursorRules,
);

router.post(
  "/:projectId/cursor-rules/custom",
  authenticateToken,
  projectController.createCustomCursorRule,
);

router.post(
  "/:projectId/cursor-rules/import",
  authenticateToken,
  projectController.importCursorRules,
);

/**
 * @swagger
 * /projects/{projectId}:
 *   get:
 *     summary: Get project by ID
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/:projectId', authenticateToken, projectController.getById);


/**
 * @swagger
 * /projects/{projectId}:
 *   delete:
 *     summary: Delete a project and its associated files
 *     description: Deletes a project from the database, and removes its project folder, git repository, and Nginx configuration. Only admins or the project's creator can delete a project.
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         description: The ID of the project to delete
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Project deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Project 'Example Project' and all associated files deleted."
 *       403:
 *         description: Forbidden - User does not have permission
 *       404:
 *         description: Project not found
 *       500:
 *         description: Cleanup failed
 */
router.delete('/:projectId', authenticateToken, (req, res, next) => {
  req.clearProjectLocksAfterDelete = (projectName) => {
    projectLocks.delete(projectName);
    releaseClearProjectLock(projectName);
  };
  projectController.deleteProject(req, res, next);
});


/**
 * @swagger
 * /projects/{projectId}/switch:
 *   post:
 *     summary: Switch UI to a specific version (Preview or Rollback)
 *     description: Swaps physical files in the project folder to match a Git Tag.
 *     tags:
 *       - Projects
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - versionId
 *             properties:
 *               versionId:
 *                 type: number
 *                 example: 12
 *               isPermanent:
 *                 type: boolean
 *                 description: Set to true to make this the primary 'Active' version.
 *                 example: false
 *     responses:
 *       200:
 *         description: Successfully switched files.
 *       404:
 *         description: Project or Version not found.
 */
router.post('/:projectId/switch', projectController.switchVersion);

// API endpoint to generate Jira tickets from git diff summary
router.post("/:id/generate-jira-tickets", authenticateToken, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const { id: userId, role } = req.user;

  try {
    // Check access
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: "Project not found" });

    let userEmail = typeof req.user?.email === "string" ? req.user.email.trim().toLowerCase() : "";
    if (!userEmail && userId) {
      const dbUser = await prisma.user.findUnique({
        where: { id: Number(userId) },
        select: { email: true },
      });
      userEmail = dbUser?.email ? String(dbUser.email).trim().toLowerCase() : "";
    }
    const assignedUsers = parseStoredEmailListToSet(project.assignedUserEmails);
    const hasAccess =
      role === "admin" ||
      Number(project.createdById) === Number(userId) ||
      (userEmail && assignedUsers.has(userEmail));
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

    const projectFolder = getProjectLiveAbsolutePath(project);

    if (!fs.existsSync(projectFolder)) {
      return res.status(404).json({ error: "Project folder not found" });
    }

    const gitDir = path.join(projectFolder, ".git");
    if (!fs.existsSync(gitDir)) {
      return res.status(400).json({ error: "Not a git repository" });
    }

    // Get git diff data
    const logOutput = runCommand(
      "git log -2 --pretty=format:%H",
      projectFolder
    );
    const commits = logOutput.trim().split("\n");

    if (commits.length < 2) {
      return res.status(400).json({ error: "Not enough commits to generate a diff" });
    }

    const [latestCommit, previousCommit] = commits;

    // Get git diff
    const gitDiff = runCommand(
      `git diff ${previousCommit} ${latestCommit}`,
      projectFolder
    );

    // Get commit info
    const authorOutput = runCommand(
      `git log -1 --pretty=format:"%an <%ae>" ${latestCommit}`,
      projectFolder
    );

    // Split diff into chunks if it's too large for the summary webhook
    const diffChunks = splitDiffIntoChunks(gitDiff);

    const maxConcurrent = 5;

    const parallelResults = await processChunksInParallel(diffChunks, maxConcurrent);

    const summary = aggregateWebhookResponses(parallelResults);

    // Create Jira tickets from summary
    const projectInfo = {
      id: projectId,
      name: project.name,
      version: "1.0.0", // You might want to get this from project versions
      commitHash: latestCommit,
      author: authorOutput.trim(),
      repository: projectRepositoryWebUrl(project),
    };

    const jiraResult = await createJiraTicketsFromSummary(summary, projectInfo);

    res.json({
      success: jiraResult.success,
      message: jiraResult.success
        ? `Successfully created ${jiraResult.successfulTickets} Jira tickets`
        : jiraResult.error || "Failed to create Jira tickets",
      projectId,
      projectName: project.name,
      totalTickets: jiraResult.totalTickets,
      successfulTickets: jiraResult.successfulTickets,
      failedTickets: jiraResult.failedTickets,
      tickets: jiraResult.summary,
      error: jiraResult.error
    });

  } catch (err) {
    console.error("Jira ticket generation error:", err);
    res.status(500).json({ error: err.message });
  }
});

// API endpoint to test Jira connection
router.get("/jira/test-connection", authenticateToken, async (req, res) => {
  const { role } = req.user;

  if (role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const connectionResult = await testJiraConnection();
    const projectResult = await getJiraProjectInfo();

    res.json({
      connection: connectionResult,
      project: projectResult,
      config: {
        baseUrl: process.env.JIRA_BASE_URL ? 'Set' : 'Not set',
        username: process.env.JIRA_USERNAME ? 'Set' : 'Not set',
        apiToken: process.env.JIRA_API_TOKEN ? 'Set' : 'Not set',
        projectKey: process.env.JIRA_PROJECT_KEY ? 'Set' : 'Not set'
      }
    });
  } catch (err) {
    console.error("Jira connection test error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /projects/{projectId}:
 *   put:
 *     summary: Update project details and integrations
 *     description: Update project description and validate/update GitHub or Jira connection details.
 *     tags:
 *       - Projects
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Send only fields to change. Omit keys you do not want to update.
 *             properties:
 *               description:
 *                 type: string
 *                 nullable: true
 *                 maxLength: 10000
 *               jiraUsername:
 *                 type: string
 *                 format: email
 

 *     responses:
 *       200:
 *         description: Project updated successfully
 *       400:
 *         description: Invalid input or integration connection failed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Project not found
 */

router.put(
  "/:projectId",
  authenticateToken,
  updateProjectValidation,
  projectController.update
);

/**
 * @swagger
 * /projects/{id}/jira/tickets:
 *   get:
 *     summary: Fetch Jira tickets for the project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Project ID
 *     responses:
 *       200:
 *         description: List of Jira tickets
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     description: Jira Issue ID
 *                   key:
 *                     type: string
 *                     description: Issue Key (e.g., PROJ-123)
 *                   url:
 *                     type: string
 *                     description: Link to the issue
 *                   summary:
 *                     type: string
 *                     description: Issue Title
 *                   status:
 *                     type: string
 *                     description: Current status (e.g., To Do, Done)
 *                   priority:
 *                     type: string
 *                     description: Priority level
 *                   type:
 *                     type: string
 *                     description: Issue Type (e.g., Task, Bug)
 *                   icon:
 *                     type: string
 *                     description: URL to issue type icon
 *                   created:
 *                     type: string
 *                     format: date-time
 *                   updated:
 *                     type: string
 *                     format: date-time
 *       400:
 *         description: Jira configuration missing for this project
 *       404:
 *         description: Project not found
 *       502:
 *         description: Failed to fetch tickets from Jira (Invalid credentials or network error)
 */
router.get("/:id/jira/tickets", authenticateToken, projectController.getJiraTickets);

export default router;