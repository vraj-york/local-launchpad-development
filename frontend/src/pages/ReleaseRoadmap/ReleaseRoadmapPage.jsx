import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { fetchProjectById, fetchReleases } from "@/api";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/layouts/PageHeader";
import { Spinner } from "@/components/ui/spinner";
import { ReleaseRoadmap } from "./components/ReleaseRoadmap";

export default function ReleaseRoadmapPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!projectId) return;
      setLoading(true);
      setError("");
      try {
        const [proj, rel] = await Promise.all([
          fetchProjectById(projectId),
          fetchReleases(projectId),
        ]);
        if (!cancelled) {
          setProject(proj);
          setReleases(rel || []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.error || e?.message || "Failed to load roadmap");
          setProject(null);
          setReleases([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[320px] text-muted-foreground gap-3">
        <Spinner className="size-8 text-primary" />
        <p className="text-sm">Loading release roadmap…</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[320px] gap-4 text-center px-4">
        <p className="text-sm text-muted-foreground max-w-md">
          {error || "Project not found or you do not have access."}
        </p>
        <Button variant="outline" onClick={() => navigate("/projects")}>
          Back to projects
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="space-y-2">
        <Button
          variant="ghost"
          className="hover:bg-transparent text-muted-foreground hover:text-foreground -ml-2"
          onClick={() => navigate(`/projects/details/${projectId}`)}
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to project
        </Button>
        <PageHeader
          title="Release roadmap"
          description={`Planned vs actual ship dates for ${project.name}.`}
        />
      </div>

      <ReleaseRoadmap releases={releases} />
    </div>
  );
}
