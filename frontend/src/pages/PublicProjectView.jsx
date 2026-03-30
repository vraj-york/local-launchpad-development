import { getProjectDataPublically } from "@/api";
import { Button } from "@/components/ui/button";
import React, { useEffect, useState } from "react";
import RoadMapManagement from "@/components/RoadMapManagement";
import { ExternalLink } from "lucide-react";
import { useParams } from "react-router-dom";
import { formatProjectVersionLabel } from "@/lib/utils";

export const PublicProjectView = () => {
  const [publicProject, setPublicProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const { projectId } = useParams();

  useEffect(() => {
    const loadProject = async () => {
      try {
        setLoading(true);
        const data = await getProjectDataPublically(projectId);
        setPublicProject(data);
        console.log("Public Project data loaded:", data);
      } catch (error) {
        console.error("Failed to load project:", error);
      } finally {
        setLoading(false);
      }
    };

    loadProject();
  }, [projectId]);

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
          <p className="text-slate-500 text-sm">
            The project you're looking for doesn't exist or you don't have
            access to it. Check the URL or go back to the previous page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-slate-50 w-full overflow-hidden">
      <div className="mx-auto w-full px-4 md:px-8 py-6">
        <div className="w-full max-w-5xl mx-auto flex justify-between items-center bg-white p-5 rounded-lg">
          <div className="flex flex-col item-center">
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">
              Name: {publicProject?.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              Description: {publicProject?.description}
            </p>
            <p className="text-muted-foreground text-sm">
              Manager: {publicProject?.assignedManager?.name}
            </p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button
              variant="default"
              className="gap-2 text-white"
              onClick={() =>
                window.open(publicProject?.versions[0]?.buildUrl, "_blank")
              }
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View Live Project
            </Button>
            <p className="text-muted-foreground text-xs">
              Active revision:{" "}
              {formatProjectVersionLabel(publicProject?.versions[0]?.version)}
            </p>
          </div>
        </div>

        <div className="mt-8">
          <RoadMapManagement
            value={publicProject?.roadmaps || []}
            readOnly={true}
            isEmbedded={true}
          />
        </div>
      </div>
    </div>
  );
};
