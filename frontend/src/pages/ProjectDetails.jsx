import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
// import {
//   Tabs,
//   TabsList,
//   TabsTrigger,
//   TabsContent,
// } from "../components/ui/tabs";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Maximize2,
  PencilLine,
  Route,
  Sparkles,
} from "lucide-react";
import EditProjectDialog from "@/components/EditProjectDialog";
import {
  fetchProjectById,
  startProjectScratchAgent,
  //   deleteRoadmap,
  //   deleteRoadmapItem,
  //   updateRoadmapByProjectId,
  //   getRoadmapItemsByProjectId,
} from "@/api";
// import RoadMapManagement from '@/components/RoadMapManagement';
import ReleaseManagement from "@/components/ReleaseManagement";
import { PageHeader } from "@/components/PageHeader";
import config from "@/config";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function normalizeAgentStatus(status) {
  if (status == null || status === "") return "";
  return String(status).trim().toUpperCase().replace(/\s+/g, "_");
}

function isCursorAgentSuccessTerminal(status) {
  const u = normalizeAgentStatus(status);
  if (!u) return false;
  return (
    u === "FINISHED" ||
    u === "COMPLETED" ||
    u === "COMPLETE" ||
    u === "SUCCEEDED" ||
    u === "SUCCESS" ||
    u === "DONE"
  );
}

function isCursorAgentFailed(status) {
  const u = normalizeAgentStatus(status);
  if (!u) return false;
  return u === "FAILED" || u.includes("FAIL") || u === "ERROR";
}

/** True when status looks like a non-terminal Cursor agent state. */
function isScratchAgentInProgress(status) {
  const u = normalizeAgentStatus(status);
  if (!u) return false;
  if (isCursorAgentSuccessTerminal(u) || isCursorAgentFailed(u)) return false;
  return true;
}

const SCRATCH_AGENT_STATUS_POLL_MS = 4000;

const ProjectDetails = () => {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // State
  const [project, setProject] = useState(location.state?.project || null);
  const [loading, setLoading] = useState(!location.state?.project);
  // const [roadmap, setRoadmap] = useState(null);
  // const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("releases");
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [scratchAgentBannerOpen, setScratchAgentBannerOpen] = useState(
    () => Boolean(location.state?.scratchAgentRunning),
  );
  const [deferredScratchPrompt, setDeferredScratchPrompt] = useState("");
  const [scratchAgentSubmitting, setScratchAgentSubmitting] = useState(false);
  const [scratchAgentStatusLine, setScratchAgentStatusLine] = useState(null);
  const didDelayedScratchStatusRefreshRef = useRef(false);

  useEffect(() => {
    if (location.state?.scratchAgentRunning) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state?.scratchAgentRunning, navigate]);

  // Helper to refresh project data
  // const refreshProject = async () => {
  //     try {
  //         const data = await getRoadmapItemsByProjectId(projectId);
  //         setRoadmap(data);
  //     } catch (error) {
  //         console.error("Failed to refresh project:", error);
  //     }
  // };

  // Fetch project details if not passed in state or to get fresh data
  useEffect(() => {
    const loadProject = async () => {
      try {
        if (!project) setLoading(true); // Only show loading if we don't have project data yet
        const data = await fetchProjectById(projectId);
        setProject(data);
      } catch (error) {
        console.error("Failed to load project:", error);
      } finally {
        setLoading(false);
      }
    };

    loadProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed from location.state; refresh by projectId only
  }, [projectId]);

  const refreshProject = useCallback(async () => {
    try {
      const data = await fetchProjectById(projectId);
      setProject(data);
    } catch (error) {
      console.error("Failed to refresh project:", error);
    }
  }, [projectId]);

  /** Oldest release id (scratch base release is created first). API returns releases newest-first. */
  const oldestScratchReleaseId = useMemo(() => {
    const r = project?.releases;
    if (!Array.isArray(r) || r.length === 0) return null;
    const ids = r
      .map((x) => Number(x?.id))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return null;
    return Math.min(...ids);
  }, [project?.releases]);

  const showDeferredScratchCard = useMemo(
    () =>
      Array.isArray(project?.releases) && project.releases.length === 0,
    [project?.releases],
  );

  useEffect(() => {
    didDelayedScratchStatusRefreshRef.current = false;
  }, [projectId]);

  /** Open banner when DB shows a non-terminal scratch agent (shared status for all viewers). */
  useEffect(() => {
    if (!project?.fromScratch || oldestScratchReleaseId == null) {
      return;
    }
    if (scratchAgentBannerOpen) return;
    const raw = normalizeAgentStatus(project?.scratchAgentStatus);
    if (!raw) return;
    if (isCursorAgentSuccessTerminal(raw) || isCursorAgentFailed(raw)) return;
    setScratchAgentBannerOpen(true);
  }, [
    project?.fromScratch,
    project?.scratchAgentStatus,
    oldestScratchReleaseId,
    scratchAgentBannerOpen,
  ]);

  /** One delayed refresh so first backend poll can populate scratchAgentStatus. */
  useEffect(() => {
    if (didDelayedScratchStatusRefreshRef.current) return;
    if (!project?.fromScratch || oldestScratchReleaseId == null) return;
    if (showDeferredScratchCard) return;
    if (normalizeAgentStatus(project?.scratchAgentStatus)) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      didDelayedScratchStatusRefreshRef.current = true;
      void refreshProject();
    }, 5000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    project?.fromScratch,
    oldestScratchReleaseId,
    project?.scratchAgentStatus,
    showDeferredScratchCard,
    refreshProject,
  ]);

  /** Poll project (DB) for scratchAgentStatus while agent may be running — backend owns Cursor polling. */
  useEffect(() => {
    if (!project?.fromScratch || oldestScratchReleaseId == null) {
      return undefined;
    }
    if (showDeferredScratchCard) return undefined;
    const inProg = isScratchAgentInProgress(project?.scratchAgentStatus);
    const scratchVersionActive =
      Boolean(project?.fromScratch) &&
      project?.scratchVersionStatus != null &&
      String(project.scratchVersionStatus).trim() !== "";
    if (!inProg && !scratchAgentBannerOpen && !scratchVersionActive) {
      return undefined;
    }

    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchProjectById(projectId);
        if (cancelled) return;
        setProject(data);
        const raw = normalizeAgentStatus(data?.scratchAgentStatus);
        setScratchAgentStatusLine(raw ? `Status: ${raw}` : null);
        if (isCursorAgentSuccessTerminal(raw)) {
          setScratchAgentBannerOpen(false);
          setScratchAgentStatusLine(null);
          toast.success("Scratch agent finished");
          return;
        }
        if (isCursorAgentFailed(raw)) {
          setScratchAgentBannerOpen(false);
          setScratchAgentStatusLine(null);
          toast.error("Scratch agent ended with an error");
        }
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), SCRATCH_AGENT_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    projectId,
    project?.fromScratch,
    project?.scratchAgentStatus,
    project?.scratchVersionStatus,
    oldestScratchReleaseId,
    showDeferredScratchCard,
    scratchAgentBannerOpen,
  ]);

  const handleStartDeferredScratchAgent = async () => {
    const text = deferredScratchPrompt.trim();
    if (!text) {
      toast.error("Enter a prompt for the Cursor agent");
      return;
    }
    setScratchAgentSubmitting(true);
    try {
      await startProjectScratchAgent(projectId, text);
      toast.success("Cursor agent started");
      setScratchAgentBannerOpen(true);
      setDeferredScratchPrompt("");
      await refreshProject();
    } catch (e) {
      const msg =
        (typeof e === "object" && e && e.error) ||
        (e && e.message) ||
        "Failed to start agent";
      toast.error(msg);
    } finally {
      setScratchAgentSubmitting(false);
    }
  };

  // useEffect(() => {
  //     const loadRoadmap = async () => {
  //         try {
  //             if (!project) setLoading(true); // Only show loading if we don't have project data yet
  //             const data = await getRoadmapItemsByProjectId(projectId);
  //             setRoadmap(data);
  //         } catch (error) {
  //             console.error("Failed to load project:", error);
  //         } finally {
  //             setLoading(false);
  //         }
  //     };

  //     loadRoadmap();
  // }, [projectId]);

  const projectName = project?.name || "Project";
  const projectDescription = project?.description || "This is Testing Project";

  const activeVersionUrl = project?.versions?.[0]?.buildUrl ?? null;
  const origin =
    typeof window !== "undefined" ? window.location.origin : config.FRONTEND_URL;
  const clientUrl =
    project?.slug != null && String(project.slug).trim() !== ""
      ? `${origin}/projects/${encodeURIComponent(project.slug.trim())}`
      : null;
  const clientEmbedUrl =
    clientUrl != null
      ? `${clientUrl}${clientUrl.includes("?") ? "&" : "?"}c=false`
      : null;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
        Loading project details...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100vh] px-4 bg-gradient-to-b from-slate-50 to-slate-100">
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
          <p className="text-slate-500 text-sm mb-6">
            The project you're looking for doesn't exist or you don't have
            access to it. Check the URL or go back to the projects list.
          </p>
          <Button
            variant="outline"
            onClick={() => navigate("/projects")}
            className="text-slate-700 border-slate-300"
          >
            Back to Projects
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-0">
        <div className="mb-2">
          <Button
            variant="ghost"
            onClick={() => navigate("/projects")}
            className="hover:bg-transparent hover:text-primary text-slate-500"
            style={{ padding: "0px" }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Projects
          </Button>
        </div>

        <PageHeader title={projectName} description={projectDescription}>
          <div className="flex gap-2">
            <Button
              onClick={() => clientUrl && window.open(clientUrl, "_blank")}
              variant="outline"
              disabled={!clientUrl}
              title={
                clientUrl
                  ? undefined
                  : "Set a project slug (Edit project) to enable the client link."
              }
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Client Link
            </Button>
            <Button
              variant="outline"
              className="border-slate-200 bg-white/80 hover:bg-slate-50"
              disabled={!clientEmbedUrl}
              title={
                clientEmbedUrl
                  ? "Open the client build in a fullscreen iframe (no header, chat, or device frame)."
                  : "Set a project slug (Edit project) to enable the embed link."
              }
              onClick={() =>
                clientEmbedUrl &&
                window.open(clientEmbedUrl, "_blank", "noopener,noreferrer")
              }
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Link without Controls
            </Button>
            <Button
              variant="outline"
              className="border-slate-200 bg-white/80 hover:bg-slate-50"
              onClick={() => {
                const origin =
                  typeof window !== "undefined" ? window.location.origin : "";
                const path = `/projects/roadmap/${encodeURIComponent(projectId)}`;
                window.open(
                  origin ? `${origin}${path}` : path,
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
            >
              <Route className="w-3.5 h-3.5" />
              Release roadmap
            </Button>
            <Button
              variant="outline"
              className="border-slate-200 bg-white/80 hover:bg-slate-50"
              onClick={() => setEditProjectOpen(true)}
            >
              <PencilLine className="w-3.5 h-3.5" />
              Edit project
            </Button>
          </div>
        </PageHeader>
      </div>

      {showDeferredScratchCard && (
        <div className="mb-6 rounded-lg border border-primary/25 bg-primary/5 px-4 py-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Start project from scratch
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  No release yet. Enter what the Cursor agent should build or
                  change in your repository (GitHub or Bitbucket must be
                  connected for the project). This creates release 1.0.0 and
                  starts the agent; the version will update when the run
                  completes.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="deferred-scratch-prompt">Agent prompt</Label>
                <Textarea
                  id="deferred-scratch-prompt"
                  placeholder="Describe what the agent should build or change..."
                  value={deferredScratchPrompt}
                  onChange={(e) => setDeferredScratchPrompt(e.target.value)}
                  rows={5}
                  className="resize-y min-h-[120px] bg-white"
                  disabled={scratchAgentSubmitting}
                />
              </div>
              <Button
                type="button"
                onClick={handleStartDeferredScratchAgent}
                disabled={scratchAgentSubmitting}
                className="gap-2"
              >
                {scratchAgentSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  "Start Cursor agent"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {scratchAgentBannerOpen && (
        <div
          role="status"
          className="mb-6 flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-emerald-950 shadow-sm"
        >
          <Loader2
            className="h-5 w-5 shrink-0 animate-spin text-emerald-600"
            aria-hidden
          />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold leading-tight">
              Cursor agent is running
            </p>
            <p className="text-sm text-emerald-900/90 leading-snug">
              Changes will appear in Version soon after the agent finishes.
            </p>
            {scratchAgentStatusLine ? (
              <p className="text-xs text-emerald-800/80 leading-snug font-mono break-words">
                {scratchAgentStatusLine}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {project?.fromScratch && project?.scratchVersionStatus === "CREATING" && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-amber-200 bg-amber-50/90 px-4 py-3 text-amber-950 shadow-sm"
        >
          <div className="flex gap-3">
            <Loader2
              className="h-5 w-5 shrink-0 animate-spin text-amber-600"
              aria-hidden
            />
            <p className="text-sm font-medium leading-snug">
              Creating version and build… This may take a minute after the agent
              finishes.
            </p>
          </div>
        </div>
      )}

      {project?.fromScratch && project?.scratchVersionStatus === "FAILED" && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-200 bg-red-50/90 px-4 py-3 text-red-950 shadow-sm"
        >
          <p className="text-sm font-medium leading-snug">
            Version creation failed after the agent finished. Check server logs
            or retry from the release flow.
          </p>
        </div>
      )}

      <EditProjectDialog
        open={editProjectOpen}
        onOpenChange={setEditProjectOpen}
        project={project}
        onSaved={refreshProject}
      />

      {/* Tabs Section */}
      {/* <Tabs
        defaultValue="releases"
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        <TabsList className="bg-slate-100 p-1 rounded-lg w-full md:w-auto h-auto grid grid-cols-2 md:inline-flex md:gap-1">
          <TabsTrigger
            value="releases"
            className="data-[state=active]:bg-white data-[state=active]:text-emerald-600 data-[state=active]:shadow-sm transition-all"
          >
            Releases
          </TabsTrigger>
          <TabsTrigger
            value="roadmap"
            className="data-[state=active]:bg-white data-[state=active]:text-emerald-600 data-[state=active]:shadow-sm transition-all"
          >
            Roadmap
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent
            value="releases"
            className="m-0 focus-visible:outline-none"
          ></TabsContent>

          <TabsContent
            value="roadmap"
            className="m-0 focus-visible:outline-none"
          >
            <RoadMapManagement
              // value={project?.roadmaps || []}
              value={roadmap}
              onChange={(newRoadmaps) => setRoadmap(newRoadmaps)}
              isEmbedded={true}
              onRoadmapUpdate={async (roadmap) => {
                // We use updateProject endpoint which expects { roadmap: ... }
                try {
                  const updatedProject = await updateRoadmapByProjectId(
                    project.id,
                    { roadmap },
                  );
                  toast.success("Roadmap updated successfully");
                } catch (error) {
                  toast.error(error.error || "Failed to update roadmap");
                }

                refreshProject();
                return null;
              }}
              onRoadmapDelete={async (roadmapId) => {
                try {
                  await deleteRoadmap(roadmapId);
                  // Update local state immediately to remove from UI
                  // setRoadmap(roadmap.filter(r => r.id !== roadmapId));
                  toast.success("Roadmap deleted successfully");
                  refreshProject();
                } catch (error) {
                  console.error("Failed to delete roadmap:", error);
                  toast.error(error.error || "Failed to delete roadmap");
                }
              }}
              onItemDelete={async (roadmapId, itemId) => {
                try {
                  await deleteRoadmapItem(roadmapId, itemId);
                  toast.success("Roadmap item deleted");
                  refreshProject();
                } catch (error) {
                  console.error("Failed to delete item:", error);
                  if (error.status !== 404) {
                    toast.error(error.error || "Failed to delete item");
                  }
                }
              }}
            />
          </TabsContent>
        </div>
      </Tabs> */}

      <ReleaseManagement
        projectId={projectId}
        projectName={projectName}
        project={project}
      />
    </div>
  );
};

export default ProjectDetails;
