import express from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.middleware.js";
import multer from "multer";
import path from "path";
import fs from "fs-extra";
import extract from "extract-zip";
import { exec, execSync } from "child_process";
import crypto from "crypto";
import fetch from "node-fetch";
import dotenv from "dotenv";

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
function validateProjectName(name) {
    if (!name || typeof name !== 'string') {
        throw new Error('Invalid project name: must be a non-empty string');
    }
    if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
        throw new Error('Project name contains invalid characters. Only alphanumeric, hyphens, and underscores allowed.');
    }
    if (name.length > 100) {
        throw new Error('Project name too long. Maximum 100 characters allowed.');
    }
    if (name.length < 1) {
        throw new Error('Project name too short. Minimum 1 character required.');
    }
    return name;
}

function sanitizeCommand(command) {
    const dangerousChars = /[;&|`$(){}[\]\\]/g;
    if (dangerousChars.test(command)) {
        throw new Error('Command contains potentially dangerous characters');
    }
    return command;
}

function runCommand(command, cwd) {
    const sanitizedCommand = sanitizeCommand(command);
    console.log(`Running: ${sanitizedCommand}`);
    try {
        return execSync(sanitizedCommand, { cwd, encoding: "utf-8", env: process.env });
    } catch (error) {
        console.error(`Command failed: ${sanitizedCommand}`);
        console.error(`Error: ${error.message}`);
        throw error;
    }
}

function findProjectRoot(dir) {
    console.log('🔍 Searching for project root in:', dir);

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
        console.log('✅ Found package.json in root directory');
        return dir;
    }

    // Search in subdirectories, excluding ignored items
    const items = fs.readdirSync(dir);
    const directories = items.filter(item => {
        const itemPath = path.join(dir, item);
        const isDirectory = fs.statSync(itemPath).isDirectory();
        const shouldIgnore = ignoreList.includes(item);
        
        if (shouldIgnore) {
            console.log(`🚫 Ignoring ${item} (in ignore list)`);
        }
        
        return isDirectory && !shouldIgnore;
    });

    console.log('📁 Valid directories to search:', directories);

    // If there's only one directory, check if it contains the project
    if (directories.length === 1) {
        const subDir = path.join(dir, directories[0]);
        const subPackageJson = path.join(subDir, 'package.json');

        if (fs.existsSync(subPackageJson)) {
            console.log(`✅ Found package.json in subdirectory: ${directories[0]}`);
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

    console.log('❌ No project root found');
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
        console.log("Repo already exists, skipping creation");
        return;
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
    } else {
        console.log(`✅ GitHub repo '${repoName}' created`);
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

router.get("/", authenticateToken, async (req, res) => {
  console.log("🚀 ~ req:", req)
  // List projects for user (admin: all, manager: assigned, client: access)
  const { id, role } = req.user;
  let projects;
  if (role === "admin") {
    projects = await prisma.project.findMany({
      include: {
        versions: {
          where: { isActive: true },
          select: { id: true, version: true, buildUrl: true, createdAt: true }
        }
      }
    });
  } else if (role === "manager") {
    projects = await prisma.project.findMany({ 
      where: { assignedManagerId: id },
      include: {
        versions: {
          where: { isActive: true },
          select: { id: true, version: true, buildUrl: true, createdAt: true }
        }
      }
    });
  } else {
    projects = await prisma.projectAccess.findMany({
      where: { userId: id },
      include: { 
        project: {
          include: {
            versions: {
              where: { isActive: true },
              select: { id: true, version: true, buildUrl: true, createdAt: true }
            }
          }
        }
      },
    });
    projects = projects.map(pa => pa.project);
  }
  res.json(projects);
});

router.post("/", authenticateToken, async (req, res) => {
  const { name, description, assignedManagerId } = req.body;
  const { id, role } = req.user;

  if (role !== "admin" && role !== "manager") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const project = await prisma.project.create({
      data: {
        name,
        description,
        createdById: id,
        assignedManagerId,
      },
    });
    res.status(201).json(project);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const upload = multer({
  dest: path.join(process.cwd(), "uploads"),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

router.post("/:id/upload", authenticateToken, upload.single("project"), async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const { role, id: userId } = req.user;
  const { version } = req.body; // Get version from request body

  try {
    console.log('🚀 Upload request received for project ID:', projectId);

    // Only admin or assigned manager can upload
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    console.log('🚀 ~ project:', project)
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
    console.log('📦 Uploaded file path:', zipPath);

    // Check if the uploaded file actually exists
    if (!fs.existsSync(zipPath)) {
      return res.status(400).json({ error: 'Uploaded file not found on server' });
    }

    const projectFolder = path.join(process.cwd(), "projects", String(projectId));
    console.log('📁 Project directory:', projectFolder);

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
          console.log('🔄 Updating existing project, preserving git history...');
          // For existing projects, we need to be more careful
          // Remove everything except .git directory
          const items = fs.readdirSync(projectFolder);
          for (const item of items) {
            if (item !== '.git') {
              const itemPath = path.join(projectFolder, item);
              fs.removeSync(itemPath);
            }
          }
        } else {
          console.log('🆕 New project, clearing directory...');
          // Clear the project directory completely for new projects
          fs.emptyDirSync(projectFolder);
        }

        // Extract zip file
        await extract(zipPath, { dir: projectFolder });
        console.log('📁 Extracted files:', fs.readdirSync(projectFolder));
        
        // Debug: Show the structure of extracted files
        const extractedItems = fs.readdirSync(projectFolder);
        for (const item of extractedItems) {
          const itemPath = path.join(projectFolder, item);
          const isDir = fs.statSync(itemPath).isDirectory();
          console.log(`📁 ${isDir ? '📂' : '📄'} ${item} ${isDir ? '(directory)' : '(file)'}`);
        }

        // Verify extraction was successful
        const extractedFiles = fs.readdirSync(projectFolder);
        if (extractedFiles.length === 0) {
          throw new Error('Zip file extraction resulted in empty directory');
        }

        // Detect actual project folder (where package.json exists)
        let actualProjectPath = findProjectRoot(projectFolder);
        console.log('🔍 Final actual project path:', actualProjectPath);

        // Validate that it's a React project
        const packageJsonPath = path.join(actualProjectPath, 'package.json');
        console.log('🔍 Looking for package.json at:', packageJsonPath);
        console.log('🔍 Package.json exists:', fs.existsSync(packageJsonPath));
        
        if (!fs.existsSync(packageJsonPath)) {
          // List all files in the actual project path for debugging
          const filesInPath = fs.readdirSync(actualProjectPath);
          console.log('📁 Files in actual project path:', filesInPath);
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

        // Find and inject Marker.io script into root HTML file
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

            // Check if script is already injected to avoid duplicates
            if (!htmlContent.includes('window.markerConfig')) {
              // Inject script before closing head tag
              if (htmlContent.includes('</head>')) {
                htmlContent = htmlContent.replace('</head>', `${markerScript}\n</head>`);
              } else if (htmlContent.includes('<head>')) {
                // If no closing head tag, inject after opening head tag
                htmlContent = htmlContent.replace('<head>', `<head>\n${markerScript}`);
              } else {
                // If no head tag at all, add it at the beginning of body or after html tag
                if (htmlContent.includes('<body>')) {
                  htmlContent = htmlContent.replace('<body>', `<head>\n${markerScript}\n</head>\n<body>`);
                } else if (htmlContent.includes('<html>')) {
                  htmlContent = htmlContent.replace('<html>', `<html>\n<head>\n${markerScript}\n</head>`);
                }
              }
              
              fs.writeFileSync(rootHtmlPath, htmlContent, 'utf-8');
              console.log('✅ Marker.io script injected into:', rootHtmlPath);
            } else {
              console.log('ℹ️  Marker.io script already present in:', rootHtmlPath);
            }
          } catch (error) {
            console.error('❌ Error injecting Marker.io script:', error.message);
            // Continue with build process even if script injection fails
          }
        } else {
          console.log('⚠️  No root HTML file found to inject Marker.io script');
        }

        // Build React app
        console.log('Installing dependencies...');
        try {
          runCommand("npm install", actualProjectPath);
        } catch (error) {
          throw new Error(`Dependency installation failed: ${error.message}`);
        }

        console.log('Building React app...');
        try {
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
        console.log('🔍 Repository exists:', repoExists);

        // Git setup - use the isExistingProject we determined earlier
        const isNewRepo = !isExistingProject;
        console.log('🔍 Project directory:', projectFolder);
        console.log('🔍 .git directory exists:', isExistingProject);
        console.log('🔍 Is new repository:', isNewRepo);
        console.log('🔍 GitHub repo exists:', repoExists);

        if (isNewRepo) {
          console.log('🆕 Initializing new Git repository...');
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
          console.log('🔄 Using existing Git repository...');

          // Set git config for existing repos
          runCommand('git config user.name "GitHub Zip Worker"', projectFolder);
          runCommand('git config user.email "worker@github-zip.com"', projectFolder);

          // Check if remote exists and add if needed
          try {
            runCommand("git remote -v", projectFolder);
            console.log('✅ Remote already configured');
          } catch (error) {
            console.log('⚠️ No remote configured, adding origin...');
            const remoteUrl = `https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${validatedProjectName}.git`;
            runCommand(`git remote add origin ${remoteUrl}`, projectFolder);
          }
        }

        // Commit changes
        console.log('📝 Committing project content...');
        runCommand("git add .", projectFolder);

        try {
          const commitMessage = isNewRepo
            ? `Initial project upload at ${new Date().toISOString()}`
            : `Update project from zip upload at ${new Date().toISOString()}`;
          runCommand(`git commit -m "${commitMessage}"`, projectFolder);
          console.log('✅ Changes committed successfully');
        } catch (error) {
          if (error.message.includes('nothing to commit') || error.message.includes('no changes added to commit')) {
            console.log("⚠️ Nothing new to commit, skipping...");
          } else {
            throw new Error(`Commit failed: ${error.message}`);
          }
        }

        // Create unique tag
        const tag = `v-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        runCommand(`git tag ${tag}`, projectFolder);

        // Push to GitHub
        console.log('🚀 Pushing to GitHub...');

        try {
          if (isNewRepo) {
            runCommand("git push -u origin main --tags", projectFolder);
            console.log('✅ Successfully pushed new repository to GitHub');
          } else {
            runCommand("git push origin main --tags", projectFolder);
            console.log('✅ Successfully pushed updates to GitHub');
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
        const buildUrl = `http://localhost:5000/apps/${relativeBuildPath}`;

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
        // Clean up on error
        if (fs.existsSync(projectFolder)) {
          console.log('Cleaning up project directory due to error...');
          // Keep directory for debugging, but log the error
        }
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

router.get("/:id/live-url", authenticateToken, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const { id: userId, role } = req.user;

  // Fetch project and check access
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return res.status(404).json({ error: "Project not found" });

  // Only admin, assigned manager, or allowed client can access
  let hasAccess = false;
  if (role === "admin") hasAccess = true;
  else if (role === "manager" && project.assignedManagerId === userId) hasAccess = true;
  else if (role === "client") {
    const access = await prisma.projectAccess.findFirst({
      where: { projectId, userId }
    });
    if (access) hasAccess = true;
  }
  if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

  // Get active version
  const activeVersion = await prisma.projectVersion.findFirst({
    where: { projectId, isActive: true }
  });

  if (!activeVersion) {
    return res.status(404).json({ error: "No live build found for this project" });
  }

  res.json({ liveUrl: activeVersion.buildUrl, version: activeVersion.version });
});

// Get all versions for a project
router.get("/:id/versions", authenticateToken, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const { id: userId, role } = req.user;

  // Check access
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return res.status(404).json({ error: "Project not found" });

  let hasAccess = false;
  if (role === "admin") hasAccess = true;
  else if (role === "manager" && project.assignedManagerId === userId) hasAccess = true;
  else if (role === "client") {
    const access = await prisma.projectAccess.findFirst({
      where: { projectId, userId }
    });
    if (access) hasAccess = true;
  }
  if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

  const versions = await prisma.projectVersion.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: {
      uploader: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  res.json(versions);
});

// Activate a specific version
router.post("/:id/versions/:versionId/activate", authenticateToken, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const versionId = parseInt(req.params.versionId, 10);
  const { id: userId, role } = req.user;

  // Check access
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return res.status(404).json({ error: "Project not found" });

  let hasAccess = false;
  if (role === "admin") hasAccess = true;
  else if (role === "manager" && project.assignedManagerId === userId) hasAccess = true;
  if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

  // Check if version exists
  const version = await prisma.projectVersion.findFirst({
    where: { id: versionId, projectId }
  });
  if (!version) return res.status(404).json({ error: "Version not found" });

  // Deactivate all versions
  await prisma.projectVersion.updateMany({
    where: { projectId },
    data: { isActive: false }
  });

  // Activate the selected version
  await prisma.projectVersion.update({
    where: { id: versionId },
    data: { isActive: true }
  });

  res.json({ message: "Version activated successfully" });
});

// Get diff summary for a project
router.get("/:id/diff-summary", authenticateToken, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const { id: userId, role } = req.user;

  try {
    console.log("🔍 Diff request for project ID:", projectId);

    // Check access
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: "Project not found" });

    let hasAccess = false;
    if (role === "admin") hasAccess = true;
    else if (role === "manager" && project.assignedManagerId === userId) hasAccess = true;
    else if (role === "client") {
      const access = await prisma.projectAccess.findFirst({
        where: { projectId, userId }
      });
      if (access) hasAccess = true;
    }
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

    console.log("📡 Forwarding diff to n8n webhook...");

    // Call n8n webhook
    const webhookResponse = await fetch(
      "https://workflow.yorkdevs.link/webhook/generatesummary",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff: diffOutput }),
      }
    );

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      throw new Error(`Webhook call failed: ${errorText}`);
    }

    const summary = await webhookResponse.json();

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

export default router;