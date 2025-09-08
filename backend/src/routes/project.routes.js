import express from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.middleware.js";
import multer from "multer";
import path from "path";
import fs from "fs-extra";
import extract from "extract-zip";
import { exec } from "child_process";

const router = express.Router();
const prisma = new PrismaClient();

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

  // Extract zip to project folder
  const projectFolder = path.join(process.cwd(), "projects", String(projectId));
  await fs.ensureDir(projectFolder);
  await extract(req.file.path, { dir: projectFolder });

  // Detect actual project folder (where package.json exists)
  let actualProjectPath = projectFolder;
  const pkgPath = path.join(actualProjectPath, "package.json");
  const dirs = await fs.readdir(actualProjectPath);
  if (!(await fs.pathExists(pkgPath)) && dirs.length === 1) {
    actualProjectPath = path.join(actualProjectPath, dirs[0]);
  }

  // Find and inject Marker.io script into root HTML file
    const htmlFiles = ['index.html', 'public/index.html', 'src/index.html'];
    let rootHtmlPath = null;
    
    for (const htmlFile of htmlFiles) {
      const potentialPath = path.join(actualProjectPath, htmlFile);
      if (await fs.pathExists(potentialPath)) {
        rootHtmlPath = potentialPath;
        break;
      }
    }

    if (rootHtmlPath) {
      try {
        let htmlContent = await fs.readFile(rootHtmlPath, 'utf-8');
        
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
          
          await fs.writeFile(rootHtmlPath, htmlContent, 'utf-8');
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

  // Run npm install and build
  exec(`cd ${actualProjectPath} && npm install && npm run build`, async (err, stdout, stderr) => {
    if (err) {
      console.error(stderr);
      return res.status(500).json({ error: "Build failed", details: stderr });
    }

    // Detect build output dir
    let outputDir = null;
    if (await fs.pathExists(path.join(actualProjectPath, "build"))) {
      outputDir = "build";
    } else if (await fs.pathExists(path.join(actualProjectPath, "dist"))) {
      outputDir = "dist";
    }

    if (!outputDir) {
      return res.status(500).json({ error: "No build output found" });
    }

    // Patch index.html asset paths (optional)
    const indexPath = path.join(actualProjectPath, outputDir, "index.html");
    if (await fs.pathExists(indexPath)) {
      let html = await fs.readFile(indexPath, "utf-8");
      html = html.replace(/"\/assets\//g, '"./assets/');
      await fs.writeFile(indexPath, html);
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

    res.json({ 
      message: "Zip uploaded and built", 
      buildUrl,
      version: newVersion
    });
  });
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

export default router;