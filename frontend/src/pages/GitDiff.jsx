import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Diff, Hunk, parseDiff } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import { fetchProjectGitDiff } from '../api';
import { Button } from '@/components/ui/button';
import { AlertCircle, ArrowLeft, ChevronRight, FileText, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';


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
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">Too many changes ({totalChanges} lines changed)</span>
        </div>
      );
    }

    if (file.isBinaryFile) {
      return (
        <div className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-600">
          <FileText className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">Binary file not shown</span>
        </div>
      );
    }

    try {
      const diffText = createUnifiedDiff(file);

      if (!diffText) {
        return (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 text-sm text-center">
            No changes to display
          </div>
        );
      }

      const parsedDiff = parseDiff(diffText);

      if (parsedDiff.length === 0 || !parsedDiff[0].hunks || parsedDiff[0].hunks.length === 0) {
        return (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 text-sm text-center">
            No changes to display
          </div>
        );
      }

      return (
        <div className="overflow-x-auto">
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
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          Error displaying diff: {error.message}
        </div>
      );
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'added':
        return <Plus className="w-4 h-4" />;
      case 'deleted':
        return <Minus className="w-4 h-4" />;
      case 'modified':
        return <Check className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'added':
        return 'text-green-600 bg-green-50';
      case 'deleted':
        return 'text-red-600 bg-red-50';
      case 'modified':
        return 'text-blue-600 bg-blue-50';
      default:
        return 'text-slate-600 bg-slate-50';
    }
  };

  useEffect(() => {
    const fetchDiffData = async () => {
      if (!projectId) return;

      setLoading(true);
      setError(null);

      try {
        console.log("started to fetch git diffrence")
        const data = await fetchProjectGitDiff(projectId);
        console.log(data, "GitDiffData")

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
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <h1 className="text-2xl font-bold text-slate-800">Git Differences</h1>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
          Loading git diff data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <h1 className="text-2xl font-bold text-slate-800">Git Differences</h1>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-red-50 p-4 rounded-full mb-4 text-red-500">
            <XCircle className="w-12 h-12" />
          </div>
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Error Loading Git Diff</h3>
          <p className="text-red-600 mb-6 max-w-md">{error}</p>
          <Button
            onClick={() => window.location.reload()}
          >
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!diffData || !diffData.files || diffData.files.length === 0) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <h1 className="text-2xl font-bold text-slate-800">Git Differences</h1>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-slate-300 mb-4">
            <FileText className="w-20 h-20" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">No Changes Found</h3>
          <p className="text-slate-500 mb-4">No git differences available for this project. This could mean:</p>
          <ul className="text-left text-slate-600 space-y-2 max-w-md">
            <li className="flex items-start gap-2">
              <span className="text-slate-400 mt-1">•</span>
              <span>The project has no recent commits</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-slate-400 mt-1">•</span>
              <span>There are no differences between the last two commits</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-slate-400 mt-1">•</span>
              <span>The project doesn't have a git repository</span>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  // Main render for successful data load

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <Button
          variant="outline"
          onClick={() => navigate(-1)}
          className="gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="text-right">
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Git Differences - {diffData.projectName}</h1>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <FileText className="w-4 h-4" />
            <span>
              <strong className="text-slate-800">{diffData.totalFiles}</strong> file{diffData.totalFiles !== 1 ? 's' : ''} changed
            </span>
            <span className="text-green-600 font-medium">+{diffData.totalAdditions}</span>
            <span className="text-red-600 font-medium">-{diffData.totalDeletions}</span>
            <span>lines changed</span>
          </div>
        </div>
      </div>

      {/* GitHub-style vertical file list */}
      <div className="space-y-4">
        {diffData.files.map((file) => {
          const isCollapsed = collapsedFiles.has(file.id);
          const totalChanges = getFileChanges(file);
          const tooManyChanges = hasTooManyChanges(file);

          return (
            <Card key={file.id} className="overflow-hidden">
              <CardHeader
                className="p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => toggleFileCollapse(file.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFileCollapse(file.id);
                      }}
                    >
                      <ChevronRight
                        className={`w-3 h-3 transition-transform ${!isCollapsed ? 'rotate-90' : ''}`}
                      />
                    </Button>

                    <span
                      className={`flex items-center justify-center w-6 h-6 rounded ${getStatusColor(file.status)}`}
                      title={file.status}
                    >
                      {getStatusIcon(file.status)}
                    </span>

                    <span className="font-mono text-sm text-slate-700 truncate">{file.path}</span>

                    {tooManyChanges && (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                        Too many changes
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {file.additions > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium text-green-600">+{file.additions}</span>
                        <div className="flex gap-0.5">
                          {Array.from({ length: Math.min(5, Math.ceil((file.additions / totalChanges) * 5)) }).map((_, i) => (
                            <div key={`add-${i}`} className="w-2 h-2 bg-green-500 rounded-sm"></div>
                          ))}
                        </div>
                      </div>
                    )}
                    {file.deletions > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium text-red-600">-{file.deletions}</span>
                        <div className="flex gap-0.5">
                          {Array.from({ length: Math.min(5, Math.ceil((file.deletions / totalChanges) * 5)) }).map((_, i) => (
                            <div key={`del-${i}`} className="w-2 h-2 bg-red-500 rounded-sm"></div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>

              {!isCollapsed && (
                <CardContent className="p-4 pt-0">
                  <CollapsibleDiffContent file={file} isCollapsed={isCollapsed} />
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default GitDiff;
