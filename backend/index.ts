import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs-extra";
import extract from "extract-zip";
import { exec } from "child_process";
import cors from "cors";

const app = express();
const PORT = 4000;

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  })
);
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// utility functions as before...

async function listFilesRecursive(dir: string, prefix = ""): Promise<void> {
  const entries = await fs.readdir(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = await fs.stat(fullPath);
    // You can log the file/folder here if needed
    if (stat.isDirectory()) {
      await listFilesRecursive(fullPath, prefix + "  ");
    }
  }
}

async function findPackageJson(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      const nested = await findPackageJson(fullPath);
      if (nested) return nested;
    } else if (entry === "package.json") {
      return fullPath;
    }
  }
  return null;
}

async function folderExists(folderPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(folderPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

app.post("/upload", upload.single("project"), async (req, res) => {
  if (!req.file) {
    console.error("[UPLOAD] ❌ No file uploaded");
    return res.status(400).send("No file uploaded");
  }
  const uploadPath = path.resolve(req.file.path);
  const extractPath = path.resolve("projects", Date.now().toString());
  console.log(`[UPLOAD] 📂 File received: ${req.file.originalname}`);
  console.log(`[UPLOAD] Temporary path: ${uploadPath}`);
  console.log(`[UPLOAD] Extracting to: ${extractPath}`);
  await fs.ensureDir(extractPath);

  try {
    console.log("[UNZIP] 🔄 Starting extraction with extract-zip...");
    await extract(uploadPath, { dir: extractPath });
    console.log("[UNZIP] ✅ Extraction completed");
  } catch (err) {
    console.error("[UNZIP] ❌ Extraction failed:", err);
    return res.status(500).send("Failed to extract project");
  }

  console.log("[INSPECT] 📂 Listing extracted contents:");
  await listFilesRecursive(extractPath);

  console.log("[DETECT] 🔍 Searching for package.json...");
  const pkgPath = await findPackageJson(extractPath);
  if (!pkgPath) {
    console.error("[DETECT] ❌ No package.json found in project");
    return res.status(400).send("Invalid project: no package.json found");
  }
  const projectRoot = path.dirname(pkgPath);
  console.log(`[DETECT] 📦 Found package.json at: ${pkgPath}`);
  console.log(`[DETECT] 📁 Project root set to: ${projectRoot}`);

  let pkgJsonContent;
  try {
    pkgJsonContent = await fs.readJson(pkgPath);
  } catch (err) {
    console.error("[PACKAGE.JSON] ❌ Failed to read package.json:", err);
  }

  // Detect build folder dynamically ('dist' for Vite, 'build' for CRA/etc)
  const distFolder = path.join(projectRoot, "dist");
  const buildFolder = path.join(projectRoot, "build");
  let staticFolder = "";
  if (await folderExists(distFolder)) {
    staticFolder = distFolder;
  } else if (await folderExists(buildFolder)) {
    staticFolder = buildFolder;
  } else {
    console.warn("[BUILD] ⚠️ No 'dist' or 'build' folder found after build.");
  }

  // Detect if npm run start or npm run preview exists
  const scripts = pkgJsonContent?.scripts || {};
  let startCommand = "";
  if (scripts.start) {
    startCommand = "start";
  } else if (scripts.preview) {
    startCommand = "preview";
  } else if (scripts.dev) {
    // fallback to dev if present
    startCommand = "dev";
  } else {
    // fallback to build only
    startCommand = "";
  }

  // Compose install + build + run command dynamically
  const runCommands = [`npm install`, `npm run build`];
  if (startCommand) {
    runCommands.push(`npm run ${startCommand}`);
  }
  const fullCommand = runCommands.join(" && ");

  console.log("[BUILD] 🔄 Installing dependencies and running project...");
  exec(`cd "${projectRoot}" && ${fullCommand}`, (err, stdout, stderr) => {
    if (err) {
      console.error("[BUILD] ❌ Build or run failed");
      console.error(stderr);
      return res.status(500).json({
        success: false,
        message: "Build or run failed",
        logs: stdout + "\n" + stderr,
      });
    }
    console.log("[BUILD] ✅ Build and run completed successfully");
    console.log("[BUILD] Logs:\n", stdout);
    if (staticFolder) {
      console.log(`[SERVE] 🚀 Serving static files from: ${staticFolder}`);
      app.use(
        `/preview/${path.basename(extractPath)}`,
        express.static(staticFolder)
      );
      const previewUrl = `/preview/${path.basename(extractPath)}`;
      console.log(`[SERVE] 🌍 Preview available at: ${previewUrl}`);
      return res.json({
        success: true,
        previewUrl,
        logs: stdout,
      });
    } else {
      // If no static folder, just respond with logs
      return res.json({
        success: true,
        logs: stdout,
        message: "Project started but no static folder could be served",
      });
    }
  });
});

app.listen(PORT, () => {
  console.log(`⚡ Backend running at http://localhost:${PORT}`);
});
