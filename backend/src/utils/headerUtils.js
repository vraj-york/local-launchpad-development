// Header utility functions for project injection
import dotenv from "dotenv";
import config from "../config/index.js";
import { json } from "express";
dotenv.config();

// Generate project header component HTML with improved design matching main.css
export function generateProjectHeader() {
  return generateHeader('project');
}

// Generate release header component HTML with improved design matching main.css
export function generateReleaseHeader(data = {}) {
  return generateHeader('release', data);
}


function generateHeader(type = 'project', data = {}) {
  // Safe extraction of baseUrl
  const baseUrl = data.apiUrl || "http://localhost:5000";
  // Safe values for injection into the script block
  const projectIdInjection = JSON.stringify(data.projectId || null);
  const releaseIdInjection = JSON.stringify(data.releaseId || null);
  const versionInjection = JSON.stringify(data.version || "1.0.0");
  const projectNameInjection = JSON.stringify(data.releaseName || "Loading...");
  const headerType = JSON.stringify(type);
  const injectedApiUrl = JSON.stringify(baseUrl.replace(/\/$/, ''));

  return `
<style>
  .launchpad-header {
    position: fixed; top: 0; left: 0; right: 0; height: 70px;
    background: #00B48B; color: #ffffff; display: flex;
    align-items: center; justify-content: space-between;
    padding: 0 24px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  }

  /* Center Container for Name and Version */
  .launchpad-header-center {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .launchpad-header-project-name { 
    font-weight: 800; 
    font-size: 18px; 
    color: #ffffff;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.2;
  }

  .launchpad-header-version { 
    font-size: 12px; 
    color: rgba(255, 255, 255, 0.9);
    background: rgba(0, 0, 0, 0.1);
    padding: 2px 8px;
    border-radius: 10px;
    display: inline-block;
    width: fit-content;
    margin: 2px auto 0;
  }
  
  .launchpad-lock-btn {
    background: #ffffff; border: none; color: #00B48B; padding: 8px 18px;
    border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 700;
    transition: all 0.2s ease; display: flex; align-items: center; gap: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
  .launchpad-lock-btn:hover { background: #f8f9fa; transform: translateY(-1px); }
  
  .launchpad-lock-btn.locked { 
    background: rgba(255, 255, 255, 0.2); 
    color: #ffffff;
    cursor: not-allowed; 
    border: 1px solid rgba(255, 255, 255, 0.5);
  }
  
  body { margin-top: 70px !important; }
  
  .launchpad-lock-overlay {
    position: fixed; top: 70px; left: 0; right: 0; bottom: 0;
    background: rgba(23, 42, 58, 0.95); z-index: 9999;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: white; font-family: sans-serif; text-align: center;
    backdrop-filter: blur(8px); animation: fadeIn 0.3s ease;
  }
  .overlay-title { font-size: 26px; font-weight: 700; margin-bottom: 12px; color: #ffffff; }
  .overlay-msg { font-size: 16px; color: rgba(255, 255, 255, 0.8); max-width: 400px; }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  
  @media (max-width: 768px) {
    .launchpad-header-project-name { font-size: 14px; }
    .launchpad-lock-btn { padding: 6px 12px; font-size: 11px; }
  }
</style>

<div class="launchpad-header" id="launchpad-header">
  <div class="launchpad-header-left">
     <div style="font-weight: 900; font-size: 20px;"></div>
  </div>

  <div class="launchpad-header-center">
    <span class="launchpad-header-project-name" id="launchpad-project-name">Loading...</span>
    <span class="launchpad-header-version" id="launchpad-project-version">v0.0.0</span>
  </div>

  <button class="launchpad-lock-btn" id="launchpad-lock-btn">
    <span id="lock-btn-text">Lock Project</span>
  </button>
</div>

<script>
  (function() {
    let isLocked = false;
    let projectId = ${projectIdInjection};
    let releaseId = ${releaseIdInjection};
    let version = ${versionInjection};
    let projectName = ${projectNameInjection};
    let apiBase = ${injectedApiUrl};
    let headerType = ${headerType};

    const lockBtn = document.getElementById('launchpad-lock-btn');
    const lockText = document.getElementById('lock-btn-text');

    function extractFromUrl() {
      const path = window.location.pathname;
      const projectMatch = path.match(/\\/projects\\/([^/]+)/);
      const releaseMatch = path.match(/\\/releases\\/([^/]+)/);
      if (!projectId && projectMatch) projectId = projectMatch[1];
      if (!releaseId && releaseMatch) releaseId = releaseMatch[1];
    }

    function getApiUrl() {
      return apiBase || "http://localhost:5000";
    }

    window.toggleProjectLock = async function() {
      if (isLocked) return;

      const label = headerType === 'release' ? 'release' : 'project';
      const confirmed = confirm(\`IMPORTANT: Are you sure you want to lock this \${label}? This action will finalize the version and restrict all further edits.\`);
      
      if (!confirmed) return;

      const lockEmail = window.prompt('Enter your email to confirm lock:');
      if (!lockEmail || !String(lockEmail).trim()) {
        return;
      }

      extractFromUrl();
      if (!releaseId) return alert("Error: Release ID missing.");

      lockBtn.disabled = true;
      lockText.textContent = 'Locking...';

      try {
        const response = await fetch(\`\${getApiUrl()}/api/releases/\${releaseId}/public-lock\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockedBy: String(lockEmail).trim().toLowerCase() })
        });

        if (response.ok) {
          const result = await response.json();
          isLocked = result.locked;
          renderUI();
        } else {
          const err = await response.json().catch(() => ({}));
          alert("Error: " + (err.error || "Server error"));
          renderUI();
        }
      } catch (e) {
        alert("Connection failed.");
        renderUI();
      }
    };

    function renderUI() {
      const label = headerType === 'release' ? 'Release' : 'Project';
      
      if (isLocked) {
        lockBtn.className = 'launchpad-lock-btn locked';
        lockText.textContent = \`\${label} Locked\`;
        lockBtn.disabled = true;

        if (!document.getElementById('launchpad-lock-overlay')) {
          const div = document.createElement('div');
          div.id = 'launchpad-lock-overlay';
          div.className = 'launchpad-lock-overlay';
          div.innerHTML = \`
            <div class="overlay-title">🔒 Project Locked</div>
            <div class="overlay-msg">This \${label.toLowerCase()} has been secured. Please contact your Project Manager if you need further changes.</div>
          \`;
          document.body.appendChild(div);
        }
      } else {
        lockBtn.className = 'launchpad-lock-btn';
        lockText.textContent = \`Lock \${label}\`;
        lockBtn.disabled = false;
        const existingOverlay = document.getElementById('launchpad-lock-overlay');
        if (existingOverlay) existingOverlay.remove();
      }
    }

    async function init() {
      extractFromUrl();
      document.getElementById('launchpad-project-name').textContent = projectName;
      document.getElementById('launchpad-project-version').textContent = 'v' + version;

      if (releaseId) {
        try {
          const res = await fetch(\`\${getApiUrl()}/api/releases/\${releaseId}/info\`);
          if (res.ok) {
            const info = await res.json();
            isLocked = info.locked;
            renderUI();
          }
        } catch (e) { console.warn("API Offline"); }
      }
    }

    lockBtn.addEventListener('click', window.toggleProjectLock);
    init();
  })();
</script>`;
}