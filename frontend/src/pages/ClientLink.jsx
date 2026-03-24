import React, { useCallback, useEffect, useState } from "react";
import {
  fetchPublicProjectBySlug,
  publicLockRelease,
  clientLinkSendFollowup,
  clientLinkFetchAgentStatus,
} from "@/api";
import { useParams } from "react-router-dom";
// import { SelectActiveVersion } from "@/components/SelectActiveVersion";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Lock, MessageCircle, Sparkles } from "lucide-react";

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
  const [previewContextReleaseId, setPreviewContextReleaseId] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatSending, setChatSending] = useState(false);
  const [chatPolling, setChatPolling] = useState(false);
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
  const selectedReleaseId = publicProject?.releases?.length
    ? activeRelease?.id
    : null;

  const rootReleaseIdFromActiveVersion = React.useMemo(() => {
    const v =
      publicProject?.versions?.find(
        (x) => x.isActive || activeVersionIds.has(x.id),
      ) ?? publicProject?.versions?.[0];
    return v?.releaseId != null ? Number(v.releaseId) : null;
  }, [publicProject?.versions, activeVersionIds]);

  const effectiveChatReleaseId =
    previewContextReleaseId != null
      ? previewContextReleaseId
      : selectedReleaseId != null
        ? selectedReleaseId
        : rootReleaseIdFromActiveVersion;

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

  const pollUntilAgentSettles = useCallback(async () => {
    if (!projectSlug?.trim() || effectiveChatReleaseId == null) return;
    setChatPolling(true);
    const start = Date.now();
    const maxMs = 15 * 60 * 1000;
    try {
      while (Date.now() - start < maxMs) {
        const st = await clientLinkFetchAgentStatus(
          projectSlug,
          effectiveChatReleaseId,
        );
        const raw = st?.status ? String(st.status).toUpperCase() : "";
        if (
          raw === "FINISHED" ||
          raw === "FAILED" ||
          raw.includes("FAIL") ||
          raw === "ERROR"
        ) {
          if (raw === "FINISHED") {
            setChatMessages((m) => [
              ...m,
              {
                role: "system",
                text: "Changes applied. Refreshing preview…",
              },
            ]);
            await loadProject();
          } else {
            setChatMessages((m) => [
              ...m,
              {
                role: "system",
                text: `Agent status: ${raw}. Check server logs if this persists.`,
              },
            ]);
            toast.error(`Agent ended with status: ${raw}`);
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      toast.message("Still processing — you can close this panel and refresh the page later.");
    } catch (e) {
      console.error("[ClientLink] poll agent", e);
      toast.error(e?.error || e?.message || "Status check failed");
    } finally {
      setChatPolling(false);
    }
  }, [projectSlug, effectiveChatReleaseId, loadProject]);

  const handleSendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !projectSlug?.trim()) {
      toast.error("Enter a message.");
      return;
    }
    if (effectiveChatReleaseId == null) {
      toast.error("Select a version above so we know which release to update.");
      return;
    }
    if (activeReleaseLocked) {
      toast.error("This release is locked.");
      return;
    }
    setChatMessages((m) => [...m, { role: "user", text }]);
    setChatInput("");
    setChatSending(true);
    try {
      console.log("[ClientLink] sending follow-up", {
        releaseId: effectiveChatReleaseId,
        len: text.length,
      });
      await clientLinkSendFollowup(
        projectSlug,
        effectiveChatReleaseId,
        text,
      );
      setChatMessages((m) => [
        ...m,
        {
          role: "system",
          text: "Request sent. Applying changes on the server…",
        },
      ]);
      void pollUntilAgentSettles();
    } catch (e) {
      console.error("[ClientLink] followup failed", e);
      toast.error(e?.error || e?.message || "Failed to send");
      setChatMessages((m) => [
        ...m,
        {
          role: "system",
          text: e?.error || e?.message || "Request failed.",
        },
      ]);
    } finally {
      setChatSending(false);
    }
  }, [
    chatInput,
    projectSlug,
    effectiveChatReleaseId,
    activeReleaseLocked,
    pollUntilAgentSettles,
  ]);

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

  /** Chat FAB whenever the client link loaded a project (no server flag required). */
  const chatEnabled = Boolean(publicProject);
  const canUseChat =
    chatEnabled && !isLocked && effectiveChatReleaseId != null;

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-slate-50 w-full overflow-hidden">
      {/* Wrapper so screenshot includes header + iframe (same-origin via /preview proxy) */}
      <div
        id="feedback-capture-wrapper"
        className="flex flex-col flex-1 w-full min-h-0"
      >
        <header className="shrink-0 flex items-center gap-3 px-4 py-2 bg-accent border-b border-slate-200/60 shadow-sm">
          <div className="flex flex-1 items-center justify-between gap-3 min-w-0">
            {publicProject?.name && (
              <h1 className="text-md font-semibold text-slate-800 truncate max-w-[200px] sm:max-w-[280px] shrink-0">
                {publicProject.name}
              </h1>
            )}
            <div className="flex min-w-0 flex-1 justify-center px-2">
              <SelectClientLinkVersion
                release={releases}
                projectId={publicProject?.id}
                onActivated={loadProject}
                isPublic={true}
                onSwitched={({ buildUrl, releaseId: rid }) => {
                  setPreviewBuildUrl(buildUrl);
                  if (rid != null) setPreviewContextReleaseId(rid);
                }}
                compact
                darkTrigger
                selectLabel="Choose Version :"
              />
            </div>

            <div className="shrink-0 flex items-center gap-2">
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
              {chatEnabled && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setChatOpen(true)}
                  className="h-8 shrink-0 whitespace-nowrap px-3 rounded-md font-bold text-sm border-0 shadow-sm bg-gradient-to-r from-violet-600 to-emerald-600 text-white hover:from-violet-700 hover:to-emerald-700"
                  aria-label="Open change requests"
                >
                  <span className="flex items-center gap-2">
                    <MessageCircle className="size-4 shrink-0" />
                    Chat
                  </span>
                </Button>
              )}
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

      {chatEnabled && (
        <>
          <Sheet open={chatOpen} onOpenChange={setChatOpen}>
            <SheetContent
              side="right"
              className="flex w-full max-w-[440px] flex-col border-l border-slate-200/80 bg-gradient-to-b from-white to-slate-50/95 p-0 sm:max-w-[440px]"
            >
              <SheetHeader className="border-b border-slate-200/60 bg-gradient-to-r from-violet-600/10 to-emerald-600/10 px-4 py-4 text-left">
                <SheetTitle className="flex items-center gap-2 text-lg text-slate-900">
                  <Sparkles className="size-5 text-violet-600" />
                  Request changes
                </SheetTitle>
                <SheetDescription className="text-slate-600">
                  Messages are sent to the Cursor cloud agent. The preview updates after the
                  build finishes (usually a few minutes).
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-1 flex-col min-h-0">
                <div className="shrink-0 space-y-2 border-b border-slate-100 px-4 py-3">
                  {!canUseChat && effectiveChatReleaseId == null && (
                    <p className="text-xs text-amber-800">
                      Choose a version in the header dropdown so we know which release to
                      update.
                    </p>
                  )}
                  {isLocked && (
                    <p className="text-xs text-red-600">This release is locked — changes are disabled.</p>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[200px]">
                  {chatMessages.length === 0 && (
                    <p className="text-sm text-slate-500">
                      Describe the change you want (e.g. &quot;Make the hero button larger&quot;).
                    </p>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={
                        msg.role === "user"
                          ? "ml-6 rounded-2xl rounded-tr-sm bg-gradient-to-br from-violet-600 to-indigo-600 px-3 py-2 text-sm text-white shadow-sm"
                          : "mr-6 rounded-2xl rounded-tl-sm border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm"
                      }
                    >
                      {msg.text}
                    </div>
                  ))}
                  {(chatSending || chatPolling) && (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Spinner className="size-4" />
                      Applying changes…
                    </div>
                  )}
                </div>

                <div className="shrink-0 border-t border-slate-200/80 bg-white/90 px-4 py-3 space-y-2">
                  <Textarea
                    placeholder="Your change request…"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={!canUseChat || chatSending || chatPolling}
                    className="min-h-[88px] resize-none rounded-xl border-slate-200 focus-visible:ring-violet-500/30"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (canUseChat && !chatSending && !chatPolling) void handleSendChat();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    disabled={!canUseChat || chatSending || chatPolling}
                    className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-emerald-600 font-semibold text-white shadow-md hover:from-violet-700 hover:to-emerald-700"
                    onClick={() => void handleSendChat()}
                  >
                    Send request
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}

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
    </div>
  );
};
