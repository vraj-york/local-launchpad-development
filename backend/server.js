import express from "express";
import multer from "multer";
import { exec } from "child_process";
import path from "path";
import fs from "fs-extra";
import extract from "extract-zip"; // ✅ use extract-zip
import cors from "cors";

const app = express();
const PORT = 5001;

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

    // Run install & build inside the right folder
exec(`cd ${actualProjectPath} && npm install && npm run build`, async (err, stdout, stderr) => {
  if (err) {
    console.error(stderr);
    return res.status(500).json({ error: "Build failed", details: stderr });
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
    path.join(actualProjectPath, outputDir)
  );

  return res.json({
    url: `http://localhost:${PORT}/apps/${relativeBuildPath}`
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
