import express from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { generateProjectHeader, generateReleaseHeader } from "../utils/headerUtils.js";
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

// Helper functions (reused from project.routes.js)
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

function runCommand(command, cwd, options = {}) {
    const sanitizedCommand = sanitizeCommand(command);
    
    const defaultOptions = {
        cwd,
        encoding: "utf-8",
        env: process.env,
        timeout: 300000, // 5 min default timeout
        maxBuffer: 10 * 1024 * 1024 // 10MB max buffer to prevent memory issues
    };
    
    const finalOptions = { ...defaultOptions, ...options };
    
    try {
        return execSync(sanitizedCommand, finalOptions);
    } catch (error) {
        console.error(`Command failed: ${sanitizedCommand} - ${error.message}`);
        
        if (error.code === 'TIMEOUT') {
            throw new Error(`Command timed out after ${finalOptions.timeout}ms: ${sanitizedCommand}`);
        } else if (error.message.includes('maxBuffer')) {
            throw new Error(`Command output too large (>10MB): ${sanitizedCommand}`);
        }
        
        throw error;
    }
}

function findProjectRoot(dir) {
    const ignoreList = [
        '.git', '.gitignore', '.gitattributes', '.npmignore',
        'README.md', 'LICENSE', '.DS_Store', 'Thumbs.db',
        'desktop.ini', 'node_modules', 'build', 'dist'
    ];

    const packageJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        return dir;
    }

    const items = fs.readdirSync(dir);
    const directories = items.filter(item => {
        const itemPath = path.join(dir, item);
        const isDirectory = fs.statSync(itemPath).isDirectory();
        const shouldIgnore = ignoreList.includes(item);
        return isDirectory && !shouldIgnore;
    });

    if (directories.length === 1) {
        const subDir = path.join(dir, directories[0]);
        const subPackageJson = path.join(subDir, 'package.json');
        if (fs.existsSync(subPackageJson)) {
            return subDir;
        }
        return findProjectRoot(subDir);
    }

    for (const subDir of directories) {
        const subDirPath = path.join(dir, subDir);
        const found = findProjectRoot(subDirPath);
        if (found) return found;
    }

    return dir;
}

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

// GitHub API functions
function checkRateLimit() {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;

    for (const [timestamp] of githubApiCalls) {
        if (timestamp < windowStart) {
            githubApiCalls.delete(timestamp);
        }
    }

    if (githubApiCalls.size >= MAX_CALLS_PER_WINDOW) {
        throw new Error('GitHub API rate limit exceeded. Please try again later.');
    }

    githubApiCalls.set(now, true);
}

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

// Get all releases for a project
router.get("/project/:projectId", authenticateToken, async (req, res) => {
    const projectId = parseInt(req.params.projectId, 10);
    const { id: userId, role } = req.user;

    try {
        // Check access
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) return res.status(404).json({ error: "Project not found" });

        let hasAccess = false;
        if (role === "admin") hasAccess = true;
        else if (role === "manager" && project.assignedManagerId === userId) hasAccess = true;
        
        if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

        const releases = await prisma.release.findMany({
            where: { projectId },
            include: {
                creator: {
                    select: { id: true, name: true, email: true }
                },
                versions: {
                    orderBy: { createdAt: 'desc' },
                    include: {
                        uploader: {
                            select: { id: true, name: true, email: true }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(releases);
    } catch (error) {
        console.error('Error fetching releases:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create a new release
router.post("/", authenticateToken, async (req, res) => {
    const { projectId, name, description } = req.body;
    const { id: userId, role } = req.user;

    try {
        // Check access
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) return res.status(404).json({ error: "Project not found" });

        let hasAccess = false;
        if (role === "admin") hasAccess = true;
        else if (role === "manager" && project.assignedManagerId === userId) hasAccess = true;
        
        if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Release name is required" });
        }

        const release = await prisma.release.create({
            data: {
                projectId,
                name: name.trim(),
                description: description?.trim() || null,
                createdBy: userId
            },
            include: {
                creator: {
                    select: { id: true, name: true, email: true }
                }
            }
        });

        res.status(201).json(release);
    } catch (error) {
        console.error('Error creating release:', error);
        res.status(500).json({ error: error.message });
    }
});

// Lock/Unlock a release
router.post("/:releaseId/lock", authenticateToken, async (req, res) => {
    const releaseId = parseInt(req.params.releaseId, 10);
    const { locked } = req.body;
    const { id: userId, role } = req.user;

    try {
        // Check if release exists and user has permission
        const release = await prisma.release.findUnique({
            where: { id: releaseId },
            include: {
                project: {
                    select: { id: true, name: true, assignedManagerId: true }
                }
            }
        });

        if (!release) {
            return res.status(404).json({ error: "Release not found" });
        }

        // Check permissions
        let hasPermission = false;
        if (role === "admin") {
            hasPermission = true;
        } else if (role === "manager" && release.project.assignedManagerId === userId) {
            hasPermission = true;
        }
        
        if (!hasPermission) {
            return res.status(403).json({ error: "Forbidden: You don't have permission to lock/unlock this release" });
        }

        if (typeof locked !== 'boolean') {
            return res.status(400).json({ error: "Invalid 'locked' parameter. Must be true or false." });
        }

        const updatedRelease = await prisma.release.update({
            where: { id: releaseId },
            data: { isLocked: locked },
            include: {
                creator: {
                    select: { id: true, name: true, email: true }
                }
            }
        });

        res.json({
            message: `Release ${locked ? 'locked' : 'unlocked'} successfully`,
            release: updatedRelease
        });
    } catch (error) {
        console.error('Error updating release lock status:', error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// API endpoint to get release info for header display
router.get("/:releaseId/info", async (req, res) => {
    const releaseId = parseInt(req.params.releaseId, 10);
    
    try {
        // Get release info with project details
        const release = await prisma.release.findUnique({
            where: { id: releaseId },
            include: {
                project: {
                    select: { 
                        id: true, 
                        name: true
                    }
                },
                versions: {
                    where: { isActive: true },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { version: true, createdAt: true }
                }
            }
        });
        
        if (!release) {
            return res.status(404).json({ error: "Release not found" });
        }

        // Generate a unique lock token for this release
        const lockToken = crypto.randomBytes(32).toString('hex');

        res.json({
            id: release.id,
            name: release.name,
            project: release.project,
            version: release.versions[0]?.version || "1.0.0",
            lastUpdated: release.versions[0]?.createdAt || null,
            locked: release.isLocked || false,
            lockToken: lockToken
        });
    } catch (error) {
        console.error('Error fetching release info:', error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Public API endpoint to lock/unlock a release (for clients without authentication)
router.post("/:releaseId/public-lock", async (req, res) => {
    const releaseId = parseInt(req.params.releaseId, 10);
    const { locked, token } = req.body;
    
    try {
        // Validate required parameters
        if (typeof locked !== 'boolean') {
            return res.status(400).json({ error: "Invalid 'locked' parameter. Must be true or false." });
        }
        
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ error: "Token is required for public lock operations." });
        }

        // Check if release exists
        const release = await prisma.release.findUnique({
            where: { id: releaseId },
            include: {
                project: {
                    select: { 
                        id: true, 
                        name: true
                    }
                }
            }
        });
        
        if (!release) {
            return res.status(404).json({ error: "Release not found" });
        }

        // For now, accept any token since we're generating unique tokens per request
        // In a production environment, you might want to implement token validation
        if (!token || typeof token !== 'string') {
            return res.status(403).json({ error: "Invalid or missing lock token for this release." });
        }

        // Update release lock status
        const updatedRelease = await prisma.release.update({
            where: { id: releaseId },
            data: { isLocked: locked },
            select: { 
                id: true, 
                name: true, 
                isLocked: true 
            }
        });

        res.json({
            message: `Release ${locked ? 'locked' : 'unlocked'} successfully`,
            releaseId: updatedRelease.id,
            releaseName: updatedRelease.name,
            locked: updatedRelease.isLocked
        });
    } catch (error) {
        console.error('Error updating release lock status via public endpoint:', error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Upload ZIP to a release
const upload = multer({
    dest: path.join(process.cwd(), "uploads"),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

router.post("/:releaseId/upload", authenticateToken, upload.single("project"), async (req, res) => {
    const releaseId = parseInt(req.params.releaseId, 10);
    const { role, id: userId } = req.user;
    const { version } = req.body;

    try {
        // Check if release exists and is not locked
        const release = await prisma.release.findUnique({
            where: { id: releaseId },
            include: {
                project: {
                    select: { id: true, name: true, assignedManagerId: true }
                }
            }
        });

        if (!release) return res.status(404).json({ error: "Release not found" });

        // Check if release is locked
        if (release.isLocked) {
            return res.status(400).json({ error: "Cannot upload to a locked release. Create a new release instead." });
        }

        // Check permissions
        let hasAccess = false;
        if (role === "admin") hasAccess = true;
        else if (role === "manager" && release.project.assignedManagerId === userId) hasAccess = true;
        
        if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        // Validate project name for GitHub repo
        const validatedProjectName = validateProjectName(release.project.name);

        // Generate version if not provided
        let versionNumber = version;
        if (!versionNumber) {
            const existingVersions = await prisma.projectVersion.findMany({
                where: { releaseId },
                orderBy: { createdAt: 'desc' },
                take: 1
            });
            
            if (existingVersions.length === 0) {
                versionNumber = "1.0.0";
            } else {
                const lastVersion = existingVersions[0].version;
                const parts = lastVersion.split('.');
                const patch = parseInt(parts[2]) + 1;
                versionNumber = `${parts[0]}.${parts[1]}.${patch}`;
            }
        }

        const zipPath = req.file.path;
        if (!fs.existsSync(zipPath)) {
            return res.status(400).json({ error: 'Uploaded file not found on server' });
        }

        const projectFolder = path.join(process.cwd(), "projects", String(release.project.id));

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

                // Detect actual project folder
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

                        // Get release header HTML using helper function
                        const projectHeader = generateReleaseHeader();

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
                    runCommand("npm install", actualProjectPath);
                } catch (error) {
                    throw new Error(`Dependency installation failed: ${error.message}`);
                }

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

                // Git setup
                const isNewRepo = !isExistingProject;

                if (isNewRepo) {
                    runCommand("git init", projectFolder);
                    runCommand("git branch -m main", projectFolder);
                    runCommand('git config user.name "GitHub Zip Worker"', projectFolder);
                    runCommand('git config user.email "worker@github-zip.com"', projectFolder);

                    if (!repoExists) {
                        await createGithubRepo(validatedProjectName);
                    }

                    const remoteUrl = `https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${validatedProjectName}.git`;
                    runCommand(`git remote add origin ${remoteUrl}`, projectFolder);
                } else {
                    runCommand('git config user.name "GitHub Zip Worker"', projectFolder);
                    runCommand('git config user.email "worker@github-zip.com"', projectFolder);

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

                // Calculate build URL with release ID parameter
                const relativeBuildPath = path.relative(
                    path.join(process.cwd(), "projects"),
                    path.join(actualProjectPath, outputDir)
                );
                const buildUrl = `http://43.205.121.85:5000/apps/${relativeBuildPath}?releaseId=${releaseId}`;

                // Deactivate all existing versions for this project
                await prisma.projectVersion.updateMany({
                    where: { projectId: release.project.id },
                    data: { isActive: false }
                });

                // Create new version linked to release
                const newVersion = await prisma.projectVersion.create({
                    data: {
                        projectId: release.project.id,
                        releaseId: releaseId,
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

export default router;
