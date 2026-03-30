import React, { useEffect, useState } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
// import {
//   Tabs,
//   TabsList,
//   TabsTrigger,
//   TabsContent,
// } from "../components/ui/tabs";
import { ArrowLeft, ExternalLink, PencilLine } from "lucide-react";
import EditProjectDialog from "@/components/EditProjectDialog";
import {
  fetchProjectById,
  //   deleteRoadmap,
  //   deleteRoadmapItem,
  //   updateRoadmapByProjectId,
  //   getRoadmapItemsByProjectId,
} from "@/api";
// import RoadMapManagement from '@/components/RoadMapManagement';
import ReleaseManagement from "@/components/ReleaseManagement";
import { PageHeader } from "@/components/PageHeader";
import config from "@/config";
// import { toast } from 'sonner';

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

  const refreshProject = async () => {
    try {
      const data = await fetchProjectById(projectId);
      setProject(data);
    } catch (error) {
      console.error("Failed to refresh project:", error);
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
              onClick={() => setEditProjectOpen(true)}
            >
              <PencilLine className="w-3.5 h-3.5" />
              Edit project
            </Button>
          </div>
        </PageHeader>
      </div>

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

      <ReleaseManagement projectId={projectId} projectName={projectName} />
    </div>
  );
};

export default ProjectDetails;
