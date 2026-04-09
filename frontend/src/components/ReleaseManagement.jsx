import React, { useEffect, useMemo, useRef, useState } from "react";
import { format, startOfDay } from "date-fns";
import {
  fetchReleases,
  createRelease,
  updateReleaseStatus,
  uploadToRelease,
  patchRelease,
  fetchReleaseChangelog,
  regenerateReleaseReviewSummary,
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
  CalendarDays,
  Sparkles,
  History,
  Pencil,
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
import { Checkbox } from "./ui/checkbox";
import { Textarea } from "./ui/textarea";
import { SelectActiveVersion } from "./SelectActiveVersion";
import { HubProfileAvatar } from "./HubProfileAvatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { formatProjectVersionLabel } from "../lib/utils";
import { storageStringToEmailsArray } from "../utils/emailList";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { DatePickerWithRange } from "./ui/date-range-picker";
import { DatePickerSingle } from "./ui/date-picker-single";
import { cn } from "@/lib/utils";

const RELEASE_STATUS_CHANGELOG_LABELS = {
  draft: "Draft",
  active: "Active",
  locked: "Locked",
  skip: "Skip",
};

const CHANGELOG_FIELD_LABELS = {
  status: "Status",
  releaseDate: "Target release",
  actualReleaseDate: "Actual release",
  actualReleaseNotes: "Actual release notes",
  startDate: "Start date",
  name: "Name",
  description: "Description",
  isMvp: "MVP",
  lockedBy: "Locked by",
  clientReleaseNote: "Client release note",
  clientReviewAiSummary: "Review checklist (client link)",
  showClientReviewSummary: "Show checklist on client link",
  clientReviewAiGenerationContext: "AI-only instructions (not shown to clients)",
};

function actualShipDateChanged(prevDate, nextDate) {
  const p =
    prevDate instanceof Date && !Number.isNaN(prevDate.getTime())
      ? startOfDay(prevDate).getTime()
      : null;
  const n =
    nextDate instanceof Date && !Number.isNaN(nextDate.getTime())
      ? startOfDay(nextDate).getTime()
      : null;
  return p !== n;
}

function formatReadableDate(value) {
  if (value == null || value === "") return "—";
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return format(d, "MMMM d, yyyy");
  } catch {
    return String(value);
  }
}

function formatChangelogTimestamp(iso) {
  if (!iso) return "";
  try {
    return format(new Date(iso), "MMM d, yyyy 'at' h:mm a");
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function formatChangelogScalar(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const key = value.toLowerCase();
    if (RELEASE_STATUS_CHANGELOG_LABELS[value])
      return RELEASE_STATUS_CHANGELOG_LABELS[value];
    if (RELEASE_STATUS_CHANGELOG_LABELS[key])
      return RELEASE_STATUS_CHANGELOG_LABELS[key];
    if (/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value)))
      return formatReadableDate(value);
    return value;
  }
  return String(value);
}

function changelogFieldLabel(key) {
  return (
    CHANGELOG_FIELD_LABELS[key] ??
    key.replace(/([A-Z])/g, " $1").replace(/^s./, (c) => c.toUpperCase())
  );
}

const RELEASE_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "locked", label: "Locked" },
  { value: "skip", label: "Skip" },
];

function normalizeReleaseStatus(release) {
  const s = String(release?.status ?? "draft").toLowerCase();
  return ["draft", "active", "locked", "skip"].includes(s) ? s : "draft";
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
    case "skip":
      return "bg-gradient-to-r from-violet-500 to-indigo-500";
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
      hint: "Cannot be unlocked here. View this release by choosing a version on the client link.",
      pillClass:
        "bg-gradient-to-r from-rose-50 to-orange-50 text-rose-900 ring-1 ring-rose-200/70 shadow-sm shadow-rose-500/5",
      dotClass: "bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.2)]",
    };
  }
  if (s === "skip") {
    return {
      label: "Skip",
      hint: "Marked as not shipping this cycle — change status anytime if plans change",
      pillClass:
        "bg-gradient-to-r from-violet-50 to-indigo-50 text-indigo-950 ring-1 ring-violet-200/70 shadow-sm shadow-violet-500/5",
      dotClass: "bg-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.25)]",
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

const RELEASE_DOT_VERSION_RE = /^\d+(?:\.\d+)+$/;

function parseReleaseNameToTuple(name) {
  const n = name?.trim();
  if (!n || !RELEASE_DOT_VERSION_RE.test(n)) return null;
  return n.split(".").map((p) => parseInt(p, 10));
}

function compareTuples(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function bumpLastSegment(tuple) {
  const next = [...tuple];
  next[next.length - 1] += 1;
  return next;
}

function maxReleaseTupleFromList(releasesList) {
  let maxTuple = null;
  for (const r of releasesList) {
    const t = parseReleaseNameToTuple(r?.name);
    if (!t) continue;
    if (!maxTuple || compareTuples(t, maxTuple) > 0) maxTuple = t;
  }
  return maxTuple;
}

/** Default patch bump for placeholder / autofill (any greater version is allowed). */
function getSuggestedPatchReleaseNameFromList(releasesList) {
  const maxTuple = maxReleaseTupleFromList(releasesList);
  if (!maxTuple) return "1.0.0";
  return bumpLastSegment(maxTuple).map(String).join(".");
}

function normalizeEmailForAccess(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Aligns with backend: admin, project creator, or assignedUserEmails. */
function userCanManageReleasesForProject(user, project) {
  if (!user) return false;
  if (user.role === "admin") return true;
  const creatorId = project?.createdBy?.id ?? project?.createdById;
  if (creatorId != null && Number(user.id) === Number(creatorId)) return true;
  const userEmail = normalizeEmailForAccess(user.email);
  if (!userEmail) return false;
  const assigned = storageStringToEmailsArray(project?.assignedUserEmails);
  return assigned.some((a) => normalizeEmailForAccess(a) === userEmail);
}

const ReleaseManagement = ({ projectId, projectName, project }) => {
  const { user } = useAuth();
  const canManageReleases = project
    ? userCanManageReleasesForProject(user, project)
    : user?.role === "admin";
  /** Edit release uses the same gate as Create Release. */
  const canEditRelease = canManageReleases;

  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  const uploadFileInputRef = useRef(null);

  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [statusConfirm, setStatusConfirm] = useState(null);
  const [statusConfirmSubmitting, setStatusConfirmSubmitting] = useState(false);

  const [newRelease, setNewRelease] = useState({
    name: "",
    description: "",
    startDate: null,
    releaseDate: null,
    actualReleaseDate: null,
    actualReleaseNotes: "",
    isMvp: false,
    clientReleaseNote: "",
  });

  const [editDialog, setEditDialog] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [aiSummaryRegenerating, setAiSummaryRegenerating] = useState(false);

  const [changelogByRelease, setChangelogByRelease] = useState({});
  const [changelogLoadingId, setChangelogLoadingId] = useState(null);

  const latestReleaseTuple = useMemo(
    () => maxReleaseTupleFromList(releases),
    [releases],
  );

  const suggestedPatchReleaseName = useMemo(
    () => getSuggestedPatchReleaseNameFromList(releases),
    [releases],
  );

  const lastRelease = latestReleaseTuple
    ? latestReleaseTuple.map(String).join(".")
    : null;

  const openCreateReleaseDialog = () => {
    if (!canManageReleases) return;
    setNewRelease({
      name: suggestedPatchReleaseName,
      description: "",
      startDate: null,
      releaseDate: null,
      actualReleaseDate: null,
      actualReleaseNotes: "",
      isMvp: false,
      clientReleaseNote: "",
    });
    setShowCreateForm(true);
  };

  useEffect(() => {
    if (projectId) {
      loadReleases();
    }
  }, [projectId]);

  useEffect(() => {
    if (!canManageReleases) {
      setShowCreateForm(false);
      setEditDialog(null);
    }
  }, [canManageReleases]);

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

  const loadChangelog = async (releaseId) => {
    setChangelogLoadingId(releaseId);
    try {
      const data = await fetchReleaseChangelog(releaseId);
      setChangelogByRelease((prev) => ({ ...prev, [releaseId]: data }));
    } catch (err) {
      toast.error(err.error || "Failed to load history");
    } finally {
      setChangelogLoadingId(null);
    }
  };

  const openEditRelease = (release) => {
    if (!canEditRelease) return;
    setEditDialog({
      id: release.id,
      name: release.name ?? "",
      description: release.description ?? "",
      isMvp: !!release.isMvp,
      startDate: release.startDate ? new Date(release.startDate) : null,
      releaseDate: release.releaseDate ? new Date(release.releaseDate) : null,
      actualReleaseDate: release.actualReleaseDate
        ? new Date(release.actualReleaseDate)
        : null,
      actualReleaseNotes: release.actualReleaseNotes ?? "",
      clientReleaseNote: release.clientReleaseNote ?? "",
      clientReviewAiSummary: release.clientReviewAiSummary ?? "",
      clientReviewAiSummaryAt: release.clientReviewAiSummaryAt ?? null,
      showClientReviewSummary: release.showClientReviewSummary !== false,
      clientReviewAiGenerationContext:
        release.clientReviewAiGenerationContext ?? "",
      isLocked: isReleaseLocked(release),
      reason: "",
    });
  };

  const handleRegenerateClientReviewSummary = async () => {
    if (!editDialog?.id) return;
    setAiSummaryRegenerating(true);
    try {
      const data = await regenerateReleaseReviewSummary(editDialog.id, {
        clientReviewAiGenerationContext:
          editDialog.clientReviewAiGenerationContext ?? "",
      });
      if (data.ok) {
        toast.success("Review checklist updated");
      } else {
        toast.error(data.error || "Could not generate checklist");
      }
      const rel = data.release;
      if (rel && editDialog && Number(rel.id) === Number(editDialog.id)) {
        setEditDialog((prev) =>
          prev
            ? {
                ...prev,
                clientReviewAiSummary: rel.clientReviewAiSummary ?? "",
                clientReviewAiSummaryAt: rel.clientReviewAiSummaryAt ?? null,
                showClientReviewSummary:
                  rel.showClientReviewSummary !== false,
                clientReviewAiGenerationContext:
                  rel.clientReviewAiGenerationContext ?? "",
              }
            : prev,
        );
      }
      await loadReleases();
    } catch (err) {
      toast.error(err.error || err.message || "Failed to generate checklist");
    } finally {
      setAiSummaryRegenerating(false);
    }
  };

  const saveEditRelease = async (e) => {
    e.preventDefault();
    if (!editDialog) return;
    const noteTrimmed = editDialog.clientReleaseNote.trim() || null;
    const reviewSummaryTrimmed =
      editDialog.clientReviewAiSummary.trim() || null;
    const aiContextTrimmed =
      editDialog.clientReviewAiGenerationContext.trim() || null;
    const clientLinkPayload = {
      clientReleaseNote: noteTrimmed,
      clientReviewAiSummary: reviewSummaryTrimmed,
      showClientReviewSummary: editDialog.showClientReviewSummary === true,
      clientReviewAiGenerationContext: aiContextTrimmed,
    };
    const payload = editDialog.isLocked
      ? clientLinkPayload
      : {
        description: editDialog.description.trim() || null,
        isMvp: editDialog.isMvp,
        startDate: editDialog.startDate
          ? format(editDialog.startDate, "yyyy-MM-dd")
          : null,
        releaseDate: editDialog.releaseDate
          ? format(editDialog.releaseDate, "yyyy-MM-dd")
          : null,
        actualReleaseDate: editDialog.actualReleaseDate
          ? format(editDialog.actualReleaseDate, "yyyy-MM-dd")
          : null,
        actualReleaseNotes:
          editDialog.actualReleaseNotes.trim() || null,
        ...clientLinkPayload,
        reason: editDialog.reason.trim(),
      };
    try {
      setEditSaving(true);
      await patchRelease(editDialog.id, payload);
      toast.success(
        editDialog.isLocked
          ? "Client link notes saved"
          : "Release updated",
      );
      const rid = editDialog.id;
      setEditDialog(null);
      await loadReleases();
      setChangelogByRelease((prev) => {
        const next = { ...prev };
        delete next[rid];
        return next;
      });
    } catch (err) {
      toast.error(err.error || "Failed to update release");
    } finally {
      setEditSaving(false);
    }
  };

  const handleCreateRelease = async (e) => {
    e.preventDefault();
    const name = newRelease.name.trim();
    if (!name) return;
    const submitted = parseReleaseNameToTuple(name);
    if (!submitted) {
      toast.error(
        "Use dot-separated numbers with at least two segments (e.g. 1.0.0, 1.1.0).",
      );
      return;
    }
    if (
      latestReleaseTuple &&
      compareTuples(submitted, latestReleaseTuple) <= 0
    ) {
      const latestStr = latestReleaseTuple.map(String).join(".");
      toast.error(
        `Release name must be greater than the latest: ${latestStr} (e.g. 1.0.3, 1.1.0, or 2.0.0).`,
      );
      return;
    }

    try {
      setCreating(true);

      const releaseData = {
        projectId: Number(projectId),
        name,
        description: newRelease.description.trim() || null,
        startDate: newRelease.startDate
          ? format(newRelease.startDate, "yyyy-MM-dd")
          : null,
        releaseDate: newRelease.releaseDate
          ? format(newRelease.releaseDate, "yyyy-MM-dd")
          : null,
        actualReleaseDate: newRelease.actualReleaseDate
          ? format(newRelease.actualReleaseDate, "yyyy-MM-dd")
          : null,
        actualReleaseNotes: newRelease.actualReleaseNotes.trim() || null,
        isMvp: newRelease.isMvp,
        clientReleaseNote: newRelease.clientReleaseNote.trim() || null,
      };
      await createRelease(releaseData);
      setNewRelease({
        name: "",
        description: "",
        startDate: null,
        releaseDate: null,
        actualReleaseDate: null,
        actualReleaseNotes: "",
        isMvp: false,
        clientReleaseNote: "",
      });
      setShowCreateForm(false);
      await loadReleases();
      toast.success(`Release "${name}" created successfully!`);
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
    if (isReleaseLocked(rel)) return;
    setStatusConfirm({
      releaseId,
      releaseName: rel.name,
      fromStatus: normalizeReleaseStatus(rel),
      toStatus: newStatus,
      statusReason: "",
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
    const reason = (statusConfirm.statusReason || "").trim();
    if (toStatus !== "locked" && !reason) {
      toast.error("Please enter a reason for this status change.");
      return;
    }

    try {
      setStatusConfirmSubmitting(true);
      setStatusUpdatingId(releaseId);
      await updateReleaseStatus(
        releaseId,
        toStatus,
        toStatus === "locked" ? undefined : reason,
      );
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

      const result = await uploadToRelease(selectedRelease, fileToUpload);

      console.log("upload release result", result);

      clearInterval(progressInterval);
      setUploadProgress(100);

      const revisionLabel = formatProjectVersionLabel(result?.version);
      await loadReleases();
      toast.success(
        `ZIP uploaded successfully. Revision: ${revisionLabel}`,
      );
      setShowUploadForm(false);
      resetUploadForm();
    } catch (err) {
      const errorMessage = err.error || err.message || "Upload failed";
      setUploadStatus(`Upload failed: ${errorMessage}`);
      toast.error(`Upload failed: ${errorMessage}`);
    } finally {
      setUploading(false);
    }
  };

  const resetUploadForm = () => {
    setSelectedRelease("");
    setUploadFile(null);
    setUploadStatus("");
    setUploadProgress(0);
    if (uploadFileInputRef.current) uploadFileInputRef.current.value = "";
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
            onClick={openCreateReleaseDialog}
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
                    onClick={openCreateReleaseDialog}
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
                          <div className="flex flex-col items-start gap-2">
                            <div className="flex min-w-0 max-w-full items-center gap-2">
                              <h4 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                                {release.name}
                              </h4>
                              {release.isMvp ? (
                                <Badge
                                  className="bg-primary font-bold text-white"
                                >
                                  MVP
                                </Badge>
                              ) : null}
                            </div>
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
                          <div className="flex flex-col items-start gap-2 border-t border-slate-100/80 pt-3 text-xs sm:ml-auto sm:shrink-0 sm:max-w-md sm:border-t-0 sm:pt-0">
                            <div className="flex w-full items-center gap-2 rounded-lg bg-slate-100/70 px-2.5 py-1.5 text-slate-700 ring-1 ring-slate-200/60">
                              <CalendarDays
                                className="size-3.5 shrink-0 text-slate-500"
                                aria-hidden
                              />
                              <span className="min-w-0 font-semibold text-slate-900">
                                <time dateTime={release.startDate ?? undefined}>
                                  {formatReadableDate(release.startDate)}
                                </time>
                                <span className="mx-1 font-normal text-slate-400">
                                  →
                                </span>
                                <time
                                  dateTime={release.releaseDate ?? undefined}
                                >
                                  {formatReadableDate(release.releaseDate)}
                                </time>
                              </span>
                            </div>
                            <div className="flex gap-2">
                              {canEditRelease && (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="w-fit gap-2 bg-slate-100/70 text-slate-700 ring-1 ring-slate-200/60"
                                  onClick={() => openEditRelease(release)}
                                >
                                  <Pencil className="size-3.5" />
                                  {isReleaseLocked(release)
                                    ? "Edit release (notes)"
                                    : "Edit Release"}
                                </Button>
                              )}
                              <span className="inline-flex min-w-0 max-w-full items-center gap-2 sm:max-w-44 md:max-w-52">
                                <HubProfileAvatar
                                  email={release.creator?.email}
                                  alt={release.creator?.name ?? ""}
                                  className="size-5"
                                  fallbackClassName="rounded-md"
                                />
                                <span className="truncate">
                                  {release.creator?.name ?? "—"}
                                </span>
                              </span>
                            </div>
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
                          <Collapsible
                            onOpenChange={(open) => {
                              if (
                                open &&
                                !changelogByRelease[release.id] &&
                                changelogLoadingId !== release.id
                              ) {
                                loadChangelog(release.id);
                              }
                            }}
                          >
                            <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100/80">
                              <History className="size-3.5 shrink-0" />
                              Change history
                              <ChevronDown className="ml-auto size-4 shrink-0 opacity-60" />
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-2">
                              {changelogLoadingId === release.id ? (
                                <div className="flex justify-center py-4">
                                  <Spinner />
                                </div>
                              ) : (
                                <ul className="max-h-80 space-y-3 overflow-y-auto pr-0.5">
                                  {(changelogByRelease[release.id] || [])
                                    .length === 0 ? (
                                    <li className="rounded-md border border-dashed border-slate-200 bg-slate-50/80 px-3 py-4 text-center text-sm text-slate-500">
                                      No changes recorded yet.
                                    </li>
                                  ) : (
                                    (changelogByRelease[release.id] || []).map(
                                      (log) => (
                                        <li
                                          key={log.id}
                                          className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-sm"
                                        >
                                          <div className="flex flex-col gap-1 border-b border-slate-100 bg-slate-50/90 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                                            <span className="text-sm font-semibold text-slate-900">
                                              {log.changedBy?.name ||
                                                log.changedByEmail ||
                                                "Unknown"}
                                            </span>
                                            <time
                                              className="text-xs text-slate-500"
                                              dateTime={log.createdAt}
                                            >
                                              {formatChangelogTimestamp(
                                                log.createdAt,
                                              )}
                                            </time>
                                          </div>
                                          <div className="px-3 py-2">
                                            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                                              Reason
                                            </p>
                                            <p className="mt-0.5 text-sm leading-relaxed text-slate-700">
                                              {log.reason}
                                            </p>
                                          </div>
                                          {log.changes &&
                                            typeof log.changes === "object" &&
                                            Object.keys(log.changes).length >
                                            0 ? (
                                            <div className="border-t border-slate-100 px-2 py-2">
                                              <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                                                What changed
                                              </p>
                                              <div className="overflow-x-auto rounded-md border border-slate-100">
                                                <table className="w-full min-w-[280px] text-left text-xs">
                                                  <thead>
                                                    <tr className="border-b border-slate-100 bg-slate-50/80 text-slate-600">
                                                      <th className="px-2 py-1.5 font-semibold">
                                                        Field
                                                      </th>
                                                      <th className="px-2 py-1.5 font-semibold">
                                                        Before
                                                      </th>
                                                      <th className="px-2 py-1.5 font-semibold">
                                                        After
                                                      </th>
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {Object.entries(
                                                      log.changes,
                                                    ).map(([key, val]) => {
                                                      const isDiff =
                                                        val &&
                                                        typeof val ===
                                                        "object" &&
                                                        "from" in val &&
                                                        "to" in val;
                                                      return (
                                                        <tr
                                                          key={key}
                                                          className="border-b border-slate-50 last:border-0"
                                                        >
                                                          <td className="px-2 py-2 align-top font-medium text-slate-800">
                                                            {changelogFieldLabel(
                                                              key,
                                                            )}
                                                          </td>
                                                          <td className="px-2 py-2 align-top text-slate-600">
                                                            {isDiff
                                                              ? formatChangelogScalar(
                                                                val.from,
                                                              )
                                                              : formatChangelogScalar(
                                                                val,
                                                              )}
                                                          </td>
                                                          <td className="px-2 py-2 align-top text-slate-900">
                                                            {isDiff
                                                              ? formatChangelogScalar(
                                                                val.to,
                                                              )
                                                              : "—"}
                                                          </td>
                                                        </tr>
                                                      );
                                                    })}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </div>
                                          ) : null}
                                        </li>
                                      ),
                                    )
                                  )}
                                </ul>
                              )}
                            </CollapsibleContent>
                          </Collapsible>
                        )}

                        {canManageReleases && (
                          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-end sm:gap-6">
                              <div className="flex min-w-0 flex-col gap-1.5">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                  Set status
                                </span>
                                {isReleaseLocked(release) ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex w-full">
                                        <Select
                                          value={normalizeReleaseStatus(
                                            release,
                                          )}
                                          disabled
                                        >
                                          <SelectTrigger className="h-10 w-full cursor-not-allowed border-slate-200 bg-slate-50/90 text-slate-500 opacity-90 shadow-none hover:border-slate-200 hover:bg-slate-50/90">
                                            <SelectValue placeholder="Status" />
                                          </SelectTrigger>
                                          <SelectContent align="start">
                                            {RELEASE_STATUS_OPTIONS.map(
                                              (opt) => (
                                                <SelectItem
                                                  key={opt.value}
                                                  value={opt.value}
                                                >
                                                  {opt.label}
                                                </SelectItem>
                                              ),
                                            )}
                                          </SelectContent>
                                        </Select>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="top"
                                      className="max-w-[280px] text-left leading-snug"
                                    >
                                      This release is locked! You cannot unlock
                                      it. You can still view this release by
                                      selecting a version from the client link.
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
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
                                )}
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
                                      className="max-w-[260px] text-center leading-snug"
                                    >
                                      Uploads are disabled while this release is
                                      locked. Locked releases cannot be unlocked
                                      here; view this release from the client
                                      link version selector.
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
                                  Revision history
                                </span>
                                <span className="text-sm text-slate-500">
                                  {release.versions.length} revision
                                  {release.versions.length !== 1 ? "s" : ""}
                                </span>
                                <div className="text-sm">
                                  <span className="text-slate-400">Latest</span>
                                  <span className="ml-1.5 text-sm text-slate-700">
                                    {formatProjectVersionLabel(
                                      release.versions[0].version,
                                    )}
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
                                          {formatProjectVersionLabel(
                                            version.version,
                                          )}
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
      <Dialog
        open={canManageReleases && showCreateForm}
        onOpenChange={setShowCreateForm}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
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
                placeholder={suggestedPatchReleaseName}
                required
              />
              <p className="text-xs text-slate-500">
                {lastRelease ? (
                  <>
                    Last release is{" "}
                    <span className="font-mono font-medium text-slate-700">
                      {lastRelease}
                    </span>
                    . The new release name must be greater than this. Suggested
                    patch:{" "}
                    <span className="font-mono font-medium text-slate-700">
                      {suggestedPatchReleaseName}
                    </span>
                    .
                  </>
                ) : (
                  <>
                    Use a dot-separated version (e.g.{" "}
                    <span className="font-mono font-medium text-slate-700">
                      1.0.0
                    </span>
                    ).
                  </>
                )}
              </p>
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

            <div className="space-y-2">
              <Label>Schedule (start → target release)</Label>
              <p className="text-xs text-slate-500">
                Choose the start date, then the target release date. Both are
                saved as separate fields.
              </p>
              <DatePickerWithRange
                className={cn(
                  "h-10 w-full border-slate-200 bg-white hover:bg-slate-50/90",
                  !newRelease.startDate &&
                  !newRelease.releaseDate &&
                  "text-muted-foreground",
                )}
                date={
                  newRelease.startDate || newRelease.releaseDate
                    ? {
                      from: newRelease.startDate ?? undefined,
                      to: newRelease.releaseDate ?? undefined,
                    }
                    : undefined
                }
                setDate={(range) => {
                  setNewRelease((prev) => ({
                    ...prev,
                    startDate: range?.from ?? null,
                    releaseDate: range?.to ?? null,
                  }));
                }}
              />
              {(newRelease.startDate || newRelease.releaseDate) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-slate-500"
                  onClick={() =>
                    setNewRelease((prev) => ({
                      ...prev,
                      startDate: null,
                      releaseDate: null,
                    }))
                  }
                >
                  Clear schedule
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <Label>Actual release date (optional)</Label>
              <p className="text-xs text-slate-500">
                When the release actually shipped. Shown on the release roadmap
                next to the planned target date.
              </p>
              <DatePickerSingle
                className="h-10 w-full max-w-md border-slate-200 bg-white hover:bg-slate-50/90"
                date={newRelease.actualReleaseDate}
                onDateChange={(d) => {
                  setNewRelease((prev) => {
                    if (
                      actualShipDateChanged(prev.actualReleaseDate, d) &&
                      d
                    ) {
                      toast.message(
                        "Optional: add actual release notes below for this ship date.",
                        { duration: 5000 },
                      );
                    }
                    return { ...prev, actualReleaseDate: d };
                  });
                }}
                placeholder="Not set"
              />
              {newRelease.actualReleaseDate && (
                <>
                  <div className="space-y-2 pt-1">
                    <Label htmlFor="new-actual-release-notes">
                      Actual release notes (optional)
                    </Label>
                    <Textarea
                      id="new-actual-release-notes"
                      rows={3}
                      placeholder="e.g. What shipped, caveats, or rollout notes."
                      value={newRelease.actualReleaseNotes}
                      onChange={(e) =>
                        setNewRelease((prev) => ({
                          ...prev,
                          actualReleaseNotes: e.target.value,
                        }))
                      }
                      className="resize-y min-h-[72px]"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-slate-500"
                    onClick={() =>
                      setNewRelease((prev) => ({
                        ...prev,
                        actualReleaseDate: null,
                        actualReleaseNotes: "",
                      }))
                    }
                  >
                    Clear actual date
                  </Button>
                </>
              )}
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-3">
              <Checkbox
                id="release-is-mvp"
                checked={newRelease.isMvp}
                onCheckedChange={(checked) =>
                  setNewRelease((prev) => ({
                    ...prev,
                    isMvp: checked === true,
                  }))
                }
                className="mt-0.5"
              />
              <div className="grid gap-1 leading-none">
                <Label
                  htmlFor="release-is-mvp"
                  className="cursor-pointer text-sm font-medium text-slate-900"
                >
                  MVP release
                </Label>
              </div>
            </div>

            <div className="space-y-3 rounded-lg">
              <div className="space-y-2">
                <Label htmlFor="new-client-release-note">Notes for clients</Label>
                <Textarea
                  id="new-client-release-note"
                  rows={3}
                  placeholder="e.g. Do not test billing — out of scope for this build."
                  value={newRelease.clientReleaseNote}
                  onChange={(e) =>
                    setNewRelease((prev) => ({
                      ...prev,
                      clientReleaseNote: e.target.value,
                    }))
                  }
                  className="resize-y min-h-[72px]"
                />
              </div>
            </div>

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

      <Dialog
        open={canEditRelease && !!editDialog}
        onOpenChange={(open) => {
          if (!open && !editSaving) setEditDialog(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit release</DialogTitle>
            <DialogDescription>
              {editDialog?.isLocked ? (
                <>
                  This release is <strong>locked</strong>. You can only update
                  notes shown on the public client link. Git change summary on
                  that page still comes from the repo automatically.
                </>
              ) : (
                <>
                  Release name cannot be changed. Other updates are saved with an
                  audit entry when something actually changes (reason required
                  when updating description, schedule, MVP, or dates—not for
                  client link notes alone).
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {editDialog ? (
            <form onSubmit={saveEditRelease} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-release-name">Release name</Label>
                <Input
                  id="edit-release-name"
                  value={editDialog.name}
                  readOnly
                  disabled
                  className="cursor-not-allowed bg-slate-100 text-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-release-desc">Description</Label>
                <Textarea
                  id="edit-release-desc"
                  rows={3}
                  value={editDialog.description}
                  disabled={editDialog.isLocked}
                  onChange={(e) =>
                    setEditDialog((prev) =>
                      prev ? { ...prev, description: e.target.value } : prev,
                    )
                  }
                  className={
                    editDialog.isLocked ? "cursor-not-allowed bg-slate-50" : ""
                  }
                />
              </div>
              <div
                className={
                  editDialog.isLocked
                    ? "pointer-events-none space-y-2 opacity-60"
                    : "space-y-2"
                }
              >
                <Label>Schedule (start → target release)</Label>
                <p className="text-xs text-slate-500">
                  Same as create: pick start, then target. Stored as{" "}
                  <code className="rounded bg-slate-100 px-1 text-[11px]">
                    startDate
                  </code>{" "}
                  and{" "}
                  <code className="rounded bg-slate-100 px-1 text-[11px]">
                    releaseDate
                  </code>
                  .
                </p>
                <DatePickerWithRange
                  className={cn(
                    "h-10 w-full border-slate-200 bg-white hover:bg-slate-50/90",
                    !editDialog.startDate &&
                    !editDialog.releaseDate &&
                    "text-muted-foreground",
                  )}
                  date={
                    editDialog.startDate || editDialog.releaseDate
                      ? {
                        from: editDialog.startDate ?? undefined,
                        to: editDialog.releaseDate ?? undefined,
                      }
                      : undefined
                  }
                  setDate={(range) => {
                    setEditDialog((prev) =>
                      prev
                        ? {
                          ...prev,
                          startDate: range?.from ?? null,
                          releaseDate: range?.to ?? null,
                        }
                        : prev,
                    );
                  }}
                />
                {(editDialog.startDate || editDialog.releaseDate) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-slate-500"
                    onClick={() =>
                      setEditDialog((prev) =>
                        prev
                          ? {
                            ...prev,
                            startDate: null,
                            releaseDate: null,
                          }
                          : prev,
                      )
                    }
                  >
                    Clear schedule
                  </Button>
                )}
                <div className="space-y-2 pt-2 border-t border-slate-100 mt-2">
                  <Label>Actual release date (optional)</Label>
                  <p className="text-xs text-slate-500">
                    When the release actually shipped. Used on the release
                    roadmap.
                  </p>
                  <DatePickerSingle
                    className="h-10 w-full max-w-md border-slate-200 bg-white hover:bg-slate-50/90"
                    date={editDialog.actualReleaseDate}
                    disabled={editDialog.isLocked}
                    onDateChange={(d) => {
                      setEditDialog((prev) => {
                        if (!prev) return prev;
                        if (
                          !prev.isLocked &&
                          actualShipDateChanged(prev.actualReleaseDate, d) &&
                          d
                        ) {
                          toast.message(
                            "Optional: add actual release notes below for this ship date.",
                            { duration: 5000 },
                          );
                        }
                        return { ...prev, actualReleaseDate: d };
                      });
                    }}
                    placeholder="Not set"
                  />
                  {editDialog.actualReleaseDate && !editDialog.isLocked && (
                    <>
                      <div className="space-y-2 pt-2">
                        <Label htmlFor="edit-actual-release-notes">
                          Actual release notes (optional)
                        </Label>
                        <Textarea
                          id="edit-actual-release-notes"
                          rows={3}
                          placeholder="e.g. What shipped, caveats, or rollout notes."
                          value={editDialog.actualReleaseNotes}
                          onChange={(e) =>
                            setEditDialog((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    actualReleaseNotes: e.target.value,
                                  }
                                : prev,
                            )
                          }
                          className="resize-y min-h-[72px]"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-slate-500"
                        onClick={() =>
                          setEditDialog((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  actualReleaseDate: null,
                                  actualReleaseNotes: "",
                                }
                              : prev,
                          )
                        }
                      >
                        Clear actual date
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-3">
                <Checkbox
                  id="edit-is-mvp"
                  checked={editDialog.isMvp}
                  disabled={editDialog.isLocked}
                  onCheckedChange={(checked) =>
                    setEditDialog((prev) =>
                      prev ? { ...prev, isMvp: checked === true } : prev,
                    )
                  }
                  className="mt-0.5"
                />
                <Label htmlFor="edit-is-mvp" className="cursor-pointer text-sm">
                  MVP release
                </Label>
              </div>

              {!editDialog.isLocked ? (
                <div className="space-y-2">
                  <Label htmlFor="edit-reason">Reason</Label>
                  <Textarea
                    id="edit-reason"
                    rows={2}
                    placeholder="Required if you change description, schedule, MVP, or dates"
                    value={editDialog.reason}
                    onChange={(e) =>
                      setEditDialog((prev) =>
                        prev ? { ...prev, reason: e.target.value } : prev,
                      )
                    }
                  />
                </div>
              ) : null}
              <div className="space-y-3 rounded-lg">
                <div className="space-y-2">
                  <Label htmlFor="edit-client-release-note">
                    Notes for clients (optional)
                  </Label>
                  <p className="text-xs text-slate-500">
                    Shown in <span className="font-medium">Release note</span> on
                    the client link — scope, caveats, what not to test.
                  </p>
                  <Textarea
                    id="edit-client-release-note"
                    rows={3}
                    placeholder="e.g. Do not test billing — out of scope for this build."
                    value={editDialog.clientReleaseNote}
                    onChange={(e) =>
                      setEditDialog((prev) =>
                        prev
                          ? { ...prev, clientReleaseNote: e.target.value }
                          : prev,
                      )
                    }
                    className="resize-y min-h-[72px]"
                  />
                </div>

                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="space-y-1">
                    <Label htmlFor="edit-client-review-summary">
                      Review checklist (optional)
                    </Label>
                    <p className="text-xs text-slate-600">
                      Same content as <span className="font-medium">What to review</span>{" "}
                      on the client link when you turn on the option below. Write it
                      yourself or use <span className="font-medium">Generate with AI</span>{" "}
                      from this release (roadmap, versions, and release details).
                    </p>
                  </div>
                  <Textarea
                    id="edit-client-review-summary"
                    rows={6}
                    placeholder="Bullet list of what clients should verify — or click Generate with AI."
                    value={editDialog.clientReviewAiSummary}
                    onChange={(e) =>
                      setEditDialog((prev) =>
                        prev
                          ? {
                              ...prev,
                              clientReviewAiSummary: e.target.value,
                            }
                          : prev,
                      )
                    }
                    className="resize-y min-h-[120px] border-white/80 bg-white font-mono text-sm"
                  />
                  <div className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2">
                    <Checkbox
                      id="edit-show-client-review"
                      checked={editDialog.showClientReviewSummary === true}
                      onCheckedChange={(checked) =>
                        setEditDialog((prev) =>
                          prev
                            ? {
                                ...prev,
                                showClientReviewSummary: checked === true,
                              }
                            : prev,
                        )
                      }
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor="edit-show-client-review"
                      className="cursor-pointer text-sm leading-snug text-slate-700"
                    >
                      Show this checklist on the client link
                    </Label>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="gap-1.5"
                      disabled={aiSummaryRegenerating || editSaving}
                      onClick={handleRegenerateClientReviewSummary}
                    >
                      {aiSummaryRegenerating ? (
                        <>
                          <Spinner className="size-4" /> Generating…
                        </>
                      ) : (
                        <>
                          <Sparkles className="size-4" />
                          Generate with AI
                        </>
                      )}
                    </Button>
                    {editDialog.clientReviewAiSummaryAt ? (
                      <span className="text-xs text-slate-500">
                        Last generated:{" "}
                        {new Date(
                          editDialog.clientReviewAiSummaryAt,
                        ).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    ) : null}
                  </div>

                  <Collapsible
                    key={`edit-ai-ctx-${editDialog.id}`}
                    defaultOpen={Boolean(
                      editDialog.clientReviewAiGenerationContext?.trim(),
                    )}
                    className="rounded-lg border border-dashed border-slate-200 bg-white/90"
                  >
                    <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-50">
                      <ChevronDown className="size-4 shrink-0 opacity-70 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                      Advanced — extra instructions for AI only (not shown to
                      clients)
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 px-3 pb-3 pt-0">
                      <Textarea
                        id="edit-ai-generation-context"
                        rows={4}
                        placeholder="e.g. Emphasize checkout and login; skip admin settings."
                        value={editDialog.clientReviewAiGenerationContext}
                        onChange={(e) =>
                          setEditDialog((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  clientReviewAiGenerationContext:
                                    e.target.value,
                                }
                              : prev,
                          )
                        }
                        className="resize-y min-h-[88px] text-sm"
                      />
                      <p className="text-xs text-slate-500">
                        Used only when you click Generate with AI. Current text in
                        this box is sent even if you have not saved the release yet.
                      </p>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditDialog(null)}
                  disabled={editSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="text-white"
                  disabled={editSaving}
                >
                  {editSaving ? (
                    <>
                      <Spinner /> Saving
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
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
                Upload a ZIP file to Release {""}
                <span className="font-medium text-slate-700">
                  {releases.find((r) => r.id.toString() === selectedRelease)
                    ?.name ?? "this release"}
                </span>
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleUpload} className="space-y-6">
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
                  className={`relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-all duration-200 ${isDragActive
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
                        className={`flex size-12 items-center justify-center rounded-full ${isDragActive
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
                  className={`p-3 rounded-lg border text-sm ${uploadStatus.includes("Upload successful")
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : uploadStatus.includes("Upload failed")
                        ? "bg-red-50 border-red-200 text-red-800"
                        : "bg-blue-50 border-blue-200 text-blue-800"
                    }`}
                >
                  {uploadStatus}
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
                    Once you lock this release, the Upload and Status Change
                    options will be disabled.
                  </p>
                )}
                {statusConfirm?.toStatus === "skip" && (
                  <p className="rounded-lg border border-violet-200/80 bg-linear-to-br from-violet-50/90 to-indigo-50/80 px-3 py-2 text-indigo-950/90">
                    Any other active release in this project becomes draft, and
                    this release is marked skipped. The client link updates to
                    reflect the new active build.
                  </p>
                )}
                {statusConfirm?.toStatus === "active" &&
                  blockActivateUntilOtherLocked && (
                    <p
                      role="alert"
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-900"
                    >
                      Lock current active release before activating this version
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
                      This will be the active release for the project. It may
                      take some time to activate, as it also updates the client
                      link.
                    </p>
                  )}
                {statusConfirm?.toStatus !== "locked" ? (
                  <div className="space-y-2 pt-2">
                    <Label htmlFor="status-change-reason">
                      Reason for change
                    </Label>
                    <Textarea
                      id="status-change-reason"
                      rows={3}
                      placeholder="Required — explain why you are changing status"
                      value={statusConfirm?.statusReason ?? ""}
                      onChange={(e) =>
                        setStatusConfirm((prev) =>
                          prev
                            ? { ...prev, statusReason: e.target.value }
                            : prev,
                        )
                      }
                      disabled={statusConfirmSubmitting}
                      className="resize-none"
                    />
                  </div>
                ) : null}
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
                statusConfirmSubmitting ||
                blockActivateUntilOtherLocked ||
                (statusConfirm?.toStatus !== "locked" &&
                  !(statusConfirm?.statusReason || "").trim())
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
