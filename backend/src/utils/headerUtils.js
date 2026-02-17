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
  const projectNameInjection = JSON.stringify(data.projectName || "Loading...");
  const headerType = JSON.stringify(type);
  const injectedApiUrl = JSON.stringify(baseUrl.replace(/\/$/, ''));

  return `
<style>
  /* Keeping your original styles exactly as provided */
  .zip-sync-header {
    position: fixed; top: 0; left: 0; right: 0; height: 65px;
    background: #ffffff; color: #2c3e50; display: flex;
    align-items: center; justify-content: space-between;
    padding: 0 24px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    border-bottom: 1px solid #e9ecef; z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    font-size: 14px; line-height: 1.6;
  }
  .zip-sync-header-left { display: flex; align-items: center; gap: 20px; }
  .zip-sync-header-info { display: flex; align-items: center; gap: 10px; }
  .zip-sync-header-project-name { font-weight: 600; font-size: 16px; color: #2c3e50; }
  .zip-sync-header-version { font-size: 14px; color: #6c757d; }
  .zip-sync-lock-btn {
    background: #00B48B; border: none; color: white; padding: 10px 20px;
    border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;
    transition: all 0.2s ease; display: flex; align-items: center; gap: 8px;
    box-shadow: 0 2px 4px rgba(0, 180, 139, 0.2);
  }
  .zip-sync-lock-btn:hover { background: #218838; transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0, 180, 139, 0.3); }
  .zip-sync-lock-btn.locked { background: #dc3545; box-shadow: 0 2px 4px rgba(220, 53, 69, 0.2); }
  .zip-sync-lock-btn.locked:hover { background: #c82333; box-shadow: 0 4px 8px rgba(220, 53, 69, 0.3); }
  .zip-sync-lock-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
  body { margin-top: 65px !important; }
  body[style*="margin-top"] { margin-top: 65px !important; }
  .zip-sync-lock-overlay {
    position: fixed; top: 65px; left: 0; right: 0; bottom: 0;
    background: rgba(44, 62, 80, 0.8); z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    color: white; font-family: sans-serif; font-size: 20px; font-weight: 600;
    backdrop-filter: blur(4px); animation: fadeIn 0.3s ease;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @media (max-width: 768px) {
    .zip-sync-header { padding: 0 16px; height: 60px; }
    .zip-sync-header-project-name { font-size: 14px; }
    .zip-sync-lock-btn { padding: 8px 16px; font-size: 13px; }
    body { margin-top: 60px !important; }
    .zip-sync-lock-overlay { top: 60px; font-size: 18px; }
  }
</style>

<div class="zip-sync-header" id="zip-sync-header">
  <div class="zip-sync-header-left">
    <span class="zip-sync-header-project-name" id="zip-sync-project-name">Loading...</span>
    <span class="zip-sync-header-version" id="zip-sync-project-version">v0.0.0</span>
  </div>
  <button class="zip-sync-lock-btn" id="zip-sync-lock-btn">
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

    const lockBtn = document.getElementById('zip-sync-lock-btn');
    const lockText = document.getElementById('lock-btn-text');

    // 1. Updated Extraction for S3 URL patterns
    function extractFromUrl() {
      const path = window.location.pathname;
      // Matches /projects/{id}/releases/{id}/
      const projectMatch = path.match(/\\/projects\\/([^/]+)/);
      const releaseMatch = path.match(/\\/releases\\/([^/]+)/);
      
      if (!projectId && projectMatch) projectId = projectMatch[1];
      if (!releaseId && releaseMatch) releaseId = releaseMatch[1];
    }

    function getApiUrl() {
      // Always prioritize the injected API URL for S3 hosted files
      return apiBase || "http://localhost:5000";
    }

    // 2. Lock Toggle Function
    window.toggleProjectLock = async function() {
      extractFromUrl();
      if (!releaseId) return alert("Release ID not found in URL.");

      lockBtn.disabled = true;
      lockText.textContent = 'Processing...';

      try {
        const response = await fetch(\`\${getApiUrl()}/api/releases/\${releaseId}/public-lock\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            locked: !isLocked, 
            token: window.zipSyncLockToken 
          })
        });

        if (response.ok) {
          const result = await response.json();
          isLocked = result.locked;
          renderUI();
        } else {
          const err = await response.json().catch(() => ({}));
          alert("Error: " + (err.error || "Server error"));
        }
      } catch (e) {
        alert("Failed to connect to API at " + getApiUrl());
      } finally {
        lockBtn.disabled = false;
      }
    };

    function renderUI() {
      const label = headerType === 'release' ? 'Release' : 'Project';
      lockBtn.className = isLocked ? 'zip-sync-lock-btn locked' : 'zip-sync-lock-btn';
      lockText.textContent = isLocked ? \`Unlock \${label}\` : \`Lock \${label}\`;

      const existingOverlay = document.getElementById('zip-sync-lock-overlay');
      if (isLocked && !existingOverlay) {
        const div = document.createElement('div');
        div.id = 'zip-sync-lock-overlay';
        div.className = 'zip-sync-lock-overlay';
        div.innerHTML = '🔒 Project is locked for editing';
        document.body.appendChild(div);
      } else if (!isLocked && existingOverlay) {
        existingOverlay.remove();
      }
    }

    // 3. Initialize
    async function init() {
      extractFromUrl();
      document.getElementById('zip-sync-project-name').textContent = projectName;
      document.getElementById('zip-sync-project-version').textContent = 'v' + version;

      if (releaseId) {
        try {
          const res = await fetch(\`\${getApiUrl()}/api/releases/\${releaseId}/info\`);
          if (res.ok) {
            const info = await res.json();
            isLocked = info.locked;
            window.zipSyncLockToken = info.lockToken;
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