import React, { useCallback, useEffect, useRef, useState } from "react";
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
import {
  AlertCircle,
  BotMessageSquare,
  FileText,
  Laptop,
  Lock,
  Smartphone,
  Tablet,
} from "lucide-react";
import { ClientLinkChatPanel } from "../components/ClientLinkChatPanel";
import { ClientLinkResponsivePreviewShell } from "../components/ClientLinkResponsivePreviewShell";
import { cn, formatProjectVersionLabel } from "@/lib/utils";
import {
  ClientLinkPreviewPicker,
  canAccessIframeDocument,
} from "../components/ClientLinkPreviewPicker";
import {
  getClientLinkVerifiedEmail,
  setClientLinkVerifiedEmail,
} from "@/lib/clientLinkVerifiedEmail";

const LOCK_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PREVIEW_MOBILE_W = 390;
const PREVIEW_TABLET_W = 820;
const PREVIEW_MIN_W = 320;

export const ClientLink = () => {
  const [publicProject, setPublicProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [lockEmail, setLockEmail] = useState("");
  const [previewBuildUrl, setPreviewBuildUrl] = useState(null);
  const [previewContextReleaseId, setPreviewContextReleaseId] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const previewIframeRef = useRef(null);
  const feedbackWidgetRef = useRef(null);
  const [feedbackCapturing, setFeedbackCapturing] = useState(false);
  const [visualPickMode, setVisualPickMode] = useState(false);
  const [pickedElementContext, setPickedElementContext] = useState(null);
  const [previewIframeAccessible, setPreviewIframeAccessible] = useState(null);
  /** Version selected for iframe preview (may differ from live active). */
  const [previewMeta, setPreviewMeta] = useState(null);
  const [releaseNoteOpen, setReleaseNoteOpen] = useState(false);
  const [previewStageWidth, setPreviewStageWidth] = useState(0);
  const [responsivePreset, setResponsivePreset] = useState(
    /** @type {'desktop' | 'tablet' | 'mobile' | 'custom'} */ ("desktop"),
  );
  const [responsiveCustomWidth, setResponsiveCustomWidth] =
    useState(PREVIEW_TABLET_W);
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
      setPreviewContextReleaseId(null);
      setPreviewMeta(null);
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

  const displayRelease = React.useMemo(() => {
    if (previewMeta?.releaseId != null) {
      const rel = releases.find(
        (r) => Number(r.id) === Number(previewMeta.releaseId),
      );
      if (rel) return rel;
    }
    return activeRelease;
  }, [releases, activeRelease, previewMeta]);

  const clientNote = displayRelease?.clientReleaseNote?.trim() || "";

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

  const iframeSrc = React.useMemo(
    () => toProxyUrl(previewBuildUrl ?? rawBuildUrl) ?? activeBuildUrl,
    [previewBuildUrl, rawBuildUrl, activeBuildUrl, toProxyUrl],
  );

  const effectivePreviewWidth = React.useMemo(() => {
    const stage =
      previewStageWidth > 0
        ? previewStageWidth
        : typeof window !== "undefined"
          ? Math.max(window.innerWidth - 48, PREVIEW_MIN_W)
          : 1200;
    const cap = Math.min(Math.max(stage, PREVIEW_MIN_W), 1920);
    switch (responsivePreset) {
      case "desktop":
        return cap;
      case "tablet":
        return Math.min(PREVIEW_TABLET_W, cap);
      case "mobile":
        return Math.min(PREVIEW_MOBILE_W, cap);
      case "custom":
      default:
        return Math.min(Math.max(responsiveCustomWidth, PREVIEW_MIN_W), cap);
    }
  }, [previewStageWidth, responsivePreset, responsiveCustomWidth]);

  const handleResponsiveDragWidth = useCallback((w) => {
    setResponsivePreset("custom");
    setResponsiveCustomWidth(w);
  }, []);

  const handlePreviewIframeLoad = useCallback(() => {
    const iframe = previewIframeRef.current;
    setPreviewIframeAccessible(canAccessIframeDocument(iframe));
  }, []);

  const handlePreviewPinnedChange = useCallback((ctx) => {
    setPickedElementContext(ctx);
    if (ctx) setVisualPickMode(false);
  }, []);

  useEffect(() => {
    if (!chatOpen) {
      setVisualPickMode(false);
      setPickedElementContext(null);
    }
  }, [chatOpen]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && chatOpen && visualPickMode) {
        setVisualPickMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen, visualPickMode]);

  useEffect(() => {
    setPickedElementContext(null);
    setVisualPickMode(false);
    setPreviewIframeAccessible(null);
  }, [iframeSrc]);

  useEffect(() => {
    if (!chatOpen || !iframeSrc) return;
    const id = requestAnimationFrame(() => {
      handlePreviewIframeLoad();
    });
    return () => cancelAnimationFrame(id);
  }, [chatOpen, iframeSrc, handlePreviewIframeLoad]);

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
  const chatMergeTargetLabel = `${String(activeRelease?.name || "Unknown release")} / ${formatProjectVersionLabel(activeVersion?.version)}`;

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

  const isLocked = activeReleaseLocked;

  const chatShellEnabled = showLockAndFeedback && Boolean(publicProject);
  const showRestoreLive =
    previewMeta?.versionId != null &&
    previewMeta?.releaseId != null &&
    liveActiveVersionId != null &&
    Number(previewMeta.versionId) !== Number(liveActiveVersionId) &&
    !activeReleaseLocked;

  const previewResizeHandleEnabled = !(
    visualPickMode && previewIframeAccessible === true
  );

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
                const vid = versionId != null ? Number(versionId) : null;
                if (
                  vid != null &&
                  liveActiveVersionId != null &&
                  vid === liveActiveVersionId
                ) {
                  setPreviewBuildUrl(null);
                  if (rid != null) setPreviewContextReleaseId(Number(rid));
                  setPreviewMeta(null);
                  return;
                }
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
            {iframeSrc ? (
              <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-200/90 bg-white/90 p-0.5 shadow-sm">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={
                        responsivePreset === "desktop" ? "default" : "ghost"
                      }
                      size="sm"
                      className={cn(
                        "h-7 w-7 p-0",
                        responsivePreset === "desktop" &&
                          "border-0 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-sm hover:from-violet-700 hover:to-indigo-700",
                      )}
                      onClick={() => setResponsivePreset("desktop")}
                      aria-label="Preview width: desktop"
                    >
                      <Laptop className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Desktop</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={
                        responsivePreset === "tablet" ? "default" : "ghost"
                      }
                      size="sm"
                      className={cn(
                        "h-7 w-7 p-0",
                        responsivePreset === "tablet" &&
                          "border-0 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-sm hover:from-violet-700 hover:to-indigo-700",
                      )}
                      onClick={() => setResponsivePreset("tablet")}
                      aria-label="Preview width: tablet"
                    >
                      <Tablet className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Tablet</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={
                        responsivePreset === "mobile" ? "default" : "ghost"
                      }
                      size="sm"
                      className={cn(
                        "h-7 w-7 p-0",
                        responsivePreset === "mobile" &&
                          "border-0 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-sm hover:from-violet-700 hover:to-indigo-700",
                      )}
                      onClick={() => setResponsivePreset("mobile")}
                      aria-label="Preview width: mobile"
                    >
                      <Smartphone className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Mobile</TooltipContent>
                </Tooltip>
              </div>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 border-slate-300 bg-white/80 px-2.5 hover:bg-white sm:px-3"
              onClick={() => setReleaseNoteOpen(true)}
            >
              <FileText className="size-4 shrink-0" />
              <span className="whitespace-nowrap text-xs font-bold sm:text-sm">
                Release note
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 border-red-200/80 bg-gradient-to-r from-red-50 to-rose-50 px-2.5 text-red-700 shadow-sm hover:from-red-100/90 hover:to-rose-100/90 hover:text-red-800 sm:px-3"
              onClick={() => feedbackWidgetRef.current?.open()}
              disabled={feedbackCapturing}
              title="Report an issue or provide feedback"
              aria-label="Report Issue"
            >
              {feedbackCapturing ? (
                <span className="flex items-center gap-2">
                  <Spinner className="size-4 text-red-600" />
                  <span className="whitespace-nowrap text-xs font-bold sm:text-sm">
                    Capturing…
                  </span>
                </span>
              ) : (
                <>
                  <AlertCircle className="size-4 shrink-0" />
                  <span className="whitespace-nowrap text-xs font-bold sm:text-sm">
                    Report Issue
                  </span>
                </>
              )}
            </Button>
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
      <div
        id="feedback-capture-area"
        className="relative mt-0 flex min-h-0 flex-1 flex-col"
      >
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
          <ClientLinkResponsivePreviewShell
            widthPx={effectivePreviewWidth}
            resizeHandleEnabled={previewResizeHandleEnabled}
            onStageWidthChange={setPreviewStageWidth}
            onWidthChangeFromDrag={handleResponsiveDragWidth}
          >
            <iframe
              key={iframeSrc}
              ref={previewIframeRef}
              id="previewFrame"
              src={iframeSrc}
              title="Build Preview"
              className="absolute inset-0 h-full w-full border-0"
              allow="display-capture"
              onLoad={handlePreviewIframeLoad}
            />
            {chatOpen && showLockAndFeedback ? (
              <ClientLinkPreviewPicker
                iframeRef={previewIframeRef}
                active={
                  visualPickMode && previewIframeAccessible === true
                }
                pinned={pickedElementContext}
                onPinnedChange={handlePreviewPinnedChange}
              />
            ) : null}
          </ClientLinkResponsivePreviewShell>
        ) : null}
        <EmbeddedFeedbackWidget
          ref={feedbackWidgetRef}
          projectId={String(publicProject.id)}
          captureTarget="#feedback-capture-wrapper"
          anchorToPreview
          hideDefaultTrigger
          onCapturingChange={setFeedbackCapturing}
          onSuccess={() => toast.success("Feedback submitted successfully")}
          onError={(err) =>
            toast.error(err?.message ?? "Failed to submit feedback")
          }
        />
      </div>
    </>
  );

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 w-full flex-col overflow-hidden bg-slate-50">
      {chatOpen && chatShellEnabled ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="flex min-h-0 flex-1 w-full"
        >
          <ResizablePanel
            defaultSize="75%"
            minSize="25%"
            className="flex min-h-0 min-w-0 flex-col"
            style={{ overflow: "hidden" }}
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
            style={{ overflow: "hidden" }}
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
              pickedElementContext={pickedElementContext}
              onPickedElementContextChange={setPickedElementContext}
              visualPickMode={visualPickMode}
              onVisualPickModeChange={setVisualPickMode}
              previewIframeAccessible={previewIframeAccessible}
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
      <Dialog open={releaseNoteOpen} onOpenChange={setReleaseNoteOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Release note</DialogTitle>
            <DialogDescription>
              {displayRelease?.name
                ? `Release ${displayRelease.name}`
                : "Current release"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
            {clientNote ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
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
