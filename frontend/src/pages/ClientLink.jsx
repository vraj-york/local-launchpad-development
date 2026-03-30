import React, { useCallback, useEffect, useState } from "react";
import { fetchPublicProjectBySlug, publicLockRelease } from "@/api";
import { useParams } from "react-router-dom";
// import { SelectActiveVersion } from "@/components/SelectActiveVersion";
import { Button } from "@/components/ui/button";
import { Lock, FileText } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { EmbeddedFeedbackWidget } from "@/features/feedback-widget";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SelectClientLinkVersion } from "@/components/SelectClientLinkVersion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Remember lock-confirmation email on this device for client link pages. */
const CLIENT_LINK_LOCK_EMAIL_KEY = "release_lock_email";

const LOCK_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ClientLink = () => {
  const [publicProject, setPublicProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [lockEmail, setLockEmail] = useState("");
  const [previewBuildUrl, setPreviewBuildUrl] = useState(null);
  /** When set, client notes shown for the release that contains this version (after picker preview). */
  const [focusedVersionId, setFocusedVersionId] = useState(null);
  const [releaseNoteOpen, setReleaseNoteOpen] = useState(false);
  const { projectSlug } = useParams();

  const loadProject = useCallback(async () => {
    if (!projectSlug?.trim()) {
      setPublicProject(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setPreviewBuildUrl(null);
      setFocusedVersionId(null);
      const data = await fetchPublicProjectBySlug(projectSlug);
      setPublicProject(data);
    } catch (error) {
      console.error("Failed to load project:", error);
      setPublicProject(null);
    } finally {
      setLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  useEffect(() => {
    if (!lockConfirmOpen) return;
    try {
      const stored = localStorage.getItem(CLIENT_LINK_LOCK_EMAIL_KEY);
      setLockEmail(typeof stored === "string" ? stored : "");
    } catch {
      setLockEmail("");
    }
  }, [lockConfirmOpen]);

  const lockEmailValid = React.useMemo(() => {
    const e = lockEmail.trim().toLowerCase();
    return LOCK_EMAIL_RE.test(e);
  }, [lockEmail]);

  /**
   * Public API returns root `versions` as the active build(s) but often omits `isActive`
   * on those objects; nested `releases[].versions` may also omit flags. Treat any
   * version id present on root `versions` as active so iframe, lock UI, and selector match.
   */
  const activeVersionIds = React.useMemo(() => {
    const ids = (publicProject?.versions ?? [])
      .map((v) => v.id)
      .filter((id) => id != null);
    return new Set(ids);
  }, [publicProject?.versions]);

  const releases = React.useMemo(() => {
    if (!publicProject) return [];
    const raw =
      publicProject.releases?.length > 0
        ? publicProject.releases
        : publicProject.versions?.length
          ? [
            {
              id: publicProject.id,
              name: "Version",
              versions: publicProject.versions,
            },
          ]
          : [];
    return raw.map((r) => ({
      ...r,
      versions: (r.versions || []).map((v) => ({
        ...v,
        isActive:
          Boolean(v.isActive) ||
          (v.id != null && activeVersionIds.has(v.id)),
      })),
    }));
  }, [publicProject, activeVersionIds]);

  const activeRelease =
    releases.find((r) => (r.versions || []).some((v) => v.isActive)) ||
    releases[0];

  const displayRelease = React.useMemo(() => {
    if (focusedVersionId != null) {
      const rel = releases.find((r) =>
        (r.versions || []).some((v) => v.id === focusedVersionId),
      );
      if (rel) return rel;
    }
    return activeRelease;
  }, [releases, activeRelease, focusedVersionId]);

  const selectedReleaseId = publicProject?.releases?.length
    ? activeRelease?.id
    : null;

  const activeReleaseLocked =
    String(activeRelease?.status ?? "").toLowerCase() === "locked";

  const clientNote = displayRelease?.clientReleaseNote?.trim() || "";

  const hasAnyVersions = releases.some(
    (r) => Array.isArray(r.versions) && r.versions.length > 0,
  );
  const hasActiveVersion = releases.some((r) =>
    (r.versions || []).some((v) => v.isActive),
  );
  const showLockAndFeedback = hasActiveVersion && selectedReleaseId != null;

  const handleLock = useCallback(() => {
    if (!selectedReleaseId || activeReleaseLocked) return;
    setLockConfirmOpen(true);
  }, [selectedReleaseId, activeReleaseLocked]);

  const handleLockConfirm = useCallback(async () => {
    if (!selectedReleaseId) return;
    const email = lockEmail.trim().toLowerCase();
    if (!LOCK_EMAIL_RE.test(email)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    try {
      setLocking(true);
      const res = await publicLockRelease(selectedReleaseId, email);
      try {
        localStorage.setItem(CLIENT_LINK_LOCK_EMAIL_KEY, email);
      } catch {
        /* storage unavailable */
      }
      setLockConfirmOpen(false);
      toast.success(res?.message ?? "Release locked successfully");
      await loadProject();
    } catch (err) {
      toast.error(
        err?.error || err?.message || "Failed to lock release",
      );
    } finally {
      setLocking(false);
    }
  }, [selectedReleaseId, loadProject, lockEmail]);

  const rawBuildUrl =
    publicProject?.versions?.find(
      (v) => v.isActive || activeVersionIds.has(v.id),
    )?.buildUrl ?? publicProject?.versions?.[0]?.buildUrl;

  /**
   * Rewrite a cross-origin build URL to a same-origin proxy path so the
   * iframe is same-origin and html2canvas can capture its content.
   * e.g. http://localhost:8001/path → /iframe-preview/8001/path
   */
  const toProxyUrl = React.useCallback((url) => {
    if (!url) return url;
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.origin === window.location.origin) return url;
      const port = parsed.port;
      if (!port) return url;
      return `/iframe-preview/${port}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return url;
    }
  }, []);

  const activeBuildUrl = React.useMemo(
    () => toProxyUrl(rawBuildUrl),
    [rawBuildUrl, toProxyUrl],
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
        Loading project...
      </div>
    );
  }

  if (!publicProject) {
    return (
      <div className="flex flex-col items-center justify-center h-[100vh] px-4 bg-gradient-to-b from-slate-50 to-slate-100">
        <div className="text-center max-w-md rounded-2xl bg-white/80 backdrop-blur-sm border border-slate-200/60 shadow-lg p-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-slate-500 mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-7 w-7"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-slate-800 mb-2">
            No project found
          </h2>
          <p className="text-slate-500 text-sm">
            The project you're looking for doesn't exist or you don't have
            access to it. Check the URL or go back to the previous page.
          </p>
        </div>
      </div>
    );
  }

  const iframeSrc =
    toProxyUrl(previewBuildUrl ?? rawBuildUrl) ?? activeBuildUrl;

  const isLocked = activeReleaseLocked;

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-slate-50 w-full overflow-hidden">
      {/* Wrapper so screenshot includes header + iframe (same-origin via /preview proxy) */}
      <div
        id="feedback-capture-wrapper"
        className="flex flex-col flex-1 w-full min-h-0"
      >
        <header className="shrink-0 px-3 sm:px-4 py-2 bg-accent border-b border-slate-200/60 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 min-w-0">
            {publicProject?.name && (
              <h1 className="text-md font-semibold text-slate-800 truncate max-w-[min(100%,200px)] sm:max-w-[220px] shrink-0 order-1">
                {publicProject.name}
              </h1>
            )}
            <div className="flex min-w-0 flex-1 items-center justify-center gap-2 flex-wrap sm:flex-nowrap order-3 sm:order-2 basis-full sm:basis-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 sm:px-3 shrink-0 border-slate-300 bg-white/80 hover:bg-white"
                onClick={() => setReleaseNoteOpen(true)}
              >
                <FileText className="size-4 shrink-0" />
                <span className="whitespace-nowrap text-xs sm:text-sm">
                  Release note
                </span>
              </Button>
              <SelectClientLinkVersion
                release={releases}
                projectId={publicProject?.id}
                onActivated={loadProject}
                isPublic={true}
                onSwitched={({ buildUrl, versionId }) => {
                  const nextVersionId =
                    versionId != null && !Number.isNaN(versionId)
                      ? Number(versionId)
                      : null;
                  if (nextVersionId != null && activeVersionIds.has(nextVersionId)) {
                    setFocusedVersionId(null);
                    setPreviewBuildUrl(null);
                  } else {
                    setPreviewBuildUrl(buildUrl);
                    if (nextVersionId != null) {
                      setFocusedVersionId(nextVersionId);
                    }
                  }
                }}
                compact
                darkTrigger
                selectLabel="Choose version"
              />
            </div>

            <div className="shrink-0 ml-auto sm:ml-0 order-2 sm:order-3">
              {showLockAndFeedback &&
                (isLocked ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled
                          className="h-8 shrink-0 whitespace-nowrap px-3 rounded-md font-bold text-sm bg-red-500 text-white border-0 shadow-sm opacity-70 cursor-not-allowed w-auto"
                        >
                          <span className="flex items-center gap-2">
                            <Lock className="size-4" />
                            Release Locked
                          </span>
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="max-w-[240px] text-center"
                    >
                      You cannot unlock it from here. If you want to unlock it,
                      contact the product manager.
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={locking}
                    onClick={handleLock}
                    className="h-8 shrink-0 whitespace-nowrap px-3 rounded-md font-bold text-sm bg-green-600 hover:bg-green-700 text-white border-0 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed w-auto"
                  >
                    {locking ? (
                      <span className="flex items-center gap-2">
                        <Spinner className="size-4" />
                        Locking...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Lock className="size-4" />
                        Lock Release
                      </span>
                    )}
                  </Button>
                ))}
            </div>
          </div>
        </header>
        <div id="feedback-capture-area" className="flex-1 min-h-0 mt-0 relative">
          {!hasActiveVersion && !previewBuildUrl && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6 bg-gradient-to-b from-slate-50/95 via-white/90 to-violet-50/40 backdrop-blur-[2px]">
              <div className="max-w-lg w-full rounded-2xl border border-slate-200/80 bg-white/90 shadow-lg shadow-primary/30 p-8 text-center">
                <h2 className="text-lg font-semibold text-primary mb-2">
                  No active release
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {hasAnyVersions ? (
                    <>
                      All latest releases are currently locked, so there is no active version. If you would like to view a locked release, please select it from {" "}
                      <span className="font-bold text-slate-800">
                        Choose version
                      </span>{" "}
                      dropdown above.
                    </>
                  ) : (
                    <>
                      This project has no versions yet. Add a version from the
                      project dashboard, then return to this link.
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
          {iframeSrc ? (
            <iframe
              key={iframeSrc}
              id="previewFrame"
              src={iframeSrc}
              width="100%"
              height="100%"
              className="block w-full h-full border-0"
              allow="display-capture"
              style={{ height: "100vh" }}
              title="Build Preview"
            />
          ) : null}
        </div>
      </div>
      <EmbeddedFeedbackWidget
        projectId={String(publicProject.id)}
        captureTarget="#feedback-capture-wrapper"
        onSuccess={() => toast.success("Feedback submitted successfully")}
        onError={(err) =>
          toast.error(err?.message ?? "Failed to submit feedback")
        }
      />
      <Dialog open={lockConfirmOpen} onOpenChange={setLockConfirmOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Lock this release?</DialogTitle>
            <DialogDescription>
              Once this release is locked, it cannot be unlock. Are you sure you want to
              lock it?
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-1">
            <Label htmlFor="client-link-lock-email" className="text-slate-700">
              Your email
            </Label>
            <Input
              id="client-link-lock-email"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={lockEmail}
              onChange={(e) => setLockEmail(e.target.value)}
              disabled={locking}
              className="rounded-lg border-slate-200 focus-visible:ring-emerald-500/30"
            />
          </div>
          <DialogFooter showCloseButton={false}>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLockConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-sm"
              onClick={handleLockConfirm}
              disabled={locking || !lockEmailValid}
            >
              {locking ? (
                <span className="flex items-center gap-2">
                  <Spinner className="size-4" />
                  Locking...
                </span>
              ) : (
                "Yes, lock release"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={releaseNoteOpen} onOpenChange={setReleaseNoteOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Release note</DialogTitle>
            <DialogDescription>
              {displayRelease?.name ? `Release ${displayRelease.name}` : "Current release"}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 max-h-[55vh]">
            {clientNote ? (
              <p className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">
                {clientNote}
              </p>
            ) : (
              <p className="text-sm text-slate-500">
                No release note available for this release.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
