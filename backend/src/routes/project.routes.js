import express from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { generateProjectHeader } from "../utils/headerUtils.js";
import { createJiraTicketsFromSummary, testJiraConnection, getJiraProjectInfo } from "../utils/jiraIntegration.js";
import multer from "multer";
import path from "path";
import fs from "fs-extra";
import extract from "extract-zip";
import { exec, execSync } from "child_process";
import crypto from "crypto";
import fetch from "node-fetch";
import dotenv from "dotenv";
import config from "../config/index.js";
import { validateProjectName } from "../utils/projectValidation.utils.js";
import allowRoles from "../middlewares/role.middleware.js";
import { projectController } from "../controllers/project.controller.js";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import { createProjectValidation } from "../validators/project.validator.js";
import { validate } from "../validators/validate.middleware.js";
dotenv.config();

const router = express.Router();
const prisma = new PrismaClient();

// Environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;

// Project locks to prevent concurrent uploads
const projectLocks = new Map();

// Rate limiting for GitHub API
const githubApiCalls = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_CALLS_PER_WINDOW = 10;

// Helper functions


function sanitizeCommand(command) {
  const dangerousChars = /[;&|`$(){}[\]\\]/g;
  if (dangerousChars.test(command)) {
    throw new Error('Command contains potentially dangerous characters');
  }
  return command;
}

/**
 * Parse git diff --name-status line into components
 * Handles proper tab-separated format: "STATUS\tpath" or "STATUS\told_path\tnew_path"
 */
function parseGitDiffLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const tabIndex = trimmed.indexOf('\t');
  if (tabIndex === -1) {
    // Malformed line without tab - try to parse anyway
    return parseMalformedGitLine(trimmed);
  }

  const statusPart = trimmed.substring(0, tabIndex);
  const pathPart = trimmed.substring(tabIndex + 1);

  // Extract status character and similarity score for renames/copies
  const statusMatch = statusPart.match(/^([ACDMRTUX])(\d*)$/);
  if (!statusMatch) {
    return parseMalformedGitLine(trimmed);
  }

  const [, statusChar, similarity] = statusMatch;

  // Handle rename/copy format: "old_path\tnew_path"
  if (statusChar === 'R' || statusChar === 'C') {
    const pathParts = pathPart.split('\t');
    if (pathParts.length >= 2) {
      return {
        status: statusChar,
        similarity: similarity ? parseInt(similarity, 10) : 100,
        oldPath: pathParts[0],
        newPath: pathParts[1],
        filename: pathParts[1] // Use new path as primary
      };
    }
  }

  return {
    status: statusChar,
    similarity: null,
    oldPath: null,
    newPath: pathPart,
    filename: pathPart
  };
}

/**
 * Parse malformed git diff lines (fallback for broken parsing)
 */
function parseMalformedGitLine(line) {
  const parts = line.trim().split(/\s+/);

  if (parts.length < 2) {
    return {
      status: 'M',
      similarity: null,
      oldPath: null,
      newPath: parts[0] || '',
      filename: parts[0] || ''
    };
  }

  // Try to extract status from first part
  const statusChar = parts[0].charAt(0);
  const validStatuses = ['A', 'C', 'D', 'M', 'R', 'T', 'U', 'X'];

  if (validStatuses.includes(statusChar)) {
    const pathParts = parts.slice(1);
    return generatePathCandidatesFromParts(statusChar, pathParts);
  }

  // No valid status found - treat as modified file with complex path
  return generatePathCandidatesFromParts('M', parts);
}

/**
 * Generate path candidates from broken/malformed path parts
 */
function generatePathCandidatesFromParts(status, parts) {
  const candidates = [];
  const pathRegex = /^[^\/]*\/.*\.[a-zA-Z0-9]+$/;

  // Strategy 1: Find individual complete file paths
  for (let i = 0; i < parts.length; i++) {
    if (pathRegex.test(parts[i])) {
      candidates.push(parts[i]);
    }
  }

  // Strategy 2: Reconstruct multi-word directory paths
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const candidate = parts.slice(i, j + 1).join(' ');
      if (pathRegex.test(candidate)) {
        candidates.push(candidate);
      }
    }
  }

  // Strategy 3: Just use the last part as fallback
  if (candidates.length === 0 && parts.length > 0) {
    candidates.push(parts[parts.length - 1]);
  }

  const primaryPath = candidates[0] || parts[parts.length - 1] || '';

  return {
    status,
    similarity: null,
    oldPath: null,
    newPath: primaryPath,
    filename: primaryPath,
    candidates: [...new Set(candidates)]
  };
}

/**
 * Get canonical file paths from git ls-tree (cached and size-limited)
 */
const canonicalPathsCache = new Map();
const MAX_CANONICAL_PATHS = 5000; // Limit to prevent memory issues

function getCanonicalPaths(commit, cwd) {
  const cacheKey = `${commit}:${cwd}`;

  // Check cache first
  if (canonicalPathsCache.has(cacheKey)) {
    return canonicalPathsCache.get(cacheKey);
  }

  try {
    const output = execSync(`git ls-tree -r --name-only ${commit}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 10000 // 10 second timeout
    });

    const paths = output
      .trim()
      .split('\n')
      .filter(line => line)
      .slice(0, MAX_CANONICAL_PATHS) // Limit number of paths
      .map(line => {
        // Handle git's quoted output format
        if (line.startsWith('"') && line.endsWith('"')) {
          try {
            return JSON.parse(line);
          } catch {
            return line.slice(1, -1); // Fallback: just remove quotes
          }
        }
        return line;
      });

    // Cache result (with TTL via size limit)
    if (canonicalPathsCache.size > 10) {
      canonicalPathsCache.clear(); // Simple cache eviction
    }
    canonicalPathsCache.set(cacheKey, paths);

    return paths;
  } catch (error) {
    console.warn(`Could not get canonical paths for commit ${commit}:`, error.message);
    return [];
  }
}

/**
 * Generate candidate file paths with performance-optimized fallback strategies
 */
function getPathCandidates(rawPath, commit = null, cwd = null) {
  const parsed = parseGitDiffLine(rawPath);
  if (!parsed) return [];

  const candidates = [];

  // Add primary paths
  if (parsed.newPath) candidates.push(parsed.newPath);
  if (parsed.oldPath) candidates.push(parsed.oldPath);

  // Add any additional candidates from malformed parsing
  if (parsed.candidates) {
    candidates.push(...parsed.candidates);
  }

  // PERFORMANCE FIX: Only do fuzzy matching for malformed inputs
  // and limit the search to prevent infinite loops
  if (commit && cwd && candidates.length === 0) {

    try {
      const canonicalPaths = getCanonicalPaths(commit, cwd);

      // Limit fuzzy matching to prevent performance issues
      const maxFuzzyAttempts = 100;
      let fuzzyAttempts = 0;

      for (const candidate of candidates.slice(0, 3)) { // Only check first 3 candidates
        if (fuzzyAttempts >= maxFuzzyAttempts) break;

        const fuzzyMatches = canonicalPaths
          .slice(0, 1000) // Limit canonical paths to search
          .filter(canonical => {
            fuzzyAttempts++;
            return canonical.includes(candidate) || candidate.includes(canonical);
          });

        candidates.push(...fuzzyMatches.slice(0, 5)); // Limit matches per candidate
      }
    } catch (error) {
      console.warn(`Fuzzy matching failed for "${rawPath}":`, error.message);
    }
  }

  // Remove duplicates while preserving order and limit total candidates
  return [...new Set(candidates.filter(Boolean))].slice(0, 10);
}

/**
 * Safely quote a file path for use in git commands
 * Handles special characters, spaces, and shell escaping
 */
function safeQuotePath(filePath) {
  if (!filePath) return '""';

  // Escape internal quotes and wrap in quotes
  const escaped = filePath.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Check if a file path exists in a given commit using git cat-file
 * This is the most reliable method according to Git documentation
 */
function pathExistsInCommit(commit, filePath, cwd) {
  try {
    const quotedPath = safeQuotePath(filePath);
    execSync(`git cat-file -e ${commit}:${quotedPath}`, {
      cwd,
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the best file path that actually exists in the commit
 * Uses multiple strategies and canonical path validation
 */
function findValidPath(commit, rawPath, cwd) {
  const candidates = getPathCandidates(rawPath, commit, cwd);

  // Try each candidate in order of preference
  for (const candidate of candidates) {
    if (pathExistsInCommit(commit, candidate, cwd)) {
      return candidate;
    }
  }

  // If no valid path found, log warning and use first candidate
  if (candidates.length > 0) {
    console.warn(`⚠️ No valid path found for "${rawPath}", using first candidate: "${candidates[0]}"`);
  }
  return candidates[0] || rawPath;
}

/**
 * Build a robust git show command with comprehensive path handling
 * Implements all best practices from Git documentation
 */
function buildGitShowCommand(commit, rawPath, cwd) {
  const validPath = findValidPath(commit, rawPath, cwd);
  const quotedPath = safeQuotePath(validPath);
  return `git show ${commit}:${quotedPath}`;
}

/**
 * Legacy function for backwards compatibility
 * Now uses the robust path finding logic
 */
function normalizeGitFilePath(rawPath) {
  const candidates = getPathCandidates(rawPath);
  const primaryPath = candidates[0] || rawPath;
  return safeQuotePath(primaryPath);
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
      console.log(`Attempting webhook call for chunk ${chunkIndex + 1} (attempt ${attempt}/${maxRetries})`);

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
        // Exponential backoff: wait 2^attempt seconds
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Retrying in ${delay}ms...`);
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
      console.log(`🚀 Starting chunk ${index + 1}/${chunks.length} (${chunk.length} bytes)`);
      const response = await callWebhookWithChunk(chunk, index, chunks.length);
      const chunkTime = (Date.now() - chunkStartTime) / 1000;
      results[index] = { success: true, data: response };
      console.log(`✅ Chunk ${index + 1} completed in ${chunkTime.toFixed(2)}s`);
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

function findProjectRoot(dir) {
  // Files/folders to ignore when searching for project root
  const ignoreList = [
    '.git',
    '.gitignore',
    '.gitattributes',
    '.npmignore',
    'README.md',
    'LICENSE',
    '.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    'node_modules',
    'build',
    'dist'
  ];

  // Check if current directory has package.json
  const packageJsonPath = path.join(dir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    return dir;
  }

  // Search in subdirectories, excluding ignored items
  const items = fs.readdirSync(dir);
  const directories = items.filter(item => {
    const itemPath = path.join(dir, item);
    const isDirectory = fs.statSync(itemPath).isDirectory();
    const shouldIgnore = ignoreList.includes(item);

    return isDirectory && !shouldIgnore;
  });

  // If there's only one directory, check if it contains the project
  if (directories.length === 1) {
    const subDir = path.join(dir, directories[0]);
    const subPackageJson = path.join(subDir, 'package.json');

    if (fs.existsSync(subPackageJson)) {
      return subDir;
    }

    // Recursively search deeper
    return findProjectRoot(subDir);
  }

  // If multiple directories, search each one
  for (const subDir of directories) {
    const subDirPath = path.join(dir, subDir);
    const found = findProjectRoot(subDirPath);
    if (found) return found;
  }

  return dir;
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

// GitHub API rate limiting
function checkRateLimit() {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;

  // Clean old entries
  for (const [timestamp] of githubApiCalls) {
    if (timestamp < windowStart) {
      githubApiCalls.delete(timestamp);
    }
  }

  // Check if we're over the limit
  if (githubApiCalls.size >= MAX_CALLS_PER_WINDOW) {
    throw new Error('GitHub API rate limit exceeded. Please try again later.');
  }

  // Record this API call
  githubApiCalls.set(now, true);
}

// GitHub repository management
async function createGithubRepo(repoName) {
  checkRateLimit();

  if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
    throw new Error('GitHub credentials not configured. Please set GITHUB_TOKEN and GITHUB_USERNAME environment variables.');
  }

  const response = await fetch(`https://api.github.com/user/repos`, {
    method: "POST",
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "GitHub-Zip-Worker/1.0",
    },
    body: JSON.stringify({
      name: repoName,
      private: false,
      description: `Auto-generated repository for ${repoName}`,
      auto_init: false,
    }),
  });

  if (response.status === 422) {
    return; // Repo already exists
  } else if (response.status === 401) {
    throw new Error('GitHub authentication failed. Please check your GITHUB_TOKEN.');
  } else if (response.status === 403) {
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    if (rateLimitRemaining === '0') {
      throw new Error('GitHub API rate limit exceeded. Please try again later.');
    }
    throw new Error('GitHub API access forbidden. Please check your token permissions.');
  } else if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub repo creation failed: ${error}`);
  }
}

async function checkRepoExists(repoName) {
  checkRateLimit();

  const response = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${repoName}`, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      "User-Agent": "GitHub-Zip-Worker/1.0",
    },
  });

  return response.status === 200;
}



const upload = multer({
  dest: path.join(process.cwd(), "uploads"),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

router.post("/:id/upload", authenticateToken, upload.single("project"), async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const { role, id: userId } = req.user;
  const { version } = req.body; // Get version from request body

  try {
    // Only admin or assigned manager can upload
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (
      role !== "admin" &&
      !(role === "manager" && project.assignedManagerId === userId)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Validate project name for GitHub repo
    const validatedProjectName = validateProjectName(project.name);

    // Generate version if not provided
    let versionNumber = version;
    if (!versionNumber) {
      const existingVersions = await prisma.projectVersion.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: 1
      });

      if (existingVersions.length === 0) {
        versionNumber = "1.0.0";
      } else {
        // Simple version increment - you can make this more sophisticated
        const lastVersion = existingVersions[0].version;
        const parts = lastVersion.split('.');
        const patch = parseInt(parts[2]) + 1;
        versionNumber = `${parts[0]}.${parts[1]}.${patch}`;
      }
    }

    const zipPath = req.file.path;
    // Check if the uploaded file actually exists
    if (!fs.existsSync(zipPath)) {
      return res.status(400).json({ error: 'Uploaded file not found on server' });
    }

    const projectFolder = path.join(process.cwd(), "projects", String(projectId));

    // Use file locking to prevent concurrent uploads
    const result = await withProjectLock(validatedProjectName, async () => {
      try {
        // Validate zip file
        const stats = fs.statSync(zipPath);
        if (stats.size === 0) {
          throw new Error('Zip file is empty');
        }

        // Check if this is an existing project with git history
        const gitDir = path.join(projectFolder, '.git');
        const isExistingProject = fs.existsSync(gitDir);

        if (isExistingProject) {
          // For existing projects, remove everything except .git directory
          const items = fs.readdirSync(projectFolder);
          for (const item of items) {
            if (item !== '.git') {
              const itemPath = path.join(projectFolder, item);
              fs.removeSync(itemPath);
            }
          }
        } else {
          // Clear the project directory completely for new projects
          fs.emptyDirSync(projectFolder);
        }

        // Extract zip file
        await extract(zipPath, { dir: projectFolder });

        // Verify extraction was successful
        const extractedFiles = fs.readdirSync(projectFolder);
        if (extractedFiles.length === 0) {
          throw new Error('Zip file extraction resulted in empty directory');
        }

        // Detect actual project folder (where package.json exists)
        let actualProjectPath = findProjectRoot(projectFolder);

        // Validate that it's a React project
        const packageJsonPath = path.join(actualProjectPath, 'package.json');

        if (!fs.existsSync(packageJsonPath)) {
          throw new Error(`Not a valid React project: package.json not found at ${packageJsonPath}`);
        }

        let packageJson;
        try {
          packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        } catch (error) {
          throw new Error('Invalid package.json file');
        }

        if (!packageJson.scripts || !packageJson.scripts.build) {
          throw new Error('Not a valid React project: build script not found in package.json');
        }

        // Find and inject scripts/components into root HTML file
        const htmlFiles = ['index.html', 'public/index.html', 'src/index.html'];
        let rootHtmlPath = null;

        for (const htmlFile of htmlFiles) {
          const potentialPath = path.join(actualProjectPath, htmlFile);
          if (fs.existsSync(potentialPath)) {
            rootHtmlPath = potentialPath;
            break;
          }
        }

        if (rootHtmlPath) {
          try {
            let htmlContent = fs.readFileSync(rootHtmlPath, 'utf-8');

            // Marker.io script to inject
            const markerScript = `<script>
window.markerConfig = {
              project: '66c70a4bc69f538671fe255f',
              source: 'snippet'
            };
          !function(e,r,a){if(!e.__Marker){e.__Marker={};var t=[],n={__cs:t};["show","hide","isVisible","capture","cancelCapture","unload","reload","isExtensionInstalled","setReporter","setCustomData","on","off"].forEach(function(e){n[e]=function(){var r=Array.prototype.slice.call(arguments);r.unshift(e),t.push(r)}}),e.Marker=n;var s=r.createElement("script");s.async=1,s.src="https://edge.marker.io/latest/shim.js";var i=r.getElementsByTagName("script")[0];i.parentNode.insertBefore(s,i)}}(window,document);
</script>`;

            // Get project header HTML using helper function
            const projectHeader = generateProjectHeader();

            let hasChanges = false;

            // Check if Marker.io script is already injected to avoid duplicates
            if (!htmlContent.includes('window.markerConfig')) {
              // Inject Marker.io script before closing head tag
              if (htmlContent.includes('</head>')) {
                htmlContent = htmlContent.replace('</head>', `${markerScript}\n</head>`);
              } else if (htmlContent.includes('<head>')) {
                htmlContent = htmlContent.replace('<head>', `<head>\n${markerScript}`);
              } else {
                if (htmlContent.includes('<body>')) {
                  htmlContent = htmlContent.replace('<body>', `<head>\n${markerScript}\n</head>\n<body>`);
                } else if (htmlContent.includes('<html>')) {
                  htmlContent = htmlContent.replace('<html>', `<html>\n<head>\n${markerScript}\n</head>`);
                }
              }
              hasChanges = true;
            }

            // Check if project header is already injected to avoid duplicates
            if (!htmlContent.includes('zip-sync-header')) {
              // Inject project header after opening body tag
              if (htmlContent.includes('<body>')) {
                htmlContent = htmlContent.replace('<body>', `<body>\n${projectHeader}`);
              } else if (htmlContent.includes('<body ')) {
                // Handle body tag with attributes
                htmlContent = htmlContent.replace(/<body([^>]*)>/, `<body$1>\n${projectHeader}`);
              } else {
                // Fallback: add to end of head or create body
                if (htmlContent.includes('</head>')) {
                  htmlContent = htmlContent.replace('</head>', `</head>\n<body>\n${projectHeader}\n</body>`);
                }
              }
              hasChanges = true;
            }

            if (hasChanges) {
              fs.writeFileSync(rootHtmlPath, htmlContent, 'utf-8');
            }
          } catch (error) {
            console.error('❌ Error injecting scripts/components:', error.message);
            // Continue with build process even if injection fails
          }
        }

        // Build React app
        try {
          console.log("📦 Installing project dependencies...");
          runCommand("npm install", actualProjectPath);
        } catch (error) {
          throw new Error(`Dependency installation failed: ${error.message}`);
        }

        try {
          console.log("🔨 Building project...");
          runCommand("npm run build", actualProjectPath);
        } catch (error) {
          throw new Error(`Build failed: ${error.message}`);
        }

        // Ensure .gitignore exists
        const gitignorePath = path.join(projectFolder, ".gitignore");
        if (!fs.existsSync(gitignorePath)) {
          fs.writeFileSync(gitignorePath, "node_modules\n.env\nbuild\ndist\n.DS_Store\n", "utf-8");
        }

        // Check if repository exists
        const repoExists = await checkRepoExists(validatedProjectName);

        // Git setup - use the isExistingProject we determined earlier
        const isNewRepo = !isExistingProject;

        if (isNewRepo) {
          runCommand("git init", projectFolder);
          runCommand("git branch -m main", projectFolder);

          // Set git config
          runCommand('git config user.name "GitHub Zip Worker"', projectFolder);
          runCommand('git config user.email "worker@github-zip.com"', projectFolder);

          // Create GitHub repo if it doesn't exist
          if (!repoExists) {
            await createGithubRepo(validatedProjectName);
          }

          const remoteUrl = `https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${validatedProjectName}.git`;
          runCommand(`git remote add origin ${remoteUrl}`, projectFolder);
        } else {
          // Set git config for existing repos
          runCommand('git config user.name "GitHub Zip Worker"', projectFolder);
          runCommand('git config user.email "worker@github-zip.com"', projectFolder);

          // Check if remote exists and add if needed
          try {
            runCommand("git remote -v", projectFolder);
          } catch (error) {
            const remoteUrl = `https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${validatedProjectName}.git`;
            runCommand(`git remote add origin ${remoteUrl}`, projectFolder);
          }
        }

        // Commit changes
        runCommand("git add .", projectFolder);

        try {
          const commitMessage = isNewRepo
            ? `Initial project upload at ${new Date().toISOString()}`
            : `Update project from zip upload at ${new Date().toISOString()}`;
          runCommand(`git commit -m "${commitMessage}"`, projectFolder);
        } catch (error) {
          if (!error.message.includes('nothing to commit') && !error.message.includes('no changes added to commit')) {
            throw new Error(`Commit failed: ${error.message}`);
          }
        }

        // Create unique tag
        const tag = `v-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        runCommand(`git tag ${tag}`, projectFolder);

        // Push to GitHub
        try {
          if (isNewRepo) {
            runCommand("git push -u origin main --tags", projectFolder);
          } else {
            runCommand("git push origin main --tags", projectFolder);
          }
        } catch (pushError) {
          console.error('❌ Push failed:', pushError.message);
          throw new Error(`Push to GitHub failed: ${pushError.message}`);
        }

        // Detect build output dir
        let outputDir = null;
        if (fs.existsSync(path.join(actualProjectPath, "build"))) {
          outputDir = "build";
        } else if (fs.existsSync(path.join(actualProjectPath, "dist"))) {
          outputDir = "dist";
        }

        if (!outputDir) {
          throw new Error("No build output found");
        }

        // Patch index.html asset paths (optional)
        const indexPath = path.join(actualProjectPath, outputDir, "index.html");
        if (fs.existsSync(indexPath)) {
          let html = fs.readFileSync(indexPath, "utf-8");
          html = html.replace(/"\/assets\//g, '"./assets/');
          fs.writeFileSync(indexPath, html);
        }

        // Calculate build URL
        const relativeBuildPath = path.relative(
          path.join(process.cwd(), "projects"),
          path.join(actualProjectPath, outputDir)
        );
        const buildUrl = `${config.BASE_URL}/apps/${relativeBuildPath}`;

        // Deactivate all existing versions for this project
        await prisma.projectVersion.updateMany({
          where: { projectId },
          data: { isActive: false }
        });

        // Create new version
        const newVersion = await prisma.projectVersion.create({
          data: {
            projectId,
            version: versionNumber,
            zipFilePath: req.file.path,
            buildUrl,
            isActive: true,
            uploadedBy: userId
          }
        });

        return {
          message: "✅ Project uploaded & pushed to GitHub",
          tag,
          repository: `https://github.com/${GITHUB_USERNAME}/${validatedProjectName}`,
          isNewRepo,
          buildUrl,
          version: newVersion
        };

      } catch (error) {
        // Clean up on error - keep directory for debugging
        throw error;
      }
    });

    res.json(result);

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    // Clean up uploaded file
    if (req.file && fs.existsSync(req.file.path)) {
      fs.removeSync(req.file.path);
    }
  }
});

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
  allowRoles("admin", "manager"),
  createProjectValidation,
  validate,
  projectController.create
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

// Get diff summary for a project
router.get("/:id/diff-summary", authenticateToken, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const { id: userId, role } = req.user;

  try {
    // Check access
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: "Project not found" });

    let hasAccess = false;
    if (role === "admin") hasAccess = true;
    else if (role === "manager" && project.assignedManagerId === userId) hasAccess = true;
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

    // Get project folder path
    const projectFolder = path.join(process.cwd(), "projects", String(projectId));

    // Ensure project exists
    if (!fs.existsSync(projectFolder)) {
      return res.status(404).json({ error: "Project folder not found" });
    }

    const gitDir = path.join(projectFolder, ".git");
    if (!fs.existsSync(gitDir)) {
      return res.status(400).json({ error: "Not a git repository" });
    }

    // Get last 2 commit hashes
    const logOutput = runCommand(
      "git log -2 --pretty=format:%H",
      projectFolder
    );
    const commits = logOutput.trim().split("\n");

    if (commits.length < 2) {
      return res
        .status(400)
        .json({ error: "Not enough commits to generate a diff" });
    }

    const [latestCommit, previousCommit] = commits;

    // Generate diff
    const diffOutput = runCommand(
      `git diff ${previousCommit} ${latestCommit}`,
      projectFolder
    );

    // Split diff into chunks if it's too large
    const diffChunks = splitDiffIntoChunks(diffOutput);
    console.log(`Diff split into ${diffChunks.length} chunks (total size: ${diffOutput.length} bytes)`);

    // Process chunks in parallel (up to 5 concurrent requests)
    const maxConcurrent = 5; // Configurable concurrent limit
    console.log(`Starting parallel processing of ${diffChunks.length} chunks with max ${maxConcurrent} concurrent requests...`);
    const startTime = Date.now();

    const parallelResults = await processChunksInParallel(diffChunks, maxConcurrent);

    const endTime = Date.now();
    const processingTime = (endTime - startTime) / 1000;

    const successfulChunks = parallelResults.filter(r => r.success).length;
    const failedChunks = parallelResults.filter(r => !r.success).length;

    console.log(`🚀 Parallel processing complete in ${processingTime.toFixed(2)}s: ${successfulChunks} successful, ${failedChunks} failed`);

    // Aggregate all responses into a single summary
    const summary = aggregateWebhookResponses(parallelResults);
    console.log('📊 Final summary structure:', JSON.stringify(summary, null, 2));

    res.json({
      projectId,
      projectName: project.name,
      repository: `https://github.com/${GITHUB_USERNAME}/${project.name}`,
      from: previousCommit,
      to: latestCommit,
      summary,
    });
  } catch (err) {
    console.error("Diff + summary error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get detailed git diff with individual file changes
router.get("/:id/git-diff", authenticateToken, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const { id: userId, role } = req.user;

  // PERFORMANCE SAFEGUARD: Set overall timeout for the entire operation
  const operationStartTime = Date.now();
  const MAX_OPERATION_TIME = 5 * 60 * 1000; // 5 minutes max

  const checkTimeout = () => {
    if (Date.now() - operationStartTime > MAX_OPERATION_TIME) {
      throw new Error('Git diff operation timed out after 5 minutes');
    }
  };

  try {
    // Check access (same as diff-summary)
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: "Project not found" });

    let hasAccess = false;
    if (role === "admin") hasAccess = true;
    else if (role === "manager" && project.assignedManagerId === userId) hasAccess = true;
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

    // Get project folder path
    const projectFolder = path.join(process.cwd(), "projects", String(projectId));

    // Ensure project exists
    if (!fs.existsSync(projectFolder)) {
      return res.status(404).json({ error: "Project folder not found" });
    }

    const gitDir = path.join(projectFolder, ".git");
    if (!fs.existsSync(gitDir)) {
      return res.status(400).json({ error: "Not a git repository" });
    }

    // Get last 2 commit hashes
    const logOutput = runCommand(
      "git log -2 --pretty=format:%H",
      projectFolder
    );
    const commits = logOutput.trim().split("\n");

    if (commits.length < 2) {
      return res.status(400).json({ error: "Not enough commits to generate a diff" });
    }

    const [latestCommit, previousCommit] = commits;

    // Get list of changed files with their status
    const changedFilesOutput = runCommand(
      `git diff --name-status ${previousCommit} ${latestCommit}`,
      projectFolder
    );

    // Get diff stats (additions/deletions per file)
    const diffStatsOutput = runCommand(
      `git diff --numstat ${previousCommit} ${latestCommit}`,
      projectFolder
    );

    // Parse changed files
    const changedFiles = [];
    const fileLines = changedFilesOutput.trim().split("\n").filter(line => line);
    const statsLines = diffStatsOutput.trim().split("\n").filter(line => line);

    // Create a map of file stats
    const statsMap = {};
    statsLines.forEach(line => {
      const parts = line.split("\t");
      if (parts.length === 3) {
        const [additions, deletions, filename] = parts;
        statsMap[filename] = {
          additions: additions === "-" ? 0 : parseInt(additions, 10),
          deletions: deletions === "-" ? 0 : parseInt(deletions, 10)
        };
      }
    });

    // PERFORMANCE SAFEGUARD: Limit number of files processed to prevent infinite loops
    const MAX_FILES_TO_PROCESS = 1000;
    const totalFiles = fileLines.length;

    if (totalFiles > MAX_FILES_TO_PROCESS) {
      console.warn(`⚠️ Large diff detected: ${totalFiles} files changed. Processing first ${MAX_FILES_TO_PROCESS} files only.`);
    }

    const filesToProcess = Math.min(totalFiles, MAX_FILES_TO_PROCESS);

    // Process each changed file using robust parsing
    for (let i = 0; i < filesToProcess; i++) {
      // PERFORMANCE SAFEGUARD: Check timeout periodically
      if (i % 50 === 0) { // Check every 50 files
        checkTimeout();
      }

      const line = fileLines[i];

      // Parse git diff line using the robust parser
      const parsed = parseGitDiffLine(line);
      if (!parsed) {
        console.warn(`Could not parse git diff line: ${line}`);
        continue;
      }

      const statusChar = parsed.status;
      const filename = parsed.filename;
      const oldPath = parsed.oldPath;
      const newPath = parsed.newPath;

      // PERFORMANCE SAFEGUARD: Skip files that are too large or binary early
      if (!filename || filename.length > 500) {
        console.warn(`Skipping file with invalid or too long filename: ${filename?.substring(0, 100)}...`);
        continue;
      }

      // Skip binary files and very large files
      const filePath = path.join(projectFolder, filename);
      let isLargeFile = false;
      let isBinaryFile = false;

      // Check if file exists and get size (with performance safeguards)
      if (fs.existsSync(filePath)) {
        try {
          const stats = fs.statSync(filePath);
          isLargeFile = stats.size > 100000; // 100KB limit

          // PERFORMANCE SAFEGUARD: Skip extremely large files completely
          if (stats.size > 10 * 1024 * 1024) { // 10MB limit
            console.warn(`Skipping extremely large file: ${filename} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
            continue;
          }

          // Simple binary file check (but limit read size)
          if (!isLargeFile) {
            try {
              const buffer = fs.readFileSync(filePath, { encoding: null, flag: 'r' }).slice(0, 8192); // Read only first 8KB
              isBinaryFile = buffer.includes(0);
            } catch (error) {
              console.warn(`Could not read file ${filename}:`, error.message);
              isBinaryFile = true;
            }
          }
        } catch (error) {
          console.warn(`Could not stat file ${filename}:`, error.message);
          isLargeFile = true;
        }
      }

      let oldValue = "";
      let newValue = "";

      if (!isBinaryFile && !isLargeFile) {
        try {
          // PERFORMANCE SAFEGUARD: Use shorter timeout for git show commands
          const gitShowOptions = {
            timeout: 10000, // 10 second timeout for individual files
            maxBuffer: 5 * 1024 * 1024 // 5MB max for individual files
          };

          // Get file content from previous commit
          if (statusChar !== "A") { // Not a new file
            try {
              // For renames, use the old path for the previous commit
              const pathForPrevCommit = oldPath || filename;
              const gitShowCommand = buildGitShowCommand(previousCommit, pathForPrevCommit, projectFolder);
              oldValue = runCommand(gitShowCommand, projectFolder, gitShowOptions);
            } catch (error) {
              console.log(`Could not get old content for ${filename}:`, error.message);
              oldValue = "";
            }
          }

          // Get file content from latest commit
          if (statusChar !== "D") { // Not a deleted file
            try {
              // For renames, use the new path for the latest commit
              const pathForLatestCommit = newPath || filename;
              const gitShowCommand = buildGitShowCommand(latestCommit, pathForLatestCommit, projectFolder);
              newValue = runCommand(gitShowCommand, projectFolder, gitShowOptions);
            } catch (error) {
              console.log(`Could not get new content for ${filename}:`, error.message);
              newValue = "";
            }
          }
        } catch (error) {
          console.log(`Error processing file ${filename}:`, error.message);
          isLargeFile = true; // Treat as large file if we can't process it
        }
      }

      // Determine file status
      let fileStatus;
      switch (statusChar) {
        case "A":
          fileStatus = "added";
          break;
        case "D":
          fileStatus = "deleted";
          break;
        case "M":
          fileStatus = "modified";
          break;
        case "R":
          fileStatus = "renamed";
          break;
        case "C":
          fileStatus = "copied";
          break;
        default:
          fileStatus = "modified";
      }

      const fileStats = statsMap[filename] || { additions: 0, deletions: 0 };

      changedFiles.push({
        id: i + 1,
        filename: path.basename(filename),
        path: filename,
        status: fileStatus,
        additions: fileStats.additions,
        deletions: fileStats.deletions,
        oldValue: isLargeFile || isBinaryFile ? "" : oldValue,
        newValue: isLargeFile || isBinaryFile ? "" : newValue,
        isLargeFile: isLargeFile,
        isBinaryFile: isBinaryFile
      });
    }

    // Calculate total stats
    const totalAdditions = changedFiles.reduce((sum, file) => sum + file.additions, 0);
    const totalDeletions = changedFiles.reduce((sum, file) => sum + file.deletions, 0);

    // Calculate processing summary
    const processingTime = Date.now() - operationStartTime;
    const wasLimitedByFileCount = totalFiles > MAX_FILES_TO_PROCESS;

    res.json({
      projectId,
      projectName: project.name,
      repository: `https://github.com/${GITHUB_USERNAME}/${project.name}`,
      from: previousCommit,
      to: latestCommit,
      files: changedFiles,
      totalFiles: changedFiles.length,
      totalFilesAvailable: totalFiles,
      wasLimited: wasLimitedByFileCount,
      totalAdditions,
      totalDeletions,
      processingTimeMs: processingTime
    });

  } catch (err) {
    console.error("Git diff error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get(
  "/:id/info",
  projectController.info
);
// API endpoint to generate Jira tickets from git diff summary
router.post("/:id/generate-jira-tickets", authenticateToken, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  console.log('Project ID:', projectId);
  const { id: userId, role } = req.user;
  console.log('User ID:', userId);
  console.log('Role:', role);

  try {
    // Check access
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: "Project not found" });

    let hasAccess = false;
    if (role === "admin") hasAccess = true;
    else if (role === "manager" && project.assignedManagerId === userId) hasAccess = true;
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

    // Get project folder path
    const projectFolder = path.join(process.cwd(), "projects", String(projectId));

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

    // Split diff into chunks if it's too large (same as diff-summary endpoint)
    const diffChunks = splitDiffIntoChunks(gitDiff);
    console.log(`Jira: Diff split into ${diffChunks.length} chunks (total size: ${gitDiff.length} bytes)`);

    // Process chunks in parallel (up to 5 concurrent requests)
    const maxConcurrent = 5;
    console.log(`Jira: Starting parallel processing of ${diffChunks.length} chunks with max ${maxConcurrent} concurrent requests...`);
    const startTime = Date.now();

    const parallelResults = await processChunksInParallel(diffChunks, maxConcurrent);

    const endTime = Date.now();
    const processingTime = (endTime - startTime) / 1000;

    const successfulChunks = parallelResults.filter(r => r.success).length;
    const failedChunks = parallelResults.filter(r => !r.success).length;

    console.log(`Jira: 🚀 Parallel processing complete in ${processingTime.toFixed(2)}s: ${successfulChunks} successful, ${failedChunks} failed`);

    // Aggregate all responses into a single summary
    const summary = aggregateWebhookResponses(parallelResults);
    console.log('Jira: 📊 Final summary structure:', JSON.stringify(summary, null, 2));

    // Create Jira tickets from summary
    const projectInfo = {
      id: projectId,
      name: project.name,
      version: "1.0.0", // You might want to get this from project versions
      commitHash: latestCommit,
      author: authorOutput.trim(),
      repository: `https://github.com/${GITHUB_USERNAME}/${project.name}`
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

export default router;
