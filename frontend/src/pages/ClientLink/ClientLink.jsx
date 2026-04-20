import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchPublicProjectBySlug,
  publicLockRelease,
} from "@/api";
import { useParams, useSearchParams } from "react-router-dom";
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
import { SelectClientLinkVersion } from "./components/SelectClientLinkVersion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Loader2,
  Lock,
  Smartphone,
  Sparkles,
  Tablet,
  Video,
} from "lucide-react";
import { ClientLinkChatPanel } from "./components/ClientLinkChatPanel";
import { ClientLinkResponsivePreviewShell } from "./components/ClientLinkResponsivePreviewShell";
import { cn, formatProjectVersionLabel } from "@/lib/utils";
import {
  ClientLinkPreviewPicker,
  canAccessIframeDocument,
} from "./components/ClientLinkPreviewPicker";
import {
  getClientLinkVerifiedEmail,
  isPlausibleClientLinkEmail,
  setClientLinkVerifiedEmail,
} from "@/lib/clientLinkVerifiedEmail";
import {
  isBackendAgentFailureTerminal,
  isBackendAgentPollActive,
  normalizeBackendAgentStatus,
} from "@/lib/backendAgentStatus";

const PREVIEW_MOBILE_W = 390;
const PREVIEW_TABLET_W = 820;
const PREVIEW_MIN_W = 320;

const DEFAULT_LOCK_DEVELOPER_SUBMODULE_PATH = "launchpad-frontend";

export const ClientLink = () => {
  const [publicProject, setPublicProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [lockDeveloperSubmodulePath, setLockDeveloperSubmodulePath] = useState(
    DEFAULT_LOCK_DEVELOPER_SUBMODULE_PATH,
  );
  const [lockAgentRefPreset, setLockAgentRefPreset] = useState("default");
  const [lockAgentRefCustom, setLockAgentRefCustom] = useState("");
  const [lockEmail, setLockEmail] = useState("");
  const [previewBuildUrl, setPreviewBuildUrl] = useState(null);
  const [previewContextReleaseId, setPreviewContextReleaseId] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const previewIframeRef = useRef(null);
  const feedbackWidgetRef = useRef(null);
  const [feedbackCapturing, setFeedbackCapturing] = useState(false);
  const [feedbackRecording, setFeedbackRecording] = useState(false);
  const [visualPickMode, setVisualPickMode] = useState(false);
  const [pickedElementContext, setPickedElementContext] = useState(null);
  /** Queued for next chat send: same image as preview replace, for Cursor + repo. */
  const [stagedChatReplacementImage, setStagedChatReplacementImage] =
    useState(null);
  /** Design reference screenshots for next chat (Cursor multimodal; not tied to pick). */
  const [stagedChatReferenceImages, setStagedChatReferenceImages] = useState(
    [],
  );
  const [previewIframeAccessible, setPreviewIframeAccessible] = useState(null);
  /** Version selected for iframe preview (may differ from live active). */
  const [previewMeta, setPreviewMeta] = useState(null);
  /** Bumped after chat merge/revert + project reload so iframe URL changes when build URL is unchanged (cache bust). */
  const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0);
  /** Combined release notes + what to review (client view only). */
  const [releaseDetailsOpen, setReleaseDetailsOpen] = useState(false);
  const [previewStageWidth, setPreviewStageWidth] = useState(0);
  const [responsivePreset, setResponsivePreset] = useState(
    /** @type {'desktop' | 'tablet' | 'mobile' | 'custom'} */ ("desktop"),
  );
  const [responsiveCustomWidth, setResponsiveCustomWidth] =
    useState(PREVIEW_TABLET_W);
  const { projectSlug } = useParams();
  const [searchParams] = useSearchParams();
  const showControls = searchParams.get("c") !== "false";

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

  /** Slug + release + email resolver for AI SVG (backend proxy; same gate as chat). */
  const clientLinkAiSvgContext = useMemo(
    () => ({
      slug: typeof projectSlug === "string" ? projectSlug : "",
      releaseId: effectiveChatReleaseId,
      getClientEmail: getClientLinkVerifiedEmail,
    }),
    [projectSlug, effectiveChatReleaseId],
  );

  const effectiveReleaseForChat = React.useMemo(() => {
    const rid = effectiveChatReleaseId;
    if (rid == null) return null;
    return (
      releases.find((r) => Number(r.id) === Number(rid)) ?? null
    );
  }, [releases, effectiveChatReleaseId]);

  /** Oldest release id — scratch prompt applies only to this release’s chat (first version / base release). */
  const firstProjectReleaseId = React.useMemo(() => {
    if (!Array.isArray(releases) || releases.length === 0) return null;
    const ids = releases
      .map((r) => Number(r?.id))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return null;
    return Math.min(...ids);
  }, [releases]);

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

  /** Fetch latest project JSON without full-page loading state or clearing preview context (post-chat / chat refresh). */
  const reloadProjectQuiet = useCallback(async () => {
    if (!projectSlug?.trim()) return;
    try {
      const data = await fetchPublicProjectBySlug(projectSlug);
      setPublicProject(data);
    } catch (error) {
      console.error("Failed to refresh project data:", error);
    }
  }, [projectSlug]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  const needsBackendAgentPoll = React.useMemo(
    () =>
      (releases || []).some((r) =>
        isBackendAgentPollActive(r.backendAgentStatus),
      ),
    [releases],
  );

  useEffect(() => {
    if (!projectSlug?.trim() || !needsBackendAgentPoll) return undefined;
    const intervalId = setInterval(() => void reloadProjectQuiet(), 4000);
    return () => clearInterval(intervalId);
  }, [projectSlug, needsBackendAgentPoll, reloadProjectQuiet]);

  useEffect(() => {
    if (!lockConfirmOpen) return;
    setLockEmail(getClientLinkVerifiedEmail());
    setLockDeveloperSubmodulePath(DEFAULT_LOCK_DEVELOPER_SUBMODULE_PATH);
    setLockAgentRefPreset("default");
    setLockAgentRefCustom("");
  }, [lockConfirmOpen]);

  const hasDevelopmentRepo = Boolean(publicProject?.hasDevelopmentRepo);

  const lockEmailValid = React.useMemo(() => {
    return isPlausibleClientLinkEmail(lockEmail);
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
  const showReviewChecklist =
    displayRelease?.showClientReviewSummary !== false;
  const aiReviewSummary =
    showReviewChecklist &&
    (displayRelease?.clientReviewAiSummary?.trim() || "");
  const aiReviewSummaryAt = showReviewChecklist
    ? displayRelease?.clientReviewAiSummaryAt
    : null;

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
    if (!isPlausibleClientLinkEmail(email)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    try {
      setLocking(true);
      const lockOpts = {};
      if (hasDevelopmentRepo) {
        lockOpts.developerSubmodulePath =
          (lockDeveloperSubmodulePath || "").trim() ||
          DEFAULT_LOCK_DEVELOPER_SUBMODULE_PATH;
        let developerAgentRef;
        if (lockAgentRefPreset === "custom") {
          const c = (lockAgentRefCustom || "").trim();
          if (c) developerAgentRef = c;
        } else if (lockAgentRefPreset !== "default") {
          developerAgentRef = lockAgentRefPreset;
        }
        if (developerAgentRef) lockOpts.developerAgentRef = developerAgentRef;
      }
      const res = await publicLockRelease(selectedReleaseId, email, lockOpts);
      setClientLinkVerifiedEmail(email);
      setLockConfirmOpen(false);
      toast.success(res?.message ?? "Release locked successfully");
      await loadProject();
    } catch (err) {
      toast.error(err?.error || err?.message || "Failed to lock release");
    } finally {
      setLocking(false);
    }
  }, [
    selectedReleaseId,
    loadProject,
    lockEmail,
    hasDevelopmentRepo,
    lockDeveloperSubmodulePath,
    lockAgentRefPreset,
    lockAgentRefCustom,
  ]);

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

  const iframeSrc = React.useMemo(() => {
    const base =
      toProxyUrl(previewBuildUrl ?? rawBuildUrl) ?? activeBuildUrl;
    if (!base) return base;
    if (previewRefreshNonce === 0) return base;
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}_pv=${previewRefreshNonce}`;
  }, [
    previewBuildUrl,
    rawBuildUrl,
    activeBuildUrl,
    toProxyUrl,
    previewRefreshNonce,
  ]);

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
    setStagedChatReplacementImage(null);
  }, []);

  const handleReplacementStagedForRepo = useCallback((payload) => {
    setStagedChatReplacementImage(payload);
    setStagedChatReferenceImages([]);
  }, []);

  const handlePreviewReplaceImageResult = useCallback((r) => {
    if (r?.ok) {
      toast.success(
        "Image updated in preview. Send a chat message so the agent can apply the same asset in the repository.",
      );
    } else {
      toast.error(r?.message ?? "Could not replace image.");
    }
  }, []);

  useEffect(() => {
    if (!pickedElementContext) {
      setStagedChatReplacementImage(null);
    }
  }, [pickedElementContext]);

  useEffect(() => {
    if (!chatOpen) {
      setVisualPickMode(false);
      setPickedElementContext(null);
      setStagedChatReplacementImage(null);
      setStagedChatReferenceImages([]);
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
    setStagedChatReplacementImage(null);
    setStagedChatReferenceImages([]);
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
    setPreviewRefreshNonce((n) => n + 1);
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

  useEffect(() => {
    if (!showControls) setChatOpen(false);
  }, [showControls]);

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
      {showControls ? (
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
            {(clientNote || aiReviewSummary) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5 border-slate-300 bg-white/80 px-2.5 hover:bg-white sm:px-3"
                onClick={() => setReleaseDetailsOpen(true)}
              >
                <span className="flex shrink-0 items-center gap-0.5">
                  <FileText className="size-4" aria-hidden />
                  {aiReviewSummary ? (
                    <Sparkles
                      className="size-3.5 text-violet-600"
                      aria-hidden
                    />
                  ) : null}
                </span>
                <span className="whitespace-nowrap text-xs font-bold sm:text-sm">
                  Release details
                </span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 border-slate-300 bg-white px-2.5 text-slate-800 shadow-sm hover:bg-slate-50 sm:px-3"
              onClick={() => feedbackWidgetRef.current?.openRecordFirst?.()}
              disabled={feedbackCapturing || feedbackRecording}
              title="Record your screen, then fill details and submit to Jira"
              aria-label="Record screen for feedback"
            >
              <Video className="size-4 shrink-0 text-red-600" aria-hidden />
              <span className="whitespace-nowrap text-xs font-bold sm:text-sm">
                Record
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 border-red-200/80 bg-gradient-to-r from-red-50 to-rose-50 px-2.5 text-red-700 shadow-sm hover:from-red-100/90 hover:to-rose-100/90 hover:text-red-800 sm:px-3"
              onClick={() => feedbackWidgetRef.current?.open()}
              disabled={feedbackCapturing || feedbackRecording}
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
      ) : null}
      {activeReleaseLocked &&
      activeRelease?.backendAgentStatus &&
      (isBackendAgentPollActive(activeRelease.backendAgentStatus) ||
        isBackendAgentFailureTerminal(activeRelease.backendAgentStatus)) ? (
        <div
          role="status"
          className={cn(
            "mx-4 mb-2 flex gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-sm sm:mx-6",
            isBackendAgentPollActive(activeRelease.backendAgentStatus) &&
              "border-amber-200 bg-amber-50/90 text-amber-950",
            isBackendAgentFailureTerminal(activeRelease.backendAgentStatus) &&
              "border-red-200 bg-red-50/90 text-red-950",
          )}
        >
          {isBackendAgentPollActive(activeRelease.backendAgentStatus) ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin opacity-80" aria-hidden />
          ) : null}
          <span>
            {isBackendAgentPollActive(activeRelease.backendAgentStatus)
              ? "Backend plan agent is running…"
              : null}
            {isBackendAgentFailureTerminal(activeRelease.backendAgentStatus)
              ? "Backend plan agent failed."
              : null}
            {isBackendAgentPollActive(activeRelease.backendAgentStatus) ? (
              <span className="ml-2 font-mono text-xs opacity-80">
                {normalizeBackendAgentStatus(activeRelease.backendAgentStatus)}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
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
                  showControls ? (
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
                      All latest releases are currently locked, so there is no
                      active build to show.
                    </>
                  )
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
          showControls ? (
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
                  onReplaceImageResult={handlePreviewReplaceImageResult}
                  onReplacementStagedForRepo={handleReplacementStagedForRepo}
                  clientLinkAiSvgContext={clientLinkAiSvgContext}
                />
              ) : null}
            </ClientLinkResponsivePreviewShell>
          ) : (
            <div className="relative min-h-0 flex-1">
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
            </div>
          )
        ) : null}
        {showControls ? (
          <EmbeddedFeedbackWidget
            ref={feedbackWidgetRef}
            projectId={String(publicProject.id)}
            getClientEmail={() => getClientLinkVerifiedEmail()}
            captureTarget="#feedback-capture-wrapper"
            anchorToPreview
            hideDefaultTrigger
            onCapturingChange={setFeedbackCapturing}
            onScreenRecordingChange={setFeedbackRecording}
            onSuccess={(res) => {
              if (
                res &&
                typeof res === "object" &&
                res.jiraError != null &&
                String(res.jiraError).trim() !== ""
              ) {
                return;
              }
              toast.success("Feedback submitted successfully");
            }}
            onError={(err) =>
              toast.error(err?.message ?? "Failed to submit feedback")
            }
          />
        ) : null}
      </div>
    </>
  );

  const chatSplitLayout =
    showControls && chatOpen && chatShellEnabled;

  return (
    <div
      className={cn(
        "flex h-dvh max-h-dvh min-h-0 w-full flex-col overflow-hidden",
        showControls ? "bg-slate-50" : "bg-black",
      )}
    >
      {chatSplitLayout ? (
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
              scratchPrompt={publicProject?.scratchPrompt ?? null}
              firstReleaseId={firstProjectReleaseId}
              effectiveChatReleaseId={effectiveChatReleaseId}
              isLocked={effectiveReleaseLocked}
              isOpen={chatOpen}
              mergeTargetLabel={chatMergeTargetLabel}
              onPreviewCommitApplied={handleChatPreviewCommitApplied}
              onProjectReloadQuiet={reloadProjectQuiet}
              onResetPreview={handleChatResetPreview}
              onCloseChat={() => setChatOpen(false)}
              pickedElementContext={pickedElementContext}
              onPickedElementContextChange={setPickedElementContext}
              visualPickMode={visualPickMode}
              onVisualPickModeChange={setVisualPickMode}
              previewIframeAccessible={previewIframeAccessible}
              previewIframeRef={previewIframeRef}
              onPreviewReplaceImageResult={handlePreviewReplaceImageResult}
              stagedChatReplacementImage={stagedChatReplacementImage}
              onStagedChatReplacementImageChange={setStagedChatReplacementImage}
              stagedChatReferenceImages={stagedChatReferenceImages}
              onStagedChatReferenceImagesChange={setStagedChatReferenceImages}
              onReplacementStagedForRepo={handleReplacementStagedForRepo}
              clientLinkAiSvgContext={clientLinkAiSvgContext}
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
              Once this release is locked, it cannot be unlocked. Are you sure you
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
            {hasDevelopmentRepo ? (
              <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
                <p className="text-xs text-slate-600">
                  Optional: platform submodule path under the developer repo and git
                  ref for the post-lock Cursor agent. Leave the ref on the default to
                  use the repository&apos;s default branch.
                </p>
                <div className="space-y-2">
                  <Label
                    htmlFor="client-link-lock-submodule"
                    className="text-slate-700"
                  >
                    Submodule path (repo-relative)
                  </Label>
                  <Input
                    id="client-link-lock-submodule"
                    placeholder={DEFAULT_LOCK_DEVELOPER_SUBMODULE_PATH}
                    value={lockDeveloperSubmodulePath}
                    onChange={(e) => setLockDeveloperSubmodulePath(e.target.value)}
                    disabled={locking}
                    className="rounded-lg border-slate-200 focus-visible:ring-emerald-500/30 transition-all duration-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="client-link-lock-agent-ref"
                    className="text-slate-700"
                  >
                    Cursor agent branch / tag
                  </Label>
                  <Select
                    value={lockAgentRefPreset}
                    onValueChange={setLockAgentRefPreset}
                    disabled={locking}
                  >
                    <SelectTrigger
                      id="client-link-lock-agent-ref"
                      className="w-full rounded-lg border-slate-200 transition-all duration-200"
                    >
                      <SelectValue placeholder="Default branch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">
                        Default (GitHub default branch)
                      </SelectItem>
                      <SelectItem value="main">main</SelectItem>
                      <SelectItem value="master">master</SelectItem>
                      <SelectItem value="develop">develop</SelectItem>
                      <SelectItem value="custom">Custom…</SelectItem>
                    </SelectContent>
                  </Select>
                  {lockAgentRefPreset === "custom" ? (
                    <Input
                      id="client-link-lock-agent-ref-custom"
                      placeholder="e.g. release/1.2 or v1.0.0"
                      value={lockAgentRefCustom}
                      onChange={(e) => setLockAgentRefCustom(e.target.value)}
                      disabled={locking}
                      className="rounded-lg border-slate-200 focus-visible:ring-emerald-500/30 transition-all duration-200"
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
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
      <Dialog open={releaseDetailsOpen} onOpenChange={setReleaseDetailsOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Release details</DialogTitle>
            <DialogDescription>
              {displayRelease?.name
                ? `Release ${displayRelease.name} — notes and review checklist`
                : "Notes and review checklist for this release"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {clientNote ? (
              <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <FileText className="size-4 shrink-0 text-slate-600" />
                  Release notes
                </h3>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {clientNote}
                </p>
              </section>
            ) : null}
            {aiReviewSummary ? (
              <section className="rounded-lg border border-violet-200/80 bg-violet-50/50 p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-950">
                  <Sparkles className="size-4 shrink-0 text-violet-600" />
                  What to review
                </h3>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                  {aiReviewSummary}
                </p>
                {aiReviewSummaryAt ? (
                  <p className="mt-3 border-t border-violet-200/60 pt-2 text-xs text-slate-500">
                    Checklist updated{" "}
                    {new Date(aiReviewSummaryAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
