import express from "express";
import multer from "multer";
import { exec } from "child_process";
import path from "path";
import fs from "fs-extra";
import extract from "extract-zip"; // ✅ use extract-zip
import cors from "cors";

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "backend/uploads/" });

app.post("/upload", upload.single("project"), async (req, res) => {
  try {
    const projectId = Date.now().toString();
    const projectPath = path.join("backend/projects", projectId);

    // Ensure folder exists
    await fs.ensureDir(path.resolve(projectPath));

    // ✅ Extract ZIP into project folder using absolute paths
    await extract(path.resolve(req.file.path), {
      dir: path.resolve(projectPath)
    });

    // Detect actual project folder (where package.json exists)
    let actualProjectPath = path.resolve(projectPath);
    const pkgPath = path.join(actualProjectPath, "package.json");
    const dirs = await fs.readdir(actualProjectPath);

    if (!(await fs.pathExists(pkgPath)) && dirs.length === 1) {
      actualProjectPath = path.join(actualProjectPath, dirs[0]);
    }

    // Run install & build inside the right folder
    exec(`cd ${actualProjectPath} && npm install && npm run build`, async (err, stdout, stderr) => {
      if (err) {
        console.error(stderr);
        return res.status(500).json({ error: "Build failed", details: stderr });
      }
      console.log(stdout);

      // Detect actual build output (CRA = build, Vite default = dist, custom possible)
      let outputDir = null;
      if (await fs.pathExists(path.join(actualProjectPath, "build"))) {
        outputDir = "build";
      } else if (await fs.pathExists(path.join(actualProjectPath, "dist"))) {
        outputDir = "dist";
      }

      if (!outputDir) {
        return res.status(500).json({ error: "No build output found" });
      }

      // ✅ Patch index.html to fix absolute /assets → relative ./assets
      const indexPath = path.join(actualProjectPath, outputDir, "index.html");
      if (await fs.pathExists(indexPath)) {
        let html = await fs.readFile(indexPath, "utf-8");
        html = html.replace(/"\/assets\//g, '"./assets/');
        await fs.writeFile(indexPath, html);
      }

      return res.json({
        url: `http://localhost:${PORT}/apps/${projectId}/${outputDir}`
      });
    });



  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Upload failed", details: error.message });
  }
});


// Serve built apps
app.use("/apps", express.static(path.join("backend/projects")));

app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});
