// Header utility functions for project injection
import dotenv from "dotenv";
import config from "../config/index.js";
dotenv.config();

// Generate project header component HTML with improved design matching main.css
export function generateProjectHeader() {
  return generateHeader('project');
}

// Generate release header component HTML with improved design matching main.css
export function generateReleaseHeader() {
  return generateHeader('release');
}

// Generate header component HTML with improved design matching main.css
function generateHeader(type = 'project') {
  const baseUrl = config.BASE_URL;
  return `
<style>
  .zip-sync-header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 65px;
    background: #ffffff;
    color: #2c3e50;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    border-bottom: 1px solid #e9ecef;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    font-size: 14px;
    line-height: 1.6;
  }
  
  .zip-sync-header-left {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  
  .zip-sync-header-logo {
    font-weight: 600;
    font-size: 18px;
    color: #00B48B;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .zip-sync-header-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  
  .zip-sync-header-project-name {
    font-weight: 600;
    font-size: 16px;
    color: #2c3e50;
  }
  
  .zip-sync-header-version {
    font-size: 14px;
    color: #6c757d;
  }
  
  .zip-sync-lock-btn {
    background: #00B48B;
    border: none;
    color: white;
    padding: 10px 20px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 2px 4px rgba(0, 180, 139, 0.2);
  }
  
  .zip-sync-lock-btn:hover {
    background: #218838;
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(0, 180, 139, 0.3);
  }
  
  .zip-sync-lock-btn.locked {
    background: #dc3545;
    box-shadow: 0 2px 4px rgba(220, 53, 69, 0.2);
  }
  
  .zip-sync-lock-btn.locked:hover {
    background: #c82333;
    box-shadow: 0 4px 8px rgba(220, 53, 69, 0.3);
  }
  
  .zip-sync-lock-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
  
  .zip-sync-lock-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
  
  /* Add top margin to body to account for fixed header */
  body {
    margin-top: 65px !important;
  }
  
  /* Override any existing body margin-top */
  body[style*="margin-top"] {
    margin-top: 65px !important;
  }
  
  /* Lock overlay styles */
  .zip-sync-lock-overlay {
    position: fixed;
    top: 65px;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(44, 62, 80, 0.8);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
    font-size: 20px;
    font-weight: 600;
    backdrop-filter: blur(4px);
    animation: fadeIn 0.3s ease;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  /* Mobile responsive */
  @media (max-width: 768px) {
    .zip-sync-header {
      padding: 0 16px;
      height: 60px;
    }
    
    .zip-sync-header-left {
      gap: 12px;
    }
    
    .zip-sync-header-logo {
      font-size: 16px;
    }
    
    .zip-sync-header-project-name {
      font-size: 14px;
    }
    
    .zip-sync-lock-btn {
      padding: 8px 16px;
      font-size: 13px;
    }
    
    body {
      margin-top: 60px !important;
    }
    
    .zip-sync-lock-overlay {
      top: 60px;
      font-size: 18px;
    }
  }
</style>

<div class="zip-sync-header" id="zip-sync-header">
  <div class="zip-sync-header-left">
    <div class="zip-sync-header-info">
      <div class="zip-sync-header-project-name" id="zip-sync-project-name">Loading...</div>
      <div class="zip-sync-header-version" id="zip-sync-project-version">v0.0.0</div>
    </div>
  </div>
  <button class="zip-sync-lock-btn" id="zip-sync-lock-btn" onclick="toggleProjectLock()">
    <!-- <svg class="zip-sync-lock-icon" fill="currentColor" viewBox="0 0 20 20">
      <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 616 0z" clip-rule="evenodd"></path>
     </svg> -->
    <span id="lock-btn-text">Lock Project</span>
  </button>
</div>

<script>
  // ZipSync Header functionality
  (function() {
    let isLocked = false;
    let projectId = null;
    let releaseId = null;
    let headerType = '${type}';
    
    // Extract project ID from URL
    function extractProjectId() {
      const currentUrl = window.location.href;
      console.log('🔍 Extracting project ID from URL:', currentUrl);
      
      // Pattern 1: /apps/projectId/build/ or /apps/projectId/dist/
      const appsMatch = currentUrl.match(/\\/apps\\/([^/]+)\\/(?:build|dist)\\//);
      if (appsMatch) {
        return appsMatch[1];
      }
      
      // Pattern 2: Look for project ID in the path
      const pathParts = window.location.pathname.split('/');
      const projectIndex = pathParts.findIndex(part => part === 'apps' || part === 'projects');
      if (projectIndex >= 0 && pathParts[projectIndex + 1]) {
        return pathParts[projectIndex + 1];
      }
      
      return null;
    }
    
    // Extract release ID from URL (if available)
    function extractReleaseId() {
      const currentUrl = window.location.href;
      console.log('🔍 Extracting release ID from URL:', currentUrl);
      
      // Look for release ID in query params or path
      const urlParams = new URLSearchParams(window.location.search);
      const releaseIdParam = urlParams.get('releaseId');
      if (releaseIdParam) {
        return releaseIdParam;
      }
      
      // Pattern: /apps/projectId/build/?releaseId=123
      const releaseMatch = currentUrl.match(/releaseId=([^&]+)/);
      if (releaseMatch) {
        return releaseMatch[1];
      }
      
      return null;
    }
    
    // Get API base URL
    function getApiBaseUrl() {
      const currentUrl = window.location.href;
      console.log('🔍 Determining API base URL from:', currentUrl);
      if (currentUrl.includes('localhost') || currentUrl.includes('43.205.121.85')) {
        return '${baseUrl}';
      } else {
        const urlObj = new URL(currentUrl);
        return \`\${urlObj.protocol}//\${urlObj.hostname}:5000\`;
      }
    }
    
    // Toggle project/release lock with API call
    window.toggleProjectLock = async function() {
      if (!projectId) {
        console.warn('No project ID available for lock toggle');
        return;
      }
      
      const lockBtn = document.getElementById('zip-sync-lock-btn');
      const lockText = document.getElementById('lock-btn-text');
      
      // Disable button during API call
      lockBtn.disabled = true;
      lockText.textContent = 'Processing...';
      
      try {
        let apiUrl;
        let requestBody;
        
        if (headerType === 'release' && releaseId) {
          // For releases, use the public endpoint with token
          apiUrl = \`\${getApiBaseUrl()}/api/releases/\${releaseId}/public-lock\`;
          requestBody = { 
            locked: !isLocked,
            token: window.zipSyncLockToken 
          };
        } else {
          // For projects, show error since project locking is not supported
          alert('Project locking is not available. Please use release locking instead.');
          return;
        }
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });
        
        if (response.ok) {
          const result = await response.json();
          isLocked = result.locked;
          updateLockUI();
          const entityType = headerType === 'release' ? 'Release' : 'Project';
          console.log(\`✅ \${entityType} lock status updated:\`, isLocked ? 'Locked' : 'Unlocked');
        } else {
          console.error('❌ Failed to update lock status:', response.status);
          const errorData = await response.json().catch(() => ({}));
          const entityType = headerType === 'release' ? 'release' : 'project';
          alert(\`Failed to update \${entityType} lock status: \${errorData.error || 'Unknown error'}\`);
        }
      } catch (error) {
        console.error('❌ Error toggling lock:', error);
        const entityType = headerType === 'release' ? 'release' : 'project';
        alert(\`Error updating \${entityType} lock. Please check your connection.\`);
      } finally {
        lockBtn.disabled = false;
      }
    };
    
    // Update lock UI based on current state
    function updateLockUI() {
      const lockBtn = document.getElementById('zip-sync-lock-btn');
      const lockText = document.getElementById('lock-btn-text');
      const lockIcon = lockBtn.querySelector('.zip-sync-lock-icon');
      const entityType = headerType === 'release' ? 'Release' : 'Project';
      
      if (isLocked) {
        lockBtn.className = 'zip-sync-lock-btn locked';
        lockText.textContent = \`Unlock \${entityType}\`;
        lockIcon.innerHTML = \`<path fill-rule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2v2H9.5V8a3.5 3.5 0 717 0z" clip-rule="evenodd"></path>\`;
        
        // Show lock overlay
        showLockOverlay();
      } else {
        lockBtn.className = 'zip-sync-lock-btn';
        lockText.textContent = \`Lock \${entityType}\`;
        lockIcon.innerHTML = \`<path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 616 0z" clip-rule="evenodd"></path>\`;
        
        // Remove lock overlay
        removeLockOverlay();
      }
    }
    
    // Show lock overlay
    function showLockOverlay() {
      if (!document.getElementById('zip-sync-lock-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'zip-sync-lock-overlay';
        overlay.className = 'zip-sync-lock-overlay';
        overlay.innerHTML = '🔒 Project is locked for editing';
        document.body.appendChild(overlay);
      }
    }
    
    // Remove lock overlay
    function removeLockOverlay() {
      const overlay = document.getElementById('zip-sync-lock-overlay');
      if (overlay) {
        overlay.remove();
      }
    }
    
    // Load project/release info from API
    async function loadProjectInfo() {
      try {
        projectId = extractProjectId();
        releaseId = extractReleaseId();
        console.log('🔍 Detected project ID:', projectId);
        console.log('🔍 Detected release ID:', releaseId);
        
        if (projectId) {
          if (headerType === 'release' && releaseId) {
            // For releases, get release info
            const apiUrl = \`\${getApiBaseUrl()}/api/releases/\${releaseId}/info\`;
            console.log('🔍 Fetching release info from:', apiUrl);
            const response = await fetch(apiUrl);
            console.log('🔍 Release info response:', response);
            
            if (response.ok) {
              const info = await response.json();
              console.log('🔍 Release info data:', info);
              
              // Handle release response
              const projectName = info.project.name;
              const version = info.version || '1.0.0';
              const locked = info.locked || false;
              const lockToken = info.lockToken;
              
              document.getElementById('zip-sync-project-name').textContent = projectName;
              document.getElementById('zip-sync-project-version').textContent = \`v\${version}\`;
              
              // Store lock token for public API calls
              if (lockToken) {
                window.zipSyncLockToken = lockToken;
              }
              
              // Check if release is locked
              isLocked = locked;
              updateLockUI();
              
              console.log('✅ Release info loaded successfully');
            } else {
              console.warn('⚠️ Failed to fetch release info:', response.status);
            }
          } else {
            // For projects, show basic info without lock functionality
            const apiUrl = \`\${getApiBaseUrl()}/api/projects/\${projectId}/info\`;
            console.log('🔍 Fetching project info from:', apiUrl);
            const response = await fetch(apiUrl);
            
            if (response.ok) {
              const info = await response.json();
              console.log('🔍 Project info data:', info);
              
              document.getElementById('zip-sync-project-name').textContent = info.name;
              document.getElementById('zip-sync-project-version').textContent = \`v\${info.version}\`;
              
              // Hide lock button for projects since locking is not supported
              const lockBtn = document.getElementById('zip-sync-lock-btn');
              if (lockBtn) {
                lockBtn.style.display = 'none';
              }
              
              console.log('✅ Project info loaded successfully (no lock functionality)');
            } else {
              console.warn('⚠️ Failed to fetch project info:', response.status);
            }
          }
        } else {
          console.warn('⚠️ Could not determine project ID from URL');
        }
      } catch (error) {
        console.error('❌ Error loading info:', error);
      }
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      console.log('🔍 Waiting for DOMContentLoaded to load project info');
      document.addEventListener('DOMContentLoaded', loadProjectInfo);
    } else {
      console.log('🔍 DOM already loaded, fetching project info immediately');
      loadProjectInfo();
    }
  })();
</script>`;
}
