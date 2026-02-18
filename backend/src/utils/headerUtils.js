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

function generateHeader_old(type = 'project', data = {}) {
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
  .zip-sync-header-project-name { font-weight: 600; font-size: 16px; color: #2c3e50; }
  .zip-sync-header-version { font-size: 14px; color: #6c757d; }
  
  .zip-sync-lock-btn {
    background: #00B48B; border: none; color: white; padding: 10px 20px;
    border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;
    transition: all 0.2s ease; display: flex; align-items: center; gap: 8px;
    box-shadow: 0 2px 4px rgba(0, 180, 139, 0.2);
  }
  .zip-sync-lock-btn:hover { background: #218838; transform: translateY(-1px); }
  
  /* Locked State Style */
  .zip-sync-lock-btn.locked { 
    background: #6c757d; 
    cursor: not-allowed; 
    box-shadow: none;
    opacity: 0.8;
  }
  .zip-sync-lock-btn.locked:hover { transform: none; background: #6c757d; }
  
  .zip-sync-lock-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
  
  body { margin-top: 65px !important; }
  
  .zip-sync-lock-overlay {
    position: fixed; top: 65px; left: 0; right: 0; bottom: 0;
    background: rgba(44, 62, 80, 0.9); z-index: 9999;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: white; font-family: sans-serif; text-align: center;
    backdrop-filter: blur(5px); animation: fadeIn 0.3s ease;
    padding: 20px;
  }
  .overlay-title { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
  .overlay-msg { font-size: 16px; opacity: 0.9; }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  
  @media (max-width: 768px) {
    .zip-sync-header { padding: 0 16px; height: 60px; }
    body { margin-top: 60px !important; }
    .zip-sync-lock-overlay { top: 60px; }
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
      if (isLocked) return; // Prevention: button is disabled in UI anyway

      // 1. Warning Popup
      const label = headerType === 'release' ? 'release' : 'project';
      const confirmed = confirm(\`Are you sure you want to lock this \${label}? Once locked, editing will be disabled for everyone.\`);
      
      if (!confirmed) return;

      extractFromUrl();
      if (!releaseId) return alert("Release ID not found.");

      lockBtn.disabled = true;
      lockText.textContent = 'Locking...';

      try {
        const response = await fetch(\`\${getApiUrl()}/api/releases/\${releaseId}/public-lock\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            locked: true, // Always lock from this interface
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
          renderUI();
        }
      } catch (e) {
        alert("Failed to connect to API.");
        renderUI();
      }
    };

    function renderUI() {
      const label = headerType === 'release' ? 'Release' : 'Project';
      
      if (isLocked) {
        lockBtn.className = 'zip-sync-lock-btn locked';
        lockText.textContent = \`\${label} Locked\`;
        lockBtn.disabled = true;

        if (!document.getElementById('zip-sync-lock-overlay')) {
          const div = document.createElement('div');
          div.id = 'zip-sync-lock-overlay';
          div.className = 'zip-sync-lock-overlay';
          div.innerHTML = \`
            <div class="overlay-title">🔒 This \${label} is locked</div>
            <div class="overlay-msg">Please contact your PM to unlock it for further editing.</div>
          \`;
          document.body.appendChild(div);
        }
      } else {
        lockBtn.className = 'zip-sync-lock-btn';
        lockText.textContent = \`Lock \${label}\`;
        lockBtn.disabled = false;
        const existingOverlay = document.getElementById('zip-sync-lock-overlay');
        if (existingOverlay) existingOverlay.remove();
      }
    }

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

function generateHeader(type = 'project', data = {}) {
  // Safe extraction of baseUrl
  const baseUrl = data.apiUrl || "http://localhost:5000";
  console.log('inside', data)
  // Safe values for injection into the script block
  const projectIdInjection = JSON.stringify(data.projectId || null);
  const releaseIdInjection = JSON.stringify(data.releaseId || null);
  const versionInjection = JSON.stringify(data.version || "1.0.0");
  const projectNameInjection = JSON.stringify(data.releaseName || "Loading...");
  const headerType = JSON.stringify(type);
  const injectedApiUrl = JSON.stringify(baseUrl.replace(/\/$/, ''));

  return `
<style>
  .zip-sync-header {
    position: fixed; top: 0; left: 0; right: 0; height: 70px;
    background: #00B48B; color: #ffffff; display: flex;
    align-items: center; justify-content: space-between;
    padding: 0 24px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  }

  /* Center Container for Name and Version */
  .zip-sync-header-center {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .zip-sync-header-project-name { 
    font-weight: 800; 
    font-size: 18px; 
    color: #ffffff;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.2;
  }

  .zip-sync-header-version { 
    font-size: 12px; 
    color: rgba(255, 255, 255, 0.9);
    background: rgba(0, 0, 0, 0.1);
    padding: 2px 8px;
    border-radius: 10px;
    display: inline-block;
    width: fit-content;
    margin: 2px auto 0;
  }
  
  .zip-sync-lock-btn {
    background: #ffffff; border: none; color: #00B48B; padding: 8px 18px;
    border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 700;
    transition: all 0.2s ease; display: flex; align-items: center; gap: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
  .zip-sync-lock-btn:hover { background: #f8f9fa; transform: translateY(-1px); }
  
  .zip-sync-lock-btn.locked { 
    background: rgba(255, 255, 255, 0.2); 
    color: #ffffff;
    cursor: not-allowed; 
    border: 1px solid rgba(255, 255, 255, 0.5);
  }
  
  body { margin-top: 70px !important; }
  
  .zip-sync-lock-overlay {
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
    .zip-sync-header-project-name { font-size: 14px; }
    .zip-sync-lock-btn { padding: 6px 12px; font-size: 11px; }
  }
</style>

<div class="zip-sync-header" id="zip-sync-header">
  <div class="zip-sync-header-left">
     <div style="font-weight: 900; font-size: 20px;"></div>
  </div>

  <div class="zip-sync-header-center">
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

      extractFromUrl();
      if (!releaseId) return alert("Error: Release ID missing.");

      lockBtn.disabled = true;
      lockText.textContent = 'Locking...';

      try {
        const response = await fetch(\`\${getApiUrl()}/api/releases/\${releaseId}/public-lock\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locked: true, token: window.zipSyncLockToken })
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
        lockBtn.className = 'zip-sync-lock-btn locked';
        lockText.textContent = \`\${label} Locked\`;
        lockBtn.disabled = true;

        if (!document.getElementById('zip-sync-lock-overlay')) {
          const div = document.createElement('div');
          div.id = 'zip-sync-lock-overlay';
          div.className = 'zip-sync-lock-overlay';
          div.innerHTML = \`
            <div class="overlay-title">🔒 Project Locked</div>
            <div class="overlay-msg">This \${label.toLowerCase()} has been secured. Please contact your Project Manager to request an unlock.</div>
          \`;
          document.body.appendChild(div);
        }
      } else {
        lockBtn.className = 'zip-sync-lock-btn';
        lockText.textContent = \`Lock \${label}\`;
        lockBtn.disabled = false;
        const existingOverlay = document.getElementById('zip-sync-lock-overlay');
        if (existingOverlay) existingOverlay.remove();
      }
    }

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