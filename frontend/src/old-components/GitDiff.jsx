import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Diff, Hunk, parseDiff } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import { fetchProjectGitDiff } from '../api';

const GitDiff = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [diffData, setDiffData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsedFiles, setCollapsedFiles] = useState(new Set());

  const toggleFileCollapse = (fileId) => {
    const newCollapsed = new Set(collapsedFiles);
    if (newCollapsed.has(fileId)) {
      newCollapsed.delete(fileId);
    } else {
      newCollapsed.add(fileId);
    }
    setCollapsedFiles(newCollapsed);
  };

  const getFileChanges = (file) => file.additions + file.deletions;
  const hasTooManyChanges = (file) => getFileChanges(file) >= 100;

  // Convert file data to unified diff format for react-diff-view
  const createUnifiedDiff = (file) => {
    const oldValue = file.oldValue || '';
    const newValue = file.newValue || '';
    const oldLines = oldValue.split('\n');
    const newLines = newValue.split('\n');
    
    // Simple line-by-line comparison
    let diffLines = [];
    const maxLines = Math.max(oldLines.length, newLines.length);
    
    // Add context lines around changes for better visualization
    let hasChanges = false;
    
    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];
      
      if (oldLine !== undefined && newLine !== undefined) {
        if (oldLine === newLine) {
          diffLines.push(` ${oldLine}`);
        } else {
          hasChanges = true;
          diffLines.push(`-${oldLine}`);
          diffLines.push(`+${newLine}`);
        }
      } else if (oldLine !== undefined) {
        hasChanges = true;
        diffLines.push(`-${oldLine}`);
      } else if (newLine !== undefined) {
        hasChanges = true;
        diffLines.push(`+${newLine}`);
      }
    }
    
    if (!hasChanges) {
      return null; // No changes to display
    }
    
    // Create unified diff header
    const header = `--- a/${file.path}\n+++ b/${file.path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@`;
    
    return `${header}\n${diffLines.join('\n')}`;
  };

  // Component for rendering collapsible diff content
  const CollapsibleDiffContent = ({ file, isCollapsed }) => {
    const totalChanges = getFileChanges(file);
    const tooManyChanges = hasTooManyChanges(file);

    if (isCollapsed) return null;

    if (tooManyChanges) {
      return (
        <div className="too-many-changes-message">
          <div className="too-many-changes-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z"/>
            </svg>
          </div>
          <span>Too many changes ({totalChanges} lines changed)</span>
        </div>
      );
    }

    if (file.isBinaryFile) {
      return (
        <div className="binary-file-message">
          <div className="binary-file-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13,9H18.5L13,3.5V9M6,2H14L20,8V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V4C4,2.89 4.89,2 6,2Z"/>
            </svg>
          </div>
          <span>Binary file not shown</span>
        </div>
      );
    }

    try {
      const diffText = createUnifiedDiff(file);
      
      if (!diffText) {
        return (
          <div className="no-changes-message">
            <span>No changes to display</span>
          </div>
        );
      }

      const parsedDiff = parseDiff(diffText);
      
      if (parsedDiff.length === 0 || !parsedDiff[0].hunks || parsedDiff[0].hunks.length === 0) {
        return (
          <div className="no-changes-message">
            <span>No changes to display</span>
          </div>
        );
      }

      return (
        <div className="react-diff-view-wrapper">
          {parsedDiff.map((diffFile, index) => (
            <Diff 
              key={index} 
              viewType="split" 
              diffType={diffFile.type || 'modify'}
              hunks={diffFile.hunks}
            >
              {(hunks) => 
                hunks.map((hunk, hunkIndex) => 
                   (
                    <Hunk key={hunkIndex} hunk={hunk} />
                  )
                )
              }
            </Diff>
          ))}
        </div>
      );
    } catch (error) {
      return (
        <div className="diff-error-message">
          <span>Error displaying diff: {error.message}</span>
        </div>
      );
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'added':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
        );
      case 'deleted':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13H5v-2h14v2z"/>
          </svg>
        );
      case 'modified':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        );
      default:
        return null;
    }
  };

  useEffect(() => {
    const fetchDiffData = async () => {
      if (!projectId) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const data = await fetchProjectGitDiff(projectId);
        
        setDiffData(data);
      } catch (err) {
        setError(err.error || err.message || 'Failed to fetch git diff data');
      } finally {
        setLoading(false);
      }
    };

    fetchDiffData();
  }, [projectId]);

  // Render different states based on loading/error/data conditions
  if (loading) {
    return (
      <div className="git-diff-container">
        <div className="git-diff-header">
          <button 
            className="btn btn-outline"
            onClick={() => navigate(-1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
            Back
          </button>
          <h1>Git Differences</h1>
        </div>
        <div className="loading">
          <div className="spinner"></div>
          Loading git diff data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="git-diff-container">
        <div className="git-diff-header">
          <button 
            className="btn btn-outline"
            onClick={() => navigate(-1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
            Back
          </button>
          <h1>Git Differences</h1>
        </div>
        <div className="error-state">
          <div className="error-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z"/>
            </svg>
          </div>
          <h3>Error Loading Git Diff</h3>
          <p>{error}</p>
          <button 
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!diffData || !diffData.files || diffData.files.length === 0) {
    return (
      <div className="git-diff-container">
        <div className="git-diff-header">
          <button 
            className="btn btn-outline"
            onClick={() => navigate(-1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
            Back
          </button>
          <h1>Git Differences</h1>
        </div>
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13,9H18.5L13,3.5V9M6,2H14L20,8V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V4C4,2.89 4.89,2 6,2M15,18V16H6V18H15M18,14V12H6V14H18Z"/>
            </svg>
          </div>
          <h3>No Changes Found</h3>
          <p>No git differences available for this project. This could mean:</p>
          <ul style={{ textAlign: 'left', margin: '16px auto', maxWidth: '400px' }}>
            <li>The project has no recent commits</li>
            <li>There are no differences between the last two commits</li>
            <li>The project doesn't have a git repository</li>
          </ul>
        </div>
      </div>
    );
  }

  // Main render for successful data load

  return (
    <div className="git-diff-container">
      <div className="git-diff-header">
        <button 
          className="btn btn-outline"
          onClick={() => navigate(-1)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
          Back
        </button>
        <div>
          <h1>Git Differences - {diffData.projectName}</h1>
          <p className="diff-summary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
              <path d="M13,9H18.5L13,3.5V9M6,2H14L20,8V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V4C4,2.89 4.89,2 6,2M15,18V16H6V18H15M18,14V12H6V14H18Z"/>
            </svg>
            <strong>{diffData.totalFiles}</strong> file{diffData.totalFiles !== 1 ? 's' : ''} changed
            <span className="diff-stats">
              <span className="additions">+{diffData.totalAdditions}</span>
              <span className="deletions">-{diffData.totalDeletions}</span>
            </span>
            lines changed
          </p>
        </div>
      </div>

      {/* GitHub-style vertical file list */}
      <div className="git-diff-files">
        {diffData.files.map((file) => {
          const isCollapsed = collapsedFiles.has(file.id);
          const totalChanges = getFileChanges(file);
          const tooManyChanges = hasTooManyChanges(file);

          return (
            <div key={file.id} className="git-diff-file">
              <div className="file-header" onClick={() => toggleFileCollapse(file.id)}>
                <div className="file-header-left">
                  <button className="file-toggle-btn">
                    <svg 
                      width="12" 
                      height="12" 
                      viewBox="0 0 24 24" 
                      fill="currentColor"
                      style={{ 
                        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                        transition: 'transform 0.2s ease'
                      }}
                    >
                      <path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/>
                    </svg>
                  </button>
                  
                  <span 
                    className={`file-status-indicator ${file.status}`}
                    title={file.status}
                  >
                    {getStatusIcon(file.status)}
                  </span>
                  
                  <span className="file-path-text">{file.path}</span>
                  
                  {tooManyChanges && (
                    <span className="too-many-changes-badge">
                      Too many changes
                    </span>
                  )}
                </div>
                
                <div className="file-header-right">
                  <div className="file-changes-bar">
                    {file.additions > 0 && (
                      <>
                        <span className="additions-text">+{file.additions}</span>
                        <div className="changes-visual">
                          {Array.from({length: Math.min(5, Math.ceil((file.additions / totalChanges) * 5))}).map((_, i) => (
                            <div key={`add-${i}`} className="change-dot addition"></div>
                          ))}
                        </div>
                      </>
                    )}
                    {file.deletions > 0 && (
                      <>
                        <span className="deletions-text">-{file.deletions}</span>
                        <div className="changes-visual">
                          {Array.from({length: Math.min(5, Math.ceil((file.deletions / totalChanges) * 5))}).map((_, i) => (
                            <div key={`del-${i}`} className="change-dot deletion"></div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <CollapsibleDiffContent file={file} isCollapsed={isCollapsed} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default GitDiff;
