import React, { useCallback, useEffect, useState } from "react";
import { fetchProjectById, toggleReleaseLock } from "@/api";
import { useParams } from "react-router-dom";
import { SelectClientLinkVersion } from "@/components/SelectClientLinkVersion";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
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

export const ClientLink = () => {
  const [publicProject, setPublicProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [previewBuildUrl, setPreviewBuildUrl] = useState(null);
  const { projectId } = useParams();

  const loadProject = useCallback(async () => {
    try {
      setLoading(true);
      setPreviewBuildUrl(null);
      const data = await fetchProjectById(projectId);
      setPublicProject(data);
    } catch (error) {
      console.error("Failed to load project:", error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  const releases = publicProject?.releases?.length
    ? publicProject.releases
    : publicProject?.versions?.length
      ? [
          {
            id: publicProject.id,
            name: "Version",
            versions: publicProject.versions,
          },
        ]
      : [];

  const activeRelease =
    releases.find((r) => (r.versions || []).some((v) => v.isActive)) ||
    releases[0];
  const selectedReleaseId = publicProject?.releases?.length
    ? activeRelease?.id
    : null;

  const handleLock = useCallback(() => {
    if (!selectedReleaseId || activeRelease?.isLocked) return;
    setLockConfirmOpen(true);
  }, [selectedReleaseId, activeRelease?.isLocked]);

  const handleLockConfirm = useCallback(async () => {
    if (!selectedReleaseId) return;
    try {
      setLocking(true);
      setLockConfirmOpen(false);
      const res = await toggleReleaseLock(selectedReleaseId, true);
      toast.success(res?.message ?? "Release locked successfully");
      await loadProject();
    } catch (err) {
      toast.error(err?.error || "Failed to lock release");
    } finally {
      setLocking(false);
    }
  }, [selectedReleaseId, loadProject]);

  const rawBuildUrl =
    publicProject?.versions?.find((v) => v.isActive)?.buildUrl ??
    publicProject?.versions?.[0]?.buildUrl;


  /**
   * Rewrite a cross-origin build URL to a same-origin proxy path so the
   * iframe is same-origin and html2canvas can capture its content.
   * e.g. http://localhost:8001/path → /iframe-preview/8001/path
   */
  const activeBuildUrl = React.useMemo(() => {
    if (!rawBuildUrl) return rawBuildUrl;
    try {
      const buildOrigin = new URL(rawBuildUrl, window.location.href);
      if (buildOrigin.origin === window.location.origin) return rawBuildUrl;
      const port = buildOrigin.port;
      if (!port) return rawBuildUrl;
      return `/iframe-preview/${port}${buildOrigin.pathname}${buildOrigin.search}${buildOrigin.hash}`;
    } catch {
      return rawBuildUrl;
    }
  }, [rawBuildUrl]);

  const iframeSrc = previewBuildUrl ?? activeBuildUrl;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
        Loading project roadmap...
      </div>
    );
  }

  const isLocked = activeRelease?.isLocked ?? false;

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-slate-50 w-full overflow-hidden">
      {/* Wrapper so screenshot includes header + iframe (same-origin via /preview proxy) */}
      <div
        id="feedback-capture-wrapper"
        className="flex flex-col flex-1 w-full min-h-0"
      >
        <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-accent border-b border-slate-200/60 shadow-sm">
          <div className="flex items-center justify-between gap-3 flex-1 min-w-0">
            {publicProject?.name && (
              <h1 className="text-md font-semibold text-slate-800 truncate max-w-[200px] sm:max-w-[280px] shrink-0">
                {publicProject.name}
              </h1>
            )}
            <SelectClientLinkVersion
              release={releases}
              projectId={projectId}
              onSwitched={({ buildUrl }) => setPreviewBuildUrl(buildUrl)}
              compact
              darkTrigger
              selectLabel="Choose Version :"
            />

            {selectedReleaseId != null &&
              (isLocked ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled
                        className="shrink-0 h-8 px-3 rounded-md font-bold text-sm bg-red-500 text-white border-0 shadow-sm opacity-70 cursor-not-allowed"
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
                  className="shrink-0 h-8 px-3 rounded-md font-bold text-sm bg-green-600 hover:bg-green-700 text-white border-0 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
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
        </header>
        <div id="feedback-capture-area" className="flex-1 min-h-0 mt-0">
          {iframeSrc ? (
            <iframe
              key={iframeSrc}
              id="previewFrame"
              src={iframeSrc}
              width="100%"
              height="100%"
              className="block w-full h-full border-0"
              allow="display-capture"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              style={{ minHeight: "calc(100vh - 2.5rem)" }}
              title="Build Preview"
            />
          ) : null}
        </div>
      </div>
      <EmbeddedFeedbackWidget
        projectId={projectId}
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
              Once this release is locked, it cannot be unlocked from this page.
              Only a Project Manager can unlock it. Are you sure you want to
              continue?
            </DialogDescription>
          </DialogHeader>
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
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handleLockConfirm}
              disabled={locking}
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
