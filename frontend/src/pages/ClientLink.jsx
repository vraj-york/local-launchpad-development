import React, { useCallback, useEffect, useState } from "react";
import {
  fetchPublicProjectBySlug,
  publicLockRelease,
} from "@/api";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
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
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { BotMessageSquare, Lock, MessageCircle } from "lucide-react";
import { ClientLinkChatPanel } from "../components/ClientLinkChatPanel";
import {
  getClientLinkVerifiedEmail,
  setClientLinkVerifiedEmail,
} from "@/lib/clientLinkVerifiedEmail";

const LOCK_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ClientLink = () => {
  const [publicProject, setPublicProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [lockEmail, setLockEmail] = useState("");
  const [previewBuildUrl, setPreviewBuildUrl] = useState(null);
  const [previewContextReleaseId, setPreviewContextReleaseId] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  /** Version selected for iframe preview (may differ from live active). */
  const [previewMeta, setPreviewMeta] = useState(null);
  const { projectSlug } = useParams();

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

  const rootReleaseIdFromActiveVersion = React.useMemo(() => {
    const v =
      publicProject?.versions?.find(
        (x) => x.isActive || activeVersionIds.has(x.id),
      ) ?? publicProject?.versions?.[0];
    return v?.releaseId != null ? Number(v.releaseId) : null;
  }, [publicProject?.versions, activeVersionIds]);

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
          Boolean(v.isActive) || (v.id != null && activeVersionIds.has(v.id)),
      })),
    }));
  }, [publicProject, activeVersionIds]);

  const activeRelease =
    releases.find((r) => (r.versions || []).some((v) => v.isActive)) ||
    releases[0];

  const selectedReleaseId = publicProject?.releases?.length
    ? activeRelease?.id
    : null;

  const effectiveChatReleaseId =
    previewContextReleaseId != null
      ? previewContextReleaseId
      : selectedReleaseId != null
        ? selectedReleaseId
        : rootReleaseIdFromActiveVersion;

  const effectiveReleaseForChat = React.useMemo(() => {
    const rid = effectiveChatReleaseId;
    if (rid == null) return null;
    return (
      releases.find((r) => Number(r.id) === Number(rid)) ?? null
    );
  }, [releases, effectiveChatReleaseId]);

  const effectiveReleaseLocked =
    String(effectiveReleaseForChat?.status ?? "").toLowerCase() === "locked";

  const loadProject = useCallback(async () => {
    if (!projectSlug?.trim()) {
      setPublicProject(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setPreviewBuildUrl(null);
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
    setLockEmail(getClientLinkVerifiedEmail());
  }, [lockConfirmOpen]);

  const lockEmailValid = React.useMemo(() => {
    const e = lockEmail.trim().toLowerCase();
    return LOCK_EMAIL_RE.test(e);
  }, [lockEmail]);

  const liveActiveVersionId = React.useMemo(() => {
    for (const r of releases) {
      const v = (r.versions || []).find((x) => x.isActive);
      if (v?.id != null) return Number(v.id);
    }
    return null;
  }, [releases]);

  const activeReleaseLocked =
    String(activeRelease?.status ?? "").toLowerCase() === "locked";

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
      setClientLinkVerifiedEmail(email);
      setLockConfirmOpen(false);
      toast.success(res?.message ?? "Release locked successfully");
      await loadProject();
    } catch (err) {
      toast.error(err?.error || err?.message || "Failed to lock release");
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

  const handleChatPreviewCommitApplied = useCallback(
    ({ buildUrl, releaseId }) => {
      const baseUrl = String(buildUrl || "").trim();
      if (!baseUrl) return;
      const separator = baseUrl.includes("?") ? "&" : "?";
      setPreviewBuildUrl(`${baseUrl}${separator}chatPreview=${Date.now()}`);
      setPreviewMeta(null);
      if (releaseId != null) setPreviewContextReleaseId(Number(releaseId));
    },
    [],
  );

  const handleChatResetPreview = useCallback(() => {
    setPreviewBuildUrl(null);
    setPreviewMeta(null);
  }, []);

  const activeVersion =
    (activeRelease?.versions || []).find((v) => v?.isActive) ||
    activeRelease?.versions?.[0] ||
    null;
  const chatMergeTargetLabel = `${String(activeRelease?.name || "Unknown release")} / ${activeVersion?.version}`;

  useEffect(() => {
    if (!showLockAndFeedback && chatOpen) {
      setChatOpen(false);
    }
  }, [showLockAndFeedback, chatOpen]);

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

  const chatShellEnabled = showLockAndFeedback && Boolean(publicProject);
  const showRestoreLive =
    previewMeta?.versionId != null &&
    previewMeta?.releaseId != null &&
    liveActiveVersionId != null &&
    Number(previewMeta.versionId) !== Number(liveActiveVersionId) &&
    !activeReleaseLocked;

  const clientLinkPreviewBody = (
    <>
      <header className="shrink-0 flex items-center gap-3 border-b border-slate-200/60 bg-accent px-4 py-2 shadow-sm">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          {publicProject?.name && (
            <h1 className="text-md max-w-[200px] shrink-0 truncate font-semibold text-slate-800 sm:max-w-[280px]">
              {publicProject.name}
            </h1>
          )}
          <div className="flex min-w-0 flex-1 justify-center px-2">
            <SelectClientLinkVersion
              release={releases}
              projectId={publicProject?.id}
              onSwitched={({ buildUrl, releaseId: rid, versionId }) => {
                setPreviewBuildUrl(buildUrl);
                if (rid != null) setPreviewContextReleaseId(rid);
                if (versionId != null && rid != null) {
                  setPreviewMeta({
                    versionId: Number(versionId),
                    releaseId: Number(rid),
                  });
                } else {
                  setPreviewMeta(null);
                }
              }}
              compact
              darkTrigger
              selectLabel="Choose Version :"
            />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {showLockAndFeedback &&
              (isLocked ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled
                        className="h-8 w-auto shrink-0 cursor-not-allowed rounded-md border-0 bg-red-500 px-3 text-sm font-bold text-white opacity-70 shadow-sm"
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
                  variant="primary"
                  disabled={locking}
                  onClick={handleLock}
                  className="h-8 w-auto border-0 px-3 text-sm bg-primary font-bold text-white disabled:cursor-not-allowed disabled:opacity-70"
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
            {showLockAndFeedback && !chatOpen && (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => setChatOpen(true)}
                className="h-8 shrink-0 px-3 font-bold"
                aria-expanded={chatOpen}
                aria-label="Open change requests"
              >
                <span className="flex items-center gap-2">
                  <BotMessageSquare className="size-5 shrink-0" />
                  AI Chat
                </span>
              </Button>
            )}
          </div>
        </div>
      </header>
      <div id="feedback-capture-area" className="relative mt-0 min-h-0 flex-1">
        {!hasActiveVersion && !previewBuildUrl && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gradient-to-b from-slate-50/95 via-white/90 to-violet-50/40 p-6 backdrop-blur-[2px]">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200/80 bg-white/90 p-8 text-center shadow-lg shadow-primary/30">
              <h2 className="mb-2 text-lg font-semibold text-primary">
                No active release
              </h2>
              <p className="text-sm leading-relaxed text-slate-600">
                {hasAnyVersions ? (
                  <>
                    All latest releases are currently locked, so there is no
                    active version. If you would like to view a locked release,
                    please select it from{" "}
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
            title="Build Preview"
            className="absolute inset-0 h-full w-full border-0"
            allow="display-capture"
          />
        ) : null}
        <EmbeddedFeedbackWidget
          projectId={String(publicProject.id)}
          captureTarget="#feedback-capture-wrapper"
          anchorToPreview
          onSuccess={() => toast.success("Feedback submitted successfully")}
          onError={(err) =>
            toast.error(err?.message ?? "Failed to submit feedback")
          }
        />
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen w-full flex-1 flex-col overflow-hidden bg-slate-50">
      {chatOpen && chatShellEnabled ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="flex min-h-0 flex-1 w-full"
        >
          <ResizablePanel
            defaultSize="75%"
            minSize="25%"
            className="flex min-h-0 min-w-0 flex-col"
          >
            {/* Screenshot target: header + preview only (chat stays outside this wrapper) */}
            <div
              id="feedback-capture-wrapper"
              className="flex min-h-0 w-full flex-1 flex-col"
            >
              {clientLinkPreviewBody}
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-border hover:bg-muted" />
          <ResizablePanel
            defaultSize="25%"
            minSize="20%"
            className="flex min-h-0 min-w-[280px] flex-col"
          >
            <ClientLinkChatPanel
              projectSlug={projectSlug}
              effectiveChatReleaseId={effectiveChatReleaseId}
              isLocked={effectiveReleaseLocked}
              isOpen={chatOpen}
              mergeTargetLabel={chatMergeTargetLabel}
              onPreviewCommitApplied={handleChatPreviewCommitApplied}
              onProjectReload={loadProject}
              onResetPreview={handleChatResetPreview}
              onCloseChat={() => setChatOpen(false)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div
          id="feedback-capture-wrapper"
          className="flex min-h-0 w-full flex-1 flex-col"
        >
          {clientLinkPreviewBody}
        </div>
      )}

      <Dialog open={lockConfirmOpen} onOpenChange={setLockConfirmOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Lock this release?</DialogTitle>
            <DialogDescription>
              Once this release is locked, it cannot be unlock. Are you sure you
              want to lock it?
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
    </div>
  );
};
