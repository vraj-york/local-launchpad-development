import React, { useEffect, useState } from "react";
import {
  fetchReleases,
  createRelease,
  toggleReleaseLock,
  uploadToRelease,
} from "../api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { PageHeader } from "./PageHeader";

const ReleaseManagement = ({ projectId, projectName }) => {
  const { user } = useAuth();

  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [version, setVersion] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");

  const [newRelease, setNewRelease] = useState({
    name: "",
    description: "",
  });

  useEffect(() => {
    if (projectId) {
      loadReleases();
    }
  }, [projectId]);

  const loadReleases = async () => {
    try {
      setLoading(true);
      const data = await fetchReleases(projectId);
      setReleases(data);
    } catch (err) {
      setError(err.message || "Failed to load releases");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRelease = async (e) => {
    e.preventDefault();
    if (!newRelease.name.trim()) return;

    try {
      setCreating(true);
      toast.info("Creating release...");
      await createRelease({
        projectId: Number(projectId),
        name: newRelease.name.trim(),
        description: newRelease.description.trim() || null,
      });
      setNewRelease({ name: "", description: "" });
      setShowCreateForm(false);
      await loadReleases();
      toast.success(`Release "${newRelease.name}" created successfully!`);
    } catch (err) {
      const errorMessage = err.message || "Failed to create release";
      setError(errorMessage);
      toast.error(`Failed to create release: ${errorMessage}`);
    } finally {
      setCreating(false);
    }
  };

  const handleLockToggle = async (releaseId, currentLockStatus) => {
    try {
      await toggleReleaseLock(releaseId, !currentLockStatus);
      await loadReleases();
    } catch (err) {
      setError(err.message || "Failed to toggle release lock");
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.type === "application/zip" || file.name.endsWith(".zip")) {
        setUploadFile(file);
        setUploadStatus("");
      } else {
        setUploadStatus("Please select a ZIP file");
        setUploadFile(null);
      }
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedRelease || !uploadFile) return;

    try {
      setUploading(true);
      setUploadStatus("Uploading and building project...");
      setUploadProgress(0);
      toast.info("Uploading and building project...");

      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 500);

      const result = await uploadToRelease(
        selectedRelease,
        uploadFile,
        version || null,
      );

      clearInterval(progressInterval);
      setUploadProgress(100);

      setUploadStatus(
        `✅ Upload successful! Version: ${result.version.version} - Build URL: ${result.buildUrl}`,
      );
      setUploadFile(null);
      setSelectedRelease("");
      setVersion("");
      document.getElementById("file-input").value = "";
      await loadReleases();
      toast.success(
        `Project uploaded successfully! Version: ${result.version.version}`,
      );
    } catch (err) {
      const errorMessage = err.error || err.message || "Upload failed";
      setUploadStatus(`❌ Upload failed: ${errorMessage}`);
      toast.error(`Upload failed: ${errorMessage}`);
    } finally {
      setUploading(false);
    }
  };

  const canManageReleases = user?.role === "admin" || user?.role === "manager";

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] text-slate-500">
        <div className="w-8 h-8 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
        Loading releases...
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Release Management" description="Manage releases and upload ZIP files">{canManageReleases && (
        <Button
          className="text-white gap-2"
          onClick={() => setShowCreateForm(true)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
          Create Release
        </Button>
      )}</PageHeader>



      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg border border-red-200 mb-6">
          {error}
        </div>
      )}

      {/* Create Release Form */}
      {showCreateForm && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-lg font-semibold text-slate-800">
              Create New Release
            </h3>
          </div>
          <div className="p-6">
            <form onSubmit={handleCreateRelease}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Release Name
                </label>
                <Input
                  type="text"
                  value={newRelease.name}
                  onChange={(e) =>
                    setNewRelease({ ...newRelease, name: e.target.value })
                  }
                  placeholder="Enter release name"
                  required
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Release Description/Roadmap
                </label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-slate-200 bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  value={newRelease.description}
                  onChange={(e) =>
                    setNewRelease({
                      ...newRelease,
                      description: e.target.value,
                    })
                  }
                  placeholder="Enter release description or roadmap"
                  rows="3"
                />
              </div>

              <div className="flex gap-3">
                <Button
                  type="submit"
                  className="text-white"
                  disabled={creating || !newRelease.name.trim()}
                >
                  {creating ? "Creating..." : "Create Release"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload to Release Form */}
      {canManageReleases && releases.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-lg font-semibold text-slate-800">
              Upload to Release
            </h3>
          </div>
          <div className="p-6">
            <form onSubmit={handleUpload}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Select Release *
                </label>
                <select
                  className="flex h-10 w-full items-center justify-between rounded-md border border-slate-200 bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  value={selectedRelease}
                  onChange={(e) => setSelectedRelease(e.target.value)}
                  required
                >
                  <option value="">Choose a release...</option>
                  {releases.map((release) => (
                    <option
                      key={release.id}
                      value={release.id}
                      disabled={release.isLocked}
                    >
                      {release.name} {release.isLocked ? "(Locked)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Version
                </label>
                <Input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="e.g., 1.0.0, 1.1.0, 2.0.0"
                />
                <div className="text-xs text-slate-500 mt-1">
                  Leave empty for auto-increment
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Upload ZIP File *
                </label>
                <input
                  id="file-input"
                  type="file"
                  accept=".zip"
                  onChange={handleFileSelect}
                  className="flex w-full rounded-md border border-slate-200 bg-transparent px-3 py-2 text-sm shadow-sm file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-slate-700 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                />
                <div className="text-xs text-slate-500 mt-1">
                  Only ZIP files are allowed. Maximum size: 50MB
                </div>
              </div>

              {uploadFile && (
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg mb-4">
                  <div className="font-medium text-blue-900 mb-1">
                    Selected File:
                  </div>
                  <div className="text-sm text-blue-700">
                    📁 {uploadFile.name} (
                    {(uploadFile.size / 1024 / 1024).toFixed(2)} MB)
                  </div>
                </div>
              )}

              {uploading && (
                <div className="mb-4">
                  <div className="flex justify-between mb-2 text-sm text-slate-700">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {uploadStatus && (
                <div
                  className={`p-3 rounded-lg mb-4 border ${uploadStatus.includes("✅")
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : uploadStatus.includes("❌")
                      ? "bg-red-50 border-red-200 text-red-800"
                      : "bg-blue-50 border-blue-200 text-blue-800"
                    }`}
                >
                  {uploadStatus}
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  type="submit"
                  className="bg-emerald-500 hover:bg-emerald-600 text-white"
                  disabled={uploading || !selectedRelease || !uploadFile}
                >
                  {uploading ? "Uploading..." : "Upload & Build"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedRelease("");
                    setUploadFile(null);
                    setVersion("");
                    setUploadStatus("");
                    setUploadProgress(0);
                    document.getElementById("file-input").value = "";
                  }}
                  disabled={uploading}
                >
                  Clear
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Releases List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800">
            All Releases ({releases.length})
          </h3>
        </div>
        <div className="p-6">
          {releases.length === 0 ? (
            <div className="text-center py-16 text-slate-500 flex flex-col items-center">
              <div className="mb-4 opacity-50 text-slate-400">
                <svg
                  width="64"
                  height="64"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-slate-700 mb-2">
                No Releases Found
              </h3>
              <p className="mb-6">Create your first release to get started.</p>
              {canManageReleases && (
                <Button
                  className="text-white"
                  onClick={() => setShowCreateForm(true)}
                >
                  Create Release
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {releases.map((release) => (
                <div
                  key={release.id}
                  className="relative border border-slate-200 rounded-xl p-6 hover:shadow-md transition-shadow group bg-slate-50/30"
                >
                  <div className="flex justify-between items-start mb-4">
                    <h4 className="text-lg font-semibold text-slate-800">
                      {release.name}
                    </h4>
                    <div className="flex gap-2 items-center">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${release.isLocked
                          ? "bg-red-100 text-red-700"
                          : "bg-emerald-100 text-emerald-700"
                          }`}
                      >
                        {release.isLocked ? "🔒 Locked" : "🔓 Unlocked"}
                      </span>
                      {canManageReleases && (
                        <Button
                          variant="outline"
                          size="sm"
                          className={
                            release.isLocked
                              ? "text-amber-600 hover:text-amber-700"
                              : "text-slate-600"
                          }
                          onClick={() =>
                            handleLockToggle(release.id, release.isLocked)
                          }
                        >
                          {release.isLocked ? "Unlock" : "Lock"}
                        </Button>
                      )}
                    </div>
                  </div>

                  <p className="text-slate-600 mb-4 whitespace-pre-wrap text-sm">
                    {release.description || "No description provided"}
                  </p>

                  <div className="flex items-center gap-4 text-xs text-slate-500 mb-4 pb-4 border-b border-slate-200">
                    <span>
                      Created:{" "}
                      {new Date(release.createdAt).toLocaleDateString()}
                    </span>
                    <span>By: {release.creator.name}</span>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-lg p-3 text-sm text-slate-600 mb-4">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <span className="text-slate-400 font-normal">
                          Release ID:
                        </span>{" "}
                        <span className="font-mono text-xs">{release.id}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-normal">
                          Versions:
                        </span>{" "}
                        {release.versions.length}
                      </div>
                      {release.versions.length > 0 && (
                        <div>
                          <span className="text-slate-400 font-normal">
                            Latest:
                          </span>{" "}
                          v{release.versions[0].version}
                        </div>
                      )}
                    </div>
                  </div>

                  {release.versions.length > 0 && (
                    <div className="space-y-2">
                      <h5 className="text-sm font-semibold text-slate-800 mb-2">
                        Versions History
                      </h5>
                      {release.versions.map((version) => (
                        <div
                          key={version.id}
                          className="flex justify-between items-center p-3 bg-white border border-slate-100 rounded-lg hover:border-emerald-200 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm font-medium text-slate-700">
                              v{version.version}
                            </span>
                            <span className="text-xs text-slate-400">
                              {new Date(version.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          {version.buildUrl && (
                            <a
                              href={version.buildUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-600 hover:text-emerald-700 text-xs font-medium flex items-center gap-1"
                            >
                              Live Build ↗
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReleaseManagement;
