import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs-extra";
import extract from "extract-zip";
import { execSync } from "child_process";
import crypto from "crypto";
import fetch from "node-fetch";
import ApiError from "../utils/apiError.js";
import { generateReleaseHeader } from "../utils/headerUtils.js";
import { uploadFileToS3Multipart, uploadDirectoryToS3 } from "../utils/uploadFiletoS3.js";

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

// --- Helper Functions (Private) ---

function validateProjectName(name) {
    if (!name || typeof name !== 'string') {
        throw new ApiError('Invalid project name: must be a non-empty string');
    }
    if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
        throw new ApiError('Project name contains invalid characters. Only alphanumeric, hyphens, and underscores allowed.');
    }
    if (name.length > 100) {
        throw new ApiError('Project name too long. Maximum 100 characters allowed.');
    }
    if (name.length < 1) {
        throw new ApiError('Project name too short. Minimum 1 character required.');
    }
    return name;
}

function sanitizeCommand(command) {
    const dangerousChars = /[;&|`$(){}[\]\\]/g;
    if (dangerousChars.test(command)) {
        throw new ApiError('Command contains potentially dangerous characters');
    }
    return command;
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
async function findHtmlEntry(projectRoot) {
    const candidates = [
        path.join(projectRoot, "index.html"),              // Vite
        path.join(projectRoot, "public", "index.html"),    // CRA
    ];

    for (const file of candidates) {
        if (fs.existsSync(file)) {
            return file;
        }
    }

    return null;
}
async function withProjectLock(projectName, operation) {
    if (projectLocks.has(projectName)) {
        throw new ApiError('Project is currently being processed. Please try again in a moment.');
    }

    projectLocks.set(projectName, true);
    try {
        return await operation();
    } finally {
        projectLocks.delete(projectName);
    }
}

function checkRateLimit() {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;

    for (const [timestamp] of githubApiCalls) {
        if (timestamp < windowStart) {
            githubApiCalls.delete(timestamp);
        }
    }

    if (githubApiCalls.size >= MAX_CALLS_PER_WINDOW) {
        throw new ApiError('GitHub API rate limit exceeded. Please try again later.');
    }

    githubApiCalls.set(now, true);
}

async function createGithubRepo(repoName) {
    checkRateLimit();

    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        throw new ApiError('GitHub credentials not configured. Please set GITHUB_TOKEN and GITHUB_USERNAME environment variables.');
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
        throw new ApiError('GitHub authentication failed. Please check your GITHUB_TOKEN.');
    } else if (response.status === 403) {
        const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
        if (rateLimitRemaining === '0') {
            throw new ApiError('GitHub API rate limit exceeded. Please try again later.');
        }
        throw new ApiError('GitHub API access forbidden. Please check your token permissions.');
    } else if (!response.ok) {
        const error = await response.text();
        throw new ApiError(`GitHub repo creation failed: ${error}`);
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

function runCommand(command, cwd, options = {}) {
    const sanitizedCommand = sanitizeCommand(command);

    const defaultOptions = {
        cwd,
        encoding: "utf-8",
        // 1. Ensure shell is true so Node handles the command string correctly
        shell: true,
        env: {
            ...process.env,
            NODE_PATH: `${cwd}/node_modules`,
            // 2. Fallback to a blank string if process.env.PATH is undefined
            PATH: `${process.env.PATH || ''}:${cwd}/node_modules/.bin`
        },
        timeout: 300000,
        maxBuffer: 10 * 1024 * 1024
    };

    const finalOptions = { ...defaultOptions, ...options };

    try {
        return execSync(sanitizedCommand, finalOptions);
    } catch (error) {
        console.error(`Command failed: ${sanitizedCommand} - ${error.message}`);

        if (error.code === 'TIMEOUT') {
            throw new ApiError(`Command timed out after ${finalOptions.timeout}ms: ${sanitizedCommand}`);
        } else if (error.message.includes('maxBuffer')) {
            throw new ApiError(`Command output too large (>10MB): ${sanitizedCommand}`);
        }

        throw error;
    }
}


// --- Service Functions ---

/**
 * List releases for a project
 */
export const listReleasesService = async (projectId, user) => {
    const { id: userId, role } = user;

    // Check project access
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new ApiError(404, "Project not found");

    let hasAccess = false;
    if (role === "admin") hasAccess = true;
    else if (role === "manager" && project.assignedManagerId === userId) hasAccess = true;

    if (!hasAccess) throw new ApiError(403, "Forbidden");

    return prisma.release.findMany({
        where: { projectId },
        include: {
            creator: {
                select: { id: true, name: true, email: true }
            },
            versions: {
                orderBy: { createdAt: 'desc' },
                include: {
                    roadmapItems: true,
                    uploader: {
                        select: { id: true, name: true, email: true }
                    }
                }
            },
        },
        orderBy: { createdAt: 'desc' }
    });
};

/**
 * Get single release by ID
 */
export const getReleaseByIdService = async (releaseId) => {
    const release = await prisma.release.findUnique({
        where: { id: releaseId },
        include: {
            project: {
                select: {
                    id: true,
                    name: true,
                    assignedManagerId: true
                }
            },
            versions: {
                where: { isActive: true },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { version: true, createdAt: true, roadmapItems: true }
            },
        }
    });

    if (!release) {
        throw new ApiError(404, "Release not found");
    }
    return release;
};

/**
 * Create a new release
 */
export const createReleaseService = async (data, user) => {
    const { projectId, name, description, roadmapItemId } = data;
    const { id: userId, role } = user;

    // Check access
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new ApiError(404, "Project not found");

    let hasAccess = false;
    if (role === "admin") hasAccess = true;
    else if (role === "manager" && project.assignedManagerId === userId) hasAccess = true;

    if (!hasAccess) throw new ApiError(403, "Forbidden");

    const latestRelease = await prisma.release.findFirst({
        where: { projectId },
        orderBy: { id: "desc" },
        select: { isLocked: true }
    });

    if (latestRelease && !latestRelease.isLocked) {
        throw new ApiError(
            400,
            "Lock the latest release before creating a new one"
        );
    }

    if (!name || !name.trim()) {
        throw new ApiError(400, "Release name is required");
    }

    // Verify roadmap item if provided
    if (roadmapItemId) {
        const roadmapItem = await prisma.roadmapItem.findUnique({
            where: { id: roadmapItemId },
            include: { roadmap: true }
        });
        if (!roadmapItem) {
            throw new ApiError(404, "Roadmap item not found");
        }
        // Ensure roadmap item belongs to the same project
        if (roadmapItem.roadmap.projectId !== projectId) {
            throw new ApiError(400, "Roadmap item does not belong to this project");
        }
    }

    return prisma.$transaction(async (tx) => {
        const release = await tx.release.create({
            data: {
                projectId,
                name: name.trim(),
                description: description?.trim() || null,
                createdBy: userId,
            },
            include: {
                creator: {
                    select: { id: true, name: true, email: true }
                }
            }
        });

        // Link roadmap item if provided
        if (roadmapItemId) {
            await tx.roadmapItem.update({
                where: { id: roadmapItemId },
                data: { releaseId: release.id }
            });
        }

        return release;
    });
};

/**
 * Lock or unlock a release
 */


export const lockReleaseService = async (releaseId, locked, user) => {
    const { id: userId, role } = user;

    // 1️⃣ Fetch target release + latest release in ONE go
    const release = await prisma.release.findUnique({
        where: { id: releaseId },
        select: {
            id: true,
            isLocked: true,
            projectId: true,
            isActive: true,
            project: {
                select: { assignedManagerId: true }
            }
        }
    });

    if (!release) {
        throw new ApiError(404, "Release not found");
    }

    /** ---------------- Permission ---------------- */
    const hasPermission =
        role === "admin" ||
        (role === "manager" && release.project.assignedManagerId === userId);

    if (!hasPermission) {
        throw new ApiError(403, "Forbidden");
    }

    // 2️⃣ Fetch latest release for the project
    const latestRelease = await prisma.release.findFirst({
        where: { projectId: release.projectId },
        orderBy: { id: "desc" },
        select: { id: true, isLocked: true }
    });

    /** ---------------- Locked release cannot be changed ---------------- */
    if (release.isLocked && locked === true) {
        throw new ApiError(400, "Locked release cannot be modified");
    }

    /** ---------------- Unlock rules ---------------- */
    if (locked === false) {
        if (!release.isLocked) {
            throw new ApiError(400, "Release is already unlocked");
        }

        if (release.id !== latestRelease.id) {
            throw new ApiError(
                400,
                "Only the latest release can be unlocked"
            );
        }
    }

    /** ---------------- Lock rules ---------------- */
    if (locked === true) {
        // Allow locking any unlocked release (typically latest)
        // No sequence restriction needed anymore
        // Already locked → no-op or error
        if (release.isLocked) {
            throw new ApiError(400, "Release is already locked");
        }

        // Only latest release can be locked
        if (release.id !== latestRelease.id) {
            throw new ApiError(
                400,
                "Only the latest release can be locked"
            );
        }
    }

    /** ---------------- Update ---------------- */
    return prisma.release.update({
        where: { id: releaseId },
        data: { isLocked: locked }
    });
};


export const uploadReleaseVersionService = async (
    releaseId,
    file,
    versionInput,
    roadmapItemIds,
    user
) => {
    const { role, id: userId } = user;
    const zipPath = file.path;
    const S3_BUCKET = process.env.AWS_S3_BUCKET;
    const AWS_REGION = process.env.AWS_REGION;

    /* -------------------- 1. Fetch & validate release -------------------- */
    const release = await prisma.release.findUnique({
        where: { id: releaseId },
        include: {
            project: { select: { id: true, name: true, assignedManagerId: true } }
        }
    });

    if (!release) throw new ApiError(404, "Release not found");
    if (release.isLocked) throw new ApiError(400, "Release is locked");

    const hasAccess =
        role === "admin" ||
        (role === "manager" && release.project.assignedManagerId === userId);

    if (!hasAccess) throw new ApiError(403, "Forbidden");

    /* -------------------- 2. Resolve version number -------------------- */
    let versionNumber = versionInput;

    if (!versionNumber) {
        const lastVersion = await prisma.projectVersion.findFirst({
            where: { releaseId },
            orderBy: { createdAt: "desc" },
            select: { version: true }
        });

        if (!lastVersion) {
            versionNumber = "1.0.0";
        } else {
            const [major, minor, patch] = lastVersion.version.split(".").map(Number);
            versionNumber = `${major}.${minor}.${patch + 1}`;
        }
    }
    /* -------------------- 3. File validations -------------------- */

    if (!file) throw new ApiError(400, "File not provided");

    const isZip =
        file.originalname.toLowerCase().endsWith(".zip") &&
        ["application/zip", "application/x-zip-compressed"].includes(file.mimetype);

    if (!isZip) throw new ApiError(400, "Only ZIP files allowed");

    /* -------------------- 4. Prepare project folder -------------------- */
    const projectRoot = path.join(
        process.cwd(),
        "projects",
        String(release.project.id),
        versionNumber
    );
    const projectFolder = path.join(
        process.cwd(),
        "projects",
        String(release.project.id)
    );

    const gitDir = path.join(projectFolder, ".git");

    const isExistingProject = fs.existsSync(gitDir);
    if (isExistingProject) {
        for (const item of fs.readdirSync(projectFolder)) {
            if (item !== ".git") {
                fs.removeSync(path.join(projectFolder, item));
            }
        }
    } else {
        fs.emptyDirSync(projectFolder);
    }

    /* -------------------- 5. Extract zip -------------------- */
    await extract(zipPath, { dir: projectRoot });

    const actualProjectPath = findProjectRoot(projectRoot);
    const packageJsonPath = path.join(actualProjectPath, "package.json");

    if (!fs.existsSync(packageJsonPath))
        throw new ApiError(400, "package.json missing");

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    if (!packageJson?.scripts?.build)
        throw new ApiError(400, "Build script missing");

    /* -------------------- 6. Inject HTML headers / scripts (SAFE) -------------------- */
    const rootHtmlPath = await findHtmlEntry(actualProjectPath);
    const markerScript = `<script>
window.markerConfig = {
project: '68b6da8e7a78dd9ff9cff850',
};
!function(e,r,a){if(!e.__Marker){e.__Marker={};var t=[],n={__cs:t};["show","hide","isVisible","capture","cancelCapture","unload","reload","isExtensionInstalled","setReporter","clearReporter","setCustomData","on","off"].forEach(function(e){n[e]=function(){var r=Array.prototype.slice.call(arguments);r.unshift(e),t.push(r)}}),e.Marker=n;var s=r.createElement("script");s.async=1,s.src="https://edge.marker.io/latest/shim.js";var i=r.getElementsByTagName("script")[0];i.parentNode.insertBefore(s,i)}}(window,document);
</script>`;
    if (rootHtmlPath) {
        let html = fs.readFileSync(rootHtmlPath, "utf-8");

        // Basic sanity check
        if (!html.includes("<html")) {
            console.warn("⚠️ Skipping HTML injection: invalid HTML file");
        } else {
            let updated = false;

            // Inject Marker script ONLY if <head> exists
            if (
                !html.includes("window.markerConfig") &&
                html.toLowerCase().includes("</head>")
            ) {
                html = html.replace(
                    /<\/head>/i,
                    `${markerScript}\n</head>`
                );
                updated = true;
            }

            // Remove existing header if present to ensure we invoke with latest data
            if (html.includes("zip-sync-header")) {
                // Remove Style
                html = html.replace(/<style>[\s\S]*?\.zip-sync-header[\s\S]*?<\/style>/, "");
                // Remove Div
                html = html.replace(/<div class="zip-sync-header"[\s\S]*?<\/div>/, "");
                // Remove Script
                html = html.replace(/<script>[\s\S]*?ZipSync Header functionality[\s\S]*?<\/script>/, "");
            }

            // Always inject the header if body exists
            if (html.toLowerCase().includes("<body")) {

                const headerData = {
                    projectId: release.project.id,
                    releaseId: release.id,
                    version: versionNumber,
                    projectName: release.project.name,
                    releaseName: release.name,
                    apiUrl: process.env.BASE_URL || "http://localhost:5000"
                };
                console.log('🔧 Injecting release header with data:', headerData);
                const generatedHeader = generateReleaseHeader(headerData);
                html = html.replace(
                    /<body([^>]*)>/i,
                    `<body$1>\n${generatedHeader}`
                );
                updated = true;
            }

            if (updated) {
                fs.writeFileSync(rootHtmlPath, html, "utf-8");
            }
        }
    }
    /* -------------------- 7. Build project -------------------- */
    runCommand("npm install", actualProjectPath);
    runCommand("npm run build", actualProjectPath);

    /* -------------------- 8. Git setup & push -------------------- */
    const validatedProjectName = validateProjectName(release.project.name);

    // const projectFolder = path.join(process.cwd(), "projects", String(release.project.id));
    const gitWorkingDir = actualProjectPath; // e.g. .../projects/20/1.0.2
    const permanentGitDir = path.join(projectFolder, ".git");
    const localGitDir = path.join(gitWorkingDir, ".git");

    // 1. If a .git folder exists in the parent, MOVE it into our new version folder
    if (fs.existsSync(permanentGitDir)) {
        fs.moveSync(permanentGitDir, localGitDir);
    }

    // 2. Initialize if NO history was found (First time ever)
    if (!fs.existsSync(localGitDir)) {
        runCommand("git init", gitWorkingDir);
        runCommand("git branch -m main", gitWorkingDir);
        runCommand(`git config user.name "Zip Worker"`, gitWorkingDir);
        runCommand(`git config user.email "worker@zip.com"`, gitWorkingDir);
        const repoExists = await checkRepoExists(validatedProjectName);
        if (!repoExists) await createGithubRepo(validatedProjectName);

        const remoteUrl = `https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${validatedProjectName}.git`;
        runCommand(`git remote add origin ${remoteUrl}`, gitWorkingDir);
    }

    // 3. Sync and Commit
    const gitignoreContent = "node_modules\n.DS_Store\n.env\ndist\nbuild";
    fs.writeFileSync(path.join(gitWorkingDir, ".gitignore"), gitignoreContent);

    runCommand("git add .", gitWorkingDir);
    try {
        runCommand(`git commit -m "Release ${versionNumber} upload"`, gitWorkingDir);
    } catch (e) {
        console.log("No changes detected.");
    }

    // 4. Push (Standard push should work now because history is preserved)
    console.log("🚀 Pushing update...");
    try {
        runCommand("git push origin main", gitWorkingDir);
    } catch (e) {
        console.log("⚠️ Standard push failed, attempting force push as fallback...");
        // Force push only as a fallback
        runCommand("git push origin main --force", gitWorkingDir);
    }

    // 5. IMPORTANT: Move the .git folder back to the parent for the NEXT version to use
    fs.moveSync(localGitDir, permanentGitDir);


    /* -------------------- 9. Resolve build output -------------------- */
    const buildDir = fs.existsSync(path.join(actualProjectPath, "build"))
        ? "build"
        : fs.existsSync(path.join(actualProjectPath, "dist"))
            ? "dist"
            : null;
    if (!buildDir) throw new ApiError(400, "Build output not found");

    const buildDirPath = path.join(actualProjectPath, buildDir);

    // FIX: Patch index.html to use relative paths (e.g., /assets/ -> assets/)
    const indexPath = path.join(buildDirPath, "index.html");
    if (fs.existsSync(indexPath)) {
        let html = fs.readFileSync(indexPath, "utf-8");

        // This version handles:
        // 1. src="/assets/..." -> src="assets/..."
        // 2. href="/assets/..." -> href="assets/..."
        // 3. Any quotes or lack thereof
        html = html.replace(/(src|href)=["']?\/assets\//g, (match, p1) => {
            return `${p1}="assets/`;
        });

        // CATCH-ALL: Force any string starting with /assets, /images, or /vectors to be relative
        html = html.replace(/["']\/(assets|images|vectors|static)\//g, (match, p1) => {
            return `"${p1}/`;
        });

        fs.writeFileSync(indexPath, html, "utf-8");
    }
    /* -------------------- 10. Upload ZIP to S3 -------------------- */

    const s3BaseKey = `projects/${release.project.id}/releases/${releaseId}/${versionNumber}`;
    const patchAllAssets = (dir) => {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) {
                patchAllAssets(filePath);
            } else if (/\.(js|css|html)$/.test(file)) {
                let content = fs.readFileSync(filePath, "utf-8");

                // Replaces "/assets/" with "assets/" globally in JS/CSS/HTML
                const updatedContent = content.replace(/(["'])\/(assets|images|vectors|static)\//g, '$1$2/');

                if (content !== updatedContent) {
                    fs.writeFileSync(filePath, updatedContent, "utf-8");
                    console.log(`✨ Patched: ${file}`);
                }
            }
        });
    };

    patchAllAssets(buildDirPath);
    // This uploads the contents of buildDirPath to S3 under the /build/ prefix
    await uploadDirectoryToS3(
        buildDirPath,
        s3BaseKey
    );


    const buildUrl = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${s3BaseKey}/index.html`;

    /* -------------------- 11. DB transaction (OPTIMIZED) -------------------- */
    const newVersion = await prisma.$transaction(async (tx) => {
        await tx.projectVersion.updateMany({
            where: { projectId: release.project.id },
            data: { isActive: false }
        });

        const version = await tx.projectVersion.create({
            data: {
                projectId: release.project.id,
                releaseId,
                version: versionNumber,
                zipFilePath: zipPath,
                buildUrl,
                isActive: true,
                uploadedBy: userId,
                roadmapItems: {
                    connect: Array.isArray(roadmapItemIds) ? roadmapItemIds.map(id => ({ id: Number(id) })) : []
                }
            }
        });

        if (Array.isArray(roadmapItemIds) && roadmapItemIds.length) {
            await tx.roadmapItem.updateMany({
                where: { id: { in: roadmapItemIds.map(Number) } },
                data: {
                    releaseId,
                }
            });
        }

        return version;
    });

    /* -------------------- 12. Cleanup -------------------- */
    fs.removeSync(projectRoot);
    fs.removeSync(zipPath);

    /* -------------------- 13. Final response -------------------- */
    return {
        message: "✅ Release uploaded successfully",
        releaseId,
        versionId: newVersion.id,
        version: newVersion.version,
        buildUrl
    };
};


/**
 * Get release info for header display (generates lock token)
 */
export const getReleaseInfoService = async (releaseId) => {
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
        throw new ApiError(404, "Release not found");
    }

    // Generate a unique lock token for this release
    const lockToken = crypto.randomBytes(32).toString('hex');

    return {
        id: release.id,
        name: release.name,
        project: release.project,
        version: release.versions[0]?.version || "1.0.0",
        lastUpdated: release.versions[0]?.createdAt || null,
        locked: release.isLocked || false,
        lockToken: lockToken
    };
};

/**
 * Public lock/unlock a release
 */
export const publicLockReleaseService = async (releaseId, locked, token) => {
    // Validate required parameters
    if (typeof locked !== 'boolean') {
        throw new ApiError(400, "Invalid 'locked' parameter. Must be true or false.");
    }

    if (!token || typeof token !== 'string') {
        throw new ApiError(400, "Token is required for public lock operations.");
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
        throw new ApiError(404, "Release not found");
    }

    // For now, accept any token since we're generating unique tokens per request
    // In a production environment, you might want to implement token validation

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

    return {
        message: `Release ${locked ? 'locked' : 'unlocked'} successfully`,
        releaseId: updatedRelease.id,
        releaseName: updatedRelease.name,
        locked: updatedRelease.isLocked
    };
};

// services/releasePreview.service.ts

export const getReleasePreviewUrl = async (
    versionId,
    user
) => {
    const version = await prisma.projectVersion.findUnique({
        where: { id: versionId },
        include: {
            project: {
                select: {
                    assignedManagerId: true
                }
            }
        }
    });

    if (!version) {
        throw new ApiError(404, "Version not found");
    }

    const hasAccess =
        user.role === "admin" ||
        user.id === version.project.assignedManagerId;

    if (!hasAccess) {
        throw new ApiError(403, "Forbidden");
    }

    if (!version.buildUrl) {
        throw new ApiError(400, "Build not available");
    }

    return version.buildUrl;
};

