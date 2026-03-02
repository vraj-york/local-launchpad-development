import React, { useCallback, useEffect, useState } from "react";
import { fetchProjectById, publicLockRelease } from "@/api";
import { useParams } from "react-router-dom";
import { SelectActiveVersion } from "@/components/SelectActiveVersion";
import { Button } from "@/components/ui/button";
import { Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import FeedbackWidgetLoader from "@/components/FeedbackWidgetLoader";

export const ClientLink = () => {
  const [publicProject, setPublicProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const { projectId } = useParams();

  const loadProject = useCallback(async () => {
    try {
      setLoading(true);
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

  const handleLock = useCallback(async () => {
    if (!selectedReleaseId || activeRelease?.isLocked) return;
    try {
      setLocking(true);
      await publicLockRelease(selectedReleaseId, true, info.lockToken);
      toast.success("Release locked successfully");
      await loadProject();
    } catch (err) {
      toast.error(err?.error || "Failed to lock release");
    } finally {
      setLocking(false);
    }
  }, [selectedReleaseId, activeRelease?.isLocked, loadProject]);

  const activeBuildUrl =
    publicProject?.versions?.find((v) => v.isActive)?.buildUrl ??
    publicProject?.versions?.[0]?.buildUrl;

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
      <div className="flex flex-col flex-1 w-full min-h-0">
        <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-accent border-b border-slate-200/60 shadow-sm">
          <div className="flex items-center justify-center gap-3 flex-1 min-w-0">
            <SelectActiveVersion
              release={releases}
              projectId={projectId}
              onActivated={loadProject}
              isPublic={true}
              compact
              darkTrigger
              selectLabel="Choose Version :"
            />
          </div>
          {selectedReleaseId != null && (
            <Button
              type="button"
              variant="secondary"
              disabled={isLocked || locking}
              onClick={handleLock}
              className={`shrink-0 h-8 px-3 rounded-md font-bold text-sm ${isLocked ? "bg-red-500" : " bg-green-600 hover:bg-green-700"} text-white  border-0 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed`}
            >
              {locking ? (
                <span className="flex items-center gap-2">
                  <Spinner className="size-4" />
                  Locking...
                </span>
              ) : isLocked ? (
                <span className="flex items-center gap-2">
                  <Lock className="size-4" />
                  Release Locked
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Unlock className="size-4" />
                  Lock Release
                </span>
              )}
            </Button>
          )}
        </header>
        <div className="flex-1 min-h-0 mt-0">
          {activeBuildUrl ? (
            <iframe
              key={activeBuildUrl}
              id="previewFrame"
              src={activeBuildUrl}
              width="100%"
              height="100%"
              className="block w-full h-full border-0"
              style={{ minHeight: "calc(100vh - 2.5rem)" }}
              title="Build Preview"
            />
          ) : null}
          {projectId && <FeedbackWidgetLoader projectId={projectId} />}
        </div>
      </div>
    </div>
  );
};
