import express from "express";
import multer from "multer";
import { exec } from "child_process";
import path from "path";
import fs from "fs-extra";
import extract from "extract-zip"; // ✅ use extract-zip
import cors from "cors";
import { getFeedbackWidgetScript } from "./src/utils/feedbackWidgetInjection.js";

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
      dir: path.resolve(projectPath),
    });

    // Detect actual project folder (where package.json exists)
    let actualProjectPath = path.resolve(projectPath);
    const pkgPath = path.join(actualProjectPath, "package.json");
    const dirs = await fs.readdir(actualProjectPath);

    if (!(await fs.pathExists(pkgPath)) && dirs.length === 1) {
      actualProjectPath = path.join(actualProjectPath, dirs[0]);
    }

    // Find and inject Marker.io script into root HTML file
    const htmlFiles = ["index.html", "public/index.html", "src/index.html"];
    let rootHtmlPath = null;

    for (const htmlFile of htmlFiles) {
      const potentialPath = path.join(actualProjectPath, htmlFile);
      if (await fs.pathExists(potentialPath)) {
        rootHtmlPath = potentialPath;
        break;
      }
    }

    const apiUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    console.log(
      "[feedback-widget] Using API URL for injection:",
      apiUrl,
      "| projectId:",
      projectId,
    );
    const feedbackWidgetScript = getFeedbackWidgetScript(apiUrl, projectId);

    if (rootHtmlPath) {
      try {
        let htmlContent = await fs.readFile(rootHtmlPath, "utf-8");

        if (!htmlContent.includes("feedback-widget.min.js")) {
          if (htmlContent.includes("</head>")) {
            htmlContent = htmlContent.replace(
              "</head>",
              `${feedbackWidgetScript}\n</head>`,
            );
          } else if (htmlContent.includes("<head>")) {
            htmlContent = htmlContent.replace(
              "<head>",
              `<head>\n${feedbackWidgetScript}`,
            );
          } else {
            if (htmlContent.includes("<body>")) {
              htmlContent = htmlContent.replace(
                "<body>",
                `<head>\n${feedbackWidgetScript}\n</head>\n<body>`,
              );
            } else if (htmlContent.includes("<html>")) {
              htmlContent = htmlContent.replace(
                "<html>",
                `<html>\n<head>\n${feedbackWidgetScript}\n</head>`,
              );
            }
          }
          await fs.writeFile(rootHtmlPath, htmlContent, "utf-8");
          console.log("✅ Feedback widget script injected into:", rootHtmlPath);
        } else {
          console.log(
            "ℹ️  Feedback widget script already present in:",
            rootHtmlPath,
          );
        }
      } catch (error) {
        console.error(
          "❌ Error injecting feedback widget script:",
          error.message,
        );
      }
    } else {
      console.log(
        "⚠️  No root HTML file found to inject feedback widget script",
      );
    }

    // Run install & build inside the right folder
    exec(
      `cd ${actualProjectPath} && npm install && npm run build`,
      async (err, stdout, stderr) => {
        if (err) {
          console.error(stderr);
          return res
            .status(500)
            .json({ error: "Build failed", details: stderr });
        }
        console.log(stdout);

        // Detect build output dir relative to actualProjectPath
        let outputDir = null;
        if (await fs.pathExists(path.join(actualProjectPath, "build"))) {
          outputDir = "build";
        } else if (await fs.pathExists(path.join(actualProjectPath, "dist"))) {
          outputDir = "dist";
        }

        if (!outputDir) {
          return res.status(500).json({ error: "No build output found" });
        }

        // ✅ Patch index.html to fix asset paths
        const indexPath = path.join(actualProjectPath, outputDir, "index.html");
        if (await fs.pathExists(indexPath)) {
          let html = await fs.readFile(indexPath, "utf-8");
          html = html.replace(/"\/assets\//g, '"./assets/');
          await fs.writeFile(indexPath, html);
        }

        // ✅ Calculate correct relative URL
        const relativeBuildPath = path.relative(
          path.resolve("backend/projects"),
          path.join(actualProjectPath, outputDir),
        );

        return res.json({
          url: `http://localhost:${PORT}/apps/${relativeBuildPath}`,
        });
      },
    );
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
