import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactDiffViewer from 'react-diff-viewer-continued';
import { fetchProjectGitDiff } from '../api';

const GitDiff = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [diffData, setDiffData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsedFiles, setCollapsedFiles] = useState(new Set());
  const [loadedLargeFiles, setLoadedLargeFiles] = useState(new Set());

  const toggleFileCollapse = (fileId) => {
    const newCollapsed = new Set(collapsedFiles);
    if (newCollapsed.has(fileId)) {
      newCollapsed.delete(fileId);
    } else {
      newCollapsed.add(fileId);
    }
    setCollapsedFiles(newCollapsed);
  };

  const loadLargeFileDiff = (fileId) => {
    const newLoaded = new Set(loadedLargeFiles);
    newLoaded.add(fileId);
    setLoadedLargeFiles(newLoaded);
  };

  const getFileChanges = (file) => file.additions + file.deletions;
  const isLargeFile = (file) => getFileChanges(file) > 500 || file.isLargeFile || file.isBinaryFile;

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
        console.log('🔍 Fetching git diff for project:', projectId);
        const data = await fetchProjectGitDiff(projectId);
        console.log('📊 Received diff data:', data);
        
        setDiffData(data);
      } catch (err) {
        console.error('❌ Error fetching git diff:', err);
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
          const isLarge = isLargeFile(file);
          const isLoaded = loadedLargeFiles.has(file.id);
          const totalChanges = getFileChanges(file);

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

              {!isCollapsed && (
                <div className="file-content">
                  {isLarge && !isLoaded ? (
                    <div className="large-file-summary">
                      <div className="large-file-message">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z"/>
                        </svg>
                        {file.isBinaryFile 
                          ? 'Binary file not shown.' 
                          : `Large diffs are not rendered by default.`
                        }
                      </div>
                      
                      {!file.isBinaryFile && (
                        <button 
                          className="load-diff-btn"
                          onClick={() => loadLargeFileDiff(file.id)}
                        >
                          Load Diff
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="diff-viewer-content">
                      <ReactDiffViewer
                        oldValue={file.oldValue}
                        newValue={file.newValue}
                        splitView={true}
                        showDiffStats={false}
                        hideLineNumbers={false}
                        useDarkTheme={false}
                        styles={{
                          variables: {
                            light: {
                              codeFoldGutterBackground: '#f8f9fa',
                              codeFoldBackground: '#e9ecef',
                              addedBackground: '#e6ffed',
                              addedColor: '#24292e',
                              removedBackground: '#ffeef0',
                              removedColor: '#24292e',
                              wordAddedBackground: '#acf2bd',
                              wordRemovedBackground: '#fdb8c0',
                              addedGutterBackground: '#cdffd8',
                              removedGutterBackground: '#ffdce0',
                              gutterBackground: '#f6f8fa',
                              gutterBackgroundDark: '#f1f3f4',
                              highlightBackground: '#fff5b4',
                              highlightGutterBackground: '#fff5b4',
                            },
                          },
                          line: {
                            fontSize: '12px',
                            lineHeight: '20px',
                            fontFamily: 'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
                          },
                          gutter: {
                            fontSize: '12px',
                            lineHeight: '20px',
                            minWidth: '40px',
                            padding: '0 8px',
                          },
                          marker: {
                            fontSize: '12px',
                            lineHeight: '20px',
                          },
                          wordDiff: {
                            padding: '1px 2px',
                          },
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default GitDiff;
