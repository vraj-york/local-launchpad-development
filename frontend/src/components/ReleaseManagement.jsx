import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchReleases,
  createRelease,
  updateReleaseStatus,
  uploadToRelease,
  getRoadmapItemsByProjectId,
} from "../api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { PageHeader } from "./PageHeader";
import { Spinner } from "./ui/spinner";
import {
  CheckCircle,
  ChevronDown,
  FileArchive,
  Lock,
  Plus,
  Upload,
  User,
  CalendarDays,
  Sparkles,
} from "lucide-react";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { SelectActiveVersion } from "./SelectActiveVersion";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

const RELEASE_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "locked", label: "Locked" },
];

function normalizeReleaseStatus(release) {
  const s = String(release?.status ?? "draft").toLowerCase();
  return ["draft", "active", "locked"].includes(s) ? s : "draft";
}

function isReleaseLocked(release) {
  return normalizeReleaseStatus(release) === "locked";
}

function releaseCardAccentBarClass(release) {
  switch (normalizeReleaseStatus(release)) {
    case "locked":
      return "bg-red-500";
    case "active":
      return "bg-primary";
    default:
      return "bg-slate-400";
  }
}

function releaseStatusLabel(value) {
  return (
    RELEASE_STATUS_OPTIONS.find((o) => o.value === value)?.label ??
    String(value ?? "")
  );
}

/** Visual + copy for the lifecycle status chip (single source of truth for header UI). */
function releaseStatusPresentation(release) {
  const s = normalizeReleaseStatus(release);
  if (s === "active") {
    return {
      label: "Active",
      hint: "Serves the live build when set as the active release",
      pillClass:
        "bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-900 ring-1 ring-emerald-200/70 shadow-sm shadow-emerald-500/5",
      dotClass: "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)]",
    };
  }
  if (s === "locked") {
    return {
      label: "Locked",
      hint: "No new uploads until unlocked or status changed",
      pillClass:
        "bg-gradient-to-r from-rose-50 to-orange-50 text-rose-900 ring-1 ring-rose-200/70 shadow-sm shadow-rose-500/5",
      dotClass: "bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.2)]",
    };
  }
  return {
    label: "Draft",
    hint: "Work in progress — safe to upload and iterate",
    pillClass:
      "bg-gradient-to-r from-slate-50 to-slate-100/90 text-slate-800 ring-1 ring-slate-200/80",
    dotClass: "bg-slate-400",
  };
}

const ReleaseManagement = ({ projectId, projectName }) => {
  const { user } = useAuth();

  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [version, setVersion] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadSuccessBuildUrl, setUploadSuccessBuildUrl] = useState(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const uploadFileInputRef = useRef(null);

  const [roadmaps, setRoadmaps] = useState([]);
  const [roadmapsLoading, setRoadmapsLoading] = useState(false);
  const [roadmapError, setRoadmapError] = useState("");
  const [selectedRoadmapItemIds, setSelectedRoadmapItemIds] = useState([]);
  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [statusConfirm, setStatusConfirm] = useState(null);
  const [statusConfirmSubmitting, setStatusConfirmSubmitting] = useState(false);

  const [newRelease, setNewRelease] = useState({
    name: "",
    description: "",
  });

  useEffect(() => {
    if (projectId) {
      loadReleases();
      loadRoadmaps();
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

  const loadRoadmaps = async () => {
    try {
      setRoadmapsLoading(true);
      setRoadmapError("");
      const data = await getRoadmapItemsByProjectId(projectId);
      setRoadmaps(data || []);
    } catch (err) {
      setRoadmapError(err.error || err.message || "Failed to load roadmaps");
      setRoadmaps([]);
    } finally {
      setRoadmapsLoading(false);
    }
  };

  const handleCreateRelease = async (e) => {
    e.preventDefault();
    if (!newRelease.name.trim()) return;

    try {
      setCreating(true);
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
      const errorMessage = err.error || "Failed to create release";
      setError(errorMessage);
      toast.error(`${errorMessage}`);
    } finally {
      setCreating(false);
    }
  };

  const requestStatusChange = (releaseId, newStatus) => {
    const rel = releases.find((r) => r.id === releaseId);
    if (!rel || normalizeReleaseStatus(rel) === newStatus) return;
    setStatusConfirm({
      releaseId,
      releaseName: rel.name,
      fromStatus: normalizeReleaseStatus(rel),
      toStatus: newStatus,
    });
  };

  const confirmStatusChange = async () => {
    if (!statusConfirm) return;
    const { releaseId, toStatus } = statusConfirm;
    if (toStatus === "active") {
      const otherActive = releases.find(
        (r) => r.id !== releaseId && normalizeReleaseStatus(r) === "active",
      );
      if (otherActive) return;
    }
    try {
      setStatusConfirmSubmitting(true);
      setStatusUpdatingId(releaseId);
      await updateReleaseStatus(releaseId, toStatus);
      toast.success(`Release status set to ${toStatus}`);
      setStatusConfirm(null);
      await loadReleases();
    } catch (err) {
      toast.error(err.error || "Failed to update release status");
      setError(err.error || "Failed to update release status");
    } finally {
      setStatusConfirmSubmitting(false);
      setStatusUpdatingId(null);
    }
  };

  const validateAndSetFile = (file) => {
    if (!file) return;
    if (file.type === "application/zip" || file.name.endsWith(".zip")) {
      setUploadFile(file);
      setUploadStatus("");
    } else {
      setUploadStatus("Please select a ZIP file");
      setUploadFile(null);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    validateAndSetFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragActive(false);
    const file = e.dataTransfer.files?.[0];
    validateAndSetFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleUpload = async (e) => {
    e.preventDefault();

    const fileToUpload = uploadFileInputRef.current?.files?.[0] || uploadFile;
    if (!selectedRelease || !fileToUpload) return;

    try {
      const selectedRoadmapIds = Array.from(
        new Set(
          selectedRoadmapItemIds
            .map((itemId) => getRoadmapIdForItem(itemId))
            .filter(Boolean),
        ),
      );

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
        fileToUpload,
        version || null,
        selectedRoadmapItemIds,
      );

      console.log("upload release result", result);

      clearInterval(progressInterval);
      setUploadProgress(100);

      const versionLabel = result?.version;
      const buildUrlDisplay = result?.buildUrl ?? null;
      setUploadStatus(
        `Upload successful! Version: ${versionLabel}${buildUrlDisplay ? " - Build URL: " : ""}`,
      );
      setUploadSuccessBuildUrl(buildUrlDisplay);
      setUploadFile(null);
      setSelectedRelease("");
      setVersion("");
      setSelectedRoadmapItemIds([]);
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = "";
      await loadReleases();
      toast.success(`Project uploaded successfully! Version: ${versionLabel}`);
    } catch (err) {
      const errorMessage = err.error || err.message || "Upload failed";
      setUploadStatus(`Upload failed: ${errorMessage}`);
      toast.error(`Upload failed: ${errorMessage}`);
    } finally {
      setUploading(false);
    }
  };

  const canManageReleases = user?.role === "admin" || user?.role === "manager";
  const getRoadmapIdForItem = (itemId) => {
    for (const roadmap of roadmaps) {
      if (roadmap.items?.some((item) => item.id.toString() === itemId)) {
        return roadmap.id;
      }
    }
    return null;
  };

  const resetUploadForm = () => {
    setSelectedRelease("");
    setUploadFile(null);
    setVersion("");
    setSelectedRoadmapItemIds([]);
    setUploadStatus("");
    setUploadSuccessBuildUrl(null);
    setUploadProgress(0);
    if (uploadFileInputRef.current) uploadFileInputRef.current.value = "";
  };

  const selectedItems = selectedRoadmapItemIds
    .map((itemId) => {
      for (const roadmap of roadmaps) {
        const item = roadmap.items?.find(
          (roadmapItem) => roadmapItem.id === itemId,
        );
        if (item) {
          return {
            id: itemId,
            title: item.title,
            roadmapTitle: roadmap.title,
          };
        }
      }
      return null;
    })
    .filter(Boolean);

  const removeSelectedItem = (itemId, event) => {
    event.stopPropagation();
    setSelectedRoadmapItemIds((prev) => prev.filter((id) => id !== itemId));
  };

  /** Another release is already Active — must lock it before this one can become Active (frontend guard). */
  const conflictingActiveRelease = useMemo(() => {
    if (!statusConfirm || statusConfirm.toStatus !== "active") return null;
    return (
      releases.find(
        (r) =>
          r.id !== statusConfirm.releaseId &&
          normalizeReleaseStatus(r) === "active",
      ) ?? null
    );
  }, [statusConfirm, releases]);

  const blockActivateUntilOtherLocked = !!conflictingActiveRelease;

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
      <PageHeader title="Release Management">
        {canManageReleases && (
          <Button
            className="text-white gap-2"
            onClick={() => setShowCreateForm(true)}
          >
            <Plus />
            Create Release
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-col gap-6">
        <SelectActiveVersion
          release={releases}
          projectId={projectId}
          onActivated={loadReleases}
        />

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
                <p className="mb-6">
                  Create your first release to get started.
                </p>
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
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {releases.map((release) => {
                  const statusUi = releaseStatusPresentation(release);
                  return (
                    <div
                      key={release.id}
                      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm shadow-slate-200/40 transition-all duration-200 hover:border-slate-300 hover:shadow-md hover:shadow-slate-200/60"
                    >
                      <div
                        className={`h-1 w-full shrink-0 ${releaseCardAccentBarClass(release)}`}
                        aria-hidden
                      />
                      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:px-6 sm:py-5">
                        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
                            <h4 className="min-w-0 max-w-full truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                              {release.name}
                            </h4>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className={`inline-flex max-w-full shrink-0 items-center gap-2 rounded-full px-3 py-1 text-left text-xs font-semibold ${statusUi.pillClass}`}
                                >
                                  <span
                                    className={`size-2 shrink-0 rounded-full ${statusUi.dotClass}`}
                                    aria-hidden
                                  />
                                  <span className="truncate">
                                    {statusUi.label}
                                  </span>
                                  {normalizeReleaseStatus(release) ===
                                    "active" && (
                                    <Sparkles
                                      className="size-3.5 shrink-0 text-emerald-600/80"
                                      aria-hidden
                                    />
                                  )}
                                  {isReleaseLocked(release) && (
                                    <Lock
                                      className="size-3.5 shrink-0 text-rose-600/80"
                                      aria-hidden
                                    />
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent
                                side="bottom"
                                className="max-w-[280px] text-left leading-snug"
                              >
                                {statusUi.hint}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100/80 pt-3 text-xs text-slate-500 sm:ml-auto sm:shrink-0 sm:border-t-0 sm:pt-0">
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                              <CalendarDays
                                className="size-3.5 shrink-0 text-slate-400"
                                aria-hidden
                              />
                              <time dateTime={release.createdAt}>
                                {new Date(release.createdAt).toLocaleDateString(
                                  undefined,
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  },
                                )}
                              </time>
                            </span>
                            <span
                              className="hidden h-3 w-px shrink-0 self-center bg-slate-200 sm:inline-block"
                              aria-hidden
                            />
                            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 sm:max-w-44 md:max-w-52">
                              <User
                                className="size-3.5 shrink-0 text-slate-400"
                                aria-hidden
                              />
                              <span className="truncate">
                                {release.creator.name}
                              </span>
                            </span>
                          </div>
                        </div>

                        <div className="rounded-xl bg-slate-50/80 px-3.5 py-3 ring-1 ring-slate-100/80">
                          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                            Description
                          </p>
                          <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-slate-600">
                            {release.description?.trim() ? (
                              release.description
                            ) : (
                              <span className="italic text-slate-400">
                                No description added yet.
                              </span>
                            )}
                          </p>
                        </div>

                        {canManageReleases && (
                          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-end sm:gap-6">
                              <div className="flex min-w-0 flex-col gap-1.5">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                  Set status
                                </span>
                                <Select
                                  value={normalizeReleaseStatus(release)}
                                  onValueChange={(v) =>
                                    requestStatusChange(release.id, v)
                                  }
                                  disabled={
                                    statusUpdatingId === release.id ||
                                    statusConfirm?.releaseId === release.id
                                  }
                                >
                                  <SelectTrigger className="h-10 w-full border-slate-200 bg-white transition-colors hover:border-slate-300 hover:bg-slate-50/90">
                                    <SelectValue placeholder="Status" />
                                  </SelectTrigger>
                                  <SelectContent align="start">
                                    {RELEASE_STATUS_OPTIONS.map((opt) => (
                                      <SelectItem
                                        key={opt.value}
                                        value={opt.value}
                                      >
                                        {opt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex min-w-0 flex-col gap-1.5">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                  Upload build
                                </span>
                                {isReleaseLocked(release) ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex w-full">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          disabled
                                          className="h-10 w-full cursor-not-allowed gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/90 font-medium text-slate-400 shadow-none"
                                        >
                                          <Upload
                                            className="size-4 shrink-0 opacity-60"
                                            strokeWidth={2}
                                          />
                                          Upload
                                        </Button>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="top"
                                      className="max-w-[260px] text-center"
                                    >
                                      Uploads are disabled while this release is
                                      locked. Set status to Active first.
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <Button
                                    variant="default"
                                    onClick={() => {
                                      setSelectedRelease(release.id.toString());
                                      setShowUploadForm(true);
                                    }}
                                  >
                                    <Upload
                                      className="size-4 text-white"
                                      strokeWidth={2.25}
                                    />
                                    Upload
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col px-5 pb-5 pt-2 sm:px-6 sm:pb-6">
                        {release.versions.length > 0 ? (
                          <Collapsible className="rounded-lg border border-slate-200 bg-white">
                            <CollapsibleTrigger asChild>
                              <Button
                                variant="ghost"
                                className="group flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50 data-[state=open]:rounded-b-none"
                              >
                                <span className="text-sm text-slate-800">
                                  Version history
                                </span>
                                <span className="text-sm text-slate-500">
                                  {release.versions.length} version
                                  {release.versions.length !== 1 ? "s" : ""}
                                </span>
                                <div className="text-sm">
                                  <span className="text-slate-400">Latest</span>
                                  <span className="ml-1.5 text-sm text-slate-700">
                                    v{release.versions[0].version}
                                  </span>
                                </div>
                                <ChevronDown className="size-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                              </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="space-y-2 border-t border-slate-200 p-4 pt-3">
                                {release.versions.map((version) => (
                                  <div
                                    key={version.id}
                                    className={`flex justify-between items-center p-3 ${version.isActive ? "bg-primary/10 border border-primary" : "bg-white border border-slate-100"} rounded-lg hover:border-primary transition-colors`}
                                  >
                                    <div className="flex flex-col gap-2">
                                      <div className="flex items-center gap-3">
                                        <span className="font-mono text-sm font-medium text-slate-700">
                                          v{version.version}
                                        </span>
                                        <span className="text-xs text-slate-400">
                                          {new Date(
                                            version.createdAt,
                                          ).toLocaleDateString()}
                                        </span>
                                      </div>
                                      {/* <div className="flex items-start gap-2 w-full">
                                        <span className="text-xs text-slate-400 whitespace-nowrap mt-1">
                                          RoadMap Items:
                                        </span>
                                        <div className="flex flex-wrap gap-2">
                                          {version.roadmapItems.map((item) => (
                                            <Badge
                                              key={item.id}
                                              className="rounded-md"
                                            >
                                              {item.title}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div> */}
                                    </div>
                                    <div className="flex flex-col gap-3">
                                      {version.isActive && (
                                        <Badge className="bg-primary text-primary-foreground">
                                          <CheckCircle size={14} /> Active
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Release Form Modal */}
      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Release</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateRelease} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="release-name">Release Name</Label>
              <Input
                id="release-name"
                type="text"
                value={newRelease.name}
                onChange={(e) =>
                  setNewRelease({ ...newRelease, name: e.target.value })
                }
                placeholder="Ex: 1.1.0"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="release-description">
                Release Description (Optional)
              </Label>
              <Textarea
                id="release-description"
                value={newRelease.description}
                onChange={(e) =>
                  setNewRelease({
                    ...newRelease,
                    description: e.target.value,
                  })
                }
                placeholder="Enter release description"
                rows={3}
              />
            </div>

            {/* <div className="space-y-2">
              <Label>Roadmaps (for reference)</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between gap-2 p-2 hover:bg-transparent"
                    disabled={roadmapsLoading || roadmaps.length === 0}
                  >
                    {roadmapsLoading ? (
                      "Loading roadmaps..."
                    ) : roadmaps.length === 0 ? (
                      "No roadmaps found"
                    ) : (
                      "View roadmap items"
                    )}
                    <ChevronDown className="h-4 w-4 text-slate-500" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-80 max-h-[320px] overflow-y-auto">
                  <DropdownMenuLabel>Roadmaps</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {roadmaps.map((roadmap) => (
                    <div key={roadmap.id} className="py-1">
                      <DropdownMenuLabel className="text-primary font-medium">
                        {roadmap.title}
                      </DropdownMenuLabel>
                      {roadmap.items?.length ? (
                        <ul className="list-none pl-3 space-y-1 mt-1">
                          {roadmap.items.map((item) => (
                            <li
                              key={item.id}
                              className="text-sm"
                            >
                              {item.title}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="px-2 py-1.5 text-sm text-slate-500">
                          No items found for this roadmap.
                        </div>
                      )}
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div> */}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="submit"
                className="text-white"
                disabled={creating || !newRelease.name.trim()}
              >
                {creating ? (
                  <>
                    <Spinner /> Creating
                  </>
                ) : (
                  "Create Release"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Upload to Release Form Modal */}
      {canManageReleases && releases.length > 0 && (
        <Dialog
          open={showUploadForm}
          onOpenChange={(open) => {
            setShowUploadForm(open);
            if (!open) resetUploadForm();
          }}
        >
          <DialogContent className="overflow-y-auto space-y-4">
            <DialogHeader>
              <DialogTitle>Upload to Release</DialogTitle>
              <DialogDescription>
                Upload a ZIP file to Version {""}
                <span className="font-medium text-slate-700">
                  {releases.find((r) => r.id.toString() === selectedRelease)
                    ?.name ?? "this release"}
                </span>
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleUpload} className="space-y-6">
              <div className="space-y-1">
                <Label htmlFor="upload-version">Version (Optional)</Label>
                <Input
                  id="upload-version"
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="e.g., 1.0.1, 1.0.2, 1.0.3..."
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty for auto-increment
                </p>
              </div>

              {/* <div className="space-y-2"> */}
              {/* <Label>Roadmap Items (Optional)</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between gap-2 p-2 hover:bg-transparent"
                      disabled={roadmapsLoading || roadmaps.length === 0}
                    >
                      {roadmapsLoading ? (
                        "Loading roadmaps..."
                      ) : roadmaps.length === 0 ? (
                        "No roadmaps found"
                      ) : selectedItems.length > 0 ? (
                        <span className="flex flex-wrap gap-2">
                          {selectedItems.map((item) => (
                            <span
                              key={item.id}
                              className="inline-flex items-center gap-1 rounded-sm bg-secondary px-2 py-1 text-sm"
                            >
                              <span className="font-medium">{item.title}</span>
                            </span>
                          ))}
                        </span>
                      ) : (
                        "None selected (optional)"
                      )}
                      <ChevronDown className="h-4 w-4 text-slate-500" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-80">
                    <DropdownMenuLabel>Roadmaps</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {roadmaps.map((roadmap) => (
                      <div key={roadmap.id}>
                        <DropdownMenuLabel className="text-primary">
                          {roadmap.title}
                        </DropdownMenuLabel>
                        {roadmap.items?.length ? (
                          roadmap.items.map((item) => {
                            const itemId = item.id;
                            const isChecked =
                              selectedRoadmapItemIds.includes(itemId);
                            return (
                              <DropdownMenuCheckboxItem
                                key={item.id}
                                checked={isChecked}
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedRoadmapItemIds((prev) => [
                                      ...prev,
                                      itemId,
                                    ]);
                                  } else {
                                    setSelectedRoadmapItemIds((prev) =>
                                      prev.filter((id) => id !== itemId),
                                    );
                                  }
                                }}
                              >
                                <span className="text-sm">{item.title}</span>
                              </DropdownMenuCheckboxItem>
                            );
                          })
                        ) : (
                          <div className="px-2 py-1.5 text-sm text-slate-500">
                            No items found for this roadmap.
                          </div>
                        )}
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {roadmapError && (
                  <p className="text-xs text-red-600">{roadmapError}</p>
                )} */}
              {/* <p className="text-xs text-muted-foreground">
                  Optionally link this version to one or more roadmap items.
                </p> */}
              {/* </div> */}

              <div className="space-y-2">
                <Label htmlFor="file-input">ZIP File</Label>
                <input
                  ref={uploadFileInputRef}
                  id="file-input"
                  name="project"
                  type="file"
                  accept=".zip,application/zip"
                  onChange={handleFileSelect}
                  className="sr-only"
                  aria-label="Choose ZIP file"
                />
                <label
                  htmlFor="file-input"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-all duration-200 ${
                    isDragActive
                      ? "border-primary bg-primary/5"
                      : uploadFile
                        ? "border-emerald-300 bg-emerald-50/50"
                        : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-100/50"
                  }`}
                >
                  {uploadFile ? (
                    <>
                      <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                        <FileArchive className="size-6" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium text-slate-800">
                          {uploadFile.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {(uploadFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <p className="text-xs text-slate-500">
                        Click or drop a new file to replace
                      </p>
                    </>
                  ) : (
                    <>
                      <div
                        className={`flex size-12 items-center justify-center rounded-full ${
                          isDragActive
                            ? "bg-primary/10 text-primary"
                            : "bg-slate-200 text-slate-500"
                        }`}
                      >
                        <Upload className="size-6" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium text-slate-700">
                          {isDragActive
                            ? "Drop your ZIP file here"
                            : "Drop your ZIP file here or click to browse"}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Only .zip files, max 50MB
                        </p>
                      </div>
                    </>
                  )}
                </label>
              </div>

              {uploading && (
                <div>
                  <div className="flex justify-between mb-2 text-sm text-slate-700">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {uploadStatus && (
                <div
                  className={`p-3 rounded-lg border text-sm ${
                    uploadStatus.includes("Upload successful")
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : uploadStatus.includes("Upload failed")
                        ? "bg-red-50 border-red-200 text-red-800"
                        : "bg-blue-50 border-blue-200 text-blue-800"
                  }`}
                >
                  {uploadStatus}
                  {uploadStatus.includes("Upload successful") &&
                    uploadSuccessBuildUrl && (
                      <>
                        {" "}
                        <a
                          href={uploadSuccessBuildUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline font-medium hover:opacity-80 break-all"
                        >
                          {uploadSuccessBuildUrl}
                        </a>
                      </>
                    )}
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetUploadForm}
                  disabled={uploading}
                >
                  Clear
                </Button>
                <Button
                  type="submit"
                  className="text-white"
                  disabled={uploading || !selectedRelease || !uploadFile}
                >
                  {uploading ? (
                    <>
                      <Spinner /> Uploading
                    </>
                  ) : (
                    "Upload & Build"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      <Dialog
        open={!!statusConfirm}
        onOpenChange={(open) => {
          if (!open && !statusConfirmSubmitting) setStatusConfirm(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change release status?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-1 text-sm text-slate-600">
                <p>
                  <span className="font-medium text-slate-900">
                    {statusConfirm?.releaseName}
                  </span>{" "}
                  will change from{" "}
                  <span className="font-semibold text-slate-800">
                    {statusConfirm
                      ? releaseStatusLabel(statusConfirm.fromStatus)
                      : ""}
                  </span>{" "}
                  to{" "}
                  <span className="font-semibold text-slate-800">
                    {statusConfirm
                      ? releaseStatusLabel(statusConfirm.toStatus)
                      : ""}
                  </span>
                  .
                </p>
                {statusConfirm?.toStatus === "locked" && (
                  <p className="rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-amber-950/90">
                    Uploads will be disabled for this release while it is
                    locked.
                  </p>
                )}
                {statusConfirm?.toStatus === "active" &&
                  blockActivateUntilOtherLocked && (
                    <p
                      role="alert"
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-900"
                    >
                      Lock current active release before activating this
                      version
                      {conflictingActiveRelease?.name ? (
                        <span className="mt-1 block text-xs font-normal text-rose-800/90">
                          Current Active release:{" "}
                          <span className="font-semibold">
                            {conflictingActiveRelease.name}
                          </span>
                        </span>
                      ) : null}
                    </p>
                  )}
                {statusConfirm?.toStatus === "active" &&
                  !blockActivateUntilOtherLocked && (
                    <p className="rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2 text-slate-700">
                      This will be the active release for the project. It may take some time to activate, as it also updates the client link.
                    </p>
                  )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStatusConfirm(null)}
              disabled={statusConfirmSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="text-white"
              onClick={confirmStatusChange}
              disabled={
                statusConfirmSubmitting || blockActivateUntilOtherLocked
              }
            >
              {statusConfirmSubmitting ? (
                <>
                  <Spinner /> Applying…
                </>
              ) : (
                "Confirm change"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReleaseManagement;
