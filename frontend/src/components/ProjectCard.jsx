import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Calendar, Hash, ExternalLink } from "lucide-react";
// import ProjectActionsDropdown from "./ProjectActionsDropdown";
// import DiffModal from "./DiffModal";
import config from "@/config";

const ProjectCard = ({ project }) => {
  const navigate = useNavigate();
  // const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);

  const activeVersionUrl = project ? project.versions[0]?.buildUrl : null;
  const activeVersionNumber = project ? project.versions[0]?.version : null;
  // Use current origin so the link matches how the user opened the app (localhost vs 127.0.0.1)
  const clientUrl = project
    ? `${typeof window !== "undefined" ? window.location.origin : config.FRONTEND_URL}/projects/public/${project.id}`
    : null;

  const status = project.status || "Active";

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case "active":
        return "bg-emerald-100 text-emerald-700 hover:bg-emerald-200";
      case "archived":
        return "bg-slate-100 text-slate-700 hover:bg-slate-200";
      case "development":
        return "bg-blue-100 text-blue-700 hover:bg-blue-200";
      default:
        return "bg-slate-100 text-slate-700 hover:bg-slate-200";
    }
  };

  return (
    <>
      <Card className="hover:shadow-md transition-shadow hover:border-emerald-200 flex flex-col h-full gap-6">
        <CardHeader className="">
          <div className="flex justify-between items-start gap-2">
            <CardTitle className="text-lg leading-tight ">
              <Link
                to={`/projects/${project.id}`}
                className="text-emerald-600 hover:text-emerald-700 hover:underline font-semibold"
              >
                {project.name}
              </Link>
            </CardTitle>
            <Badge className={getStatusColor(status)} variant="secondary">
              {status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 flex-1">
          <div className="grid grid-cols-2 gap-y-2 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-slate-400" />
              <span className="truncate max-w-[100px]" title={project.id}>
                Project ID: <span className="text-slate-700">{project.id}</span>
              </span>
            </div>

            {activeVersionNumber && (
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 flex items-center justify-center bg-slate-100 rounded-full text-[9px] font-bold text-slate-500">
                  V
                </div>
                <span>
                  Release:{" "}
                  <span className="text-slate-700 font-medium">
                    {activeVersionNumber}
                  </span>
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>
                Created:{" "}
                <span className="text-slate-700">
                  {new Date(project.createdAt).toLocaleDateString()}
                </span>
              </span>
            </div>
          </div>
        </CardContent>
        <CardFooter className="grid grid-cols-2 gap-2">
          {/* <Button
            disabled={!activeVersionUrl}
            onClick={() => window.open(activeVersionUrl, "_blank")}
            variant="outline"
            size="sm"
            className="h-8 px-2 lg:px-3"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Project Link
          </Button> */}
          <Button
            disabled={!activeVersionUrl}
            onClick={() => window.open(clientUrl, "_blank")}
            variant="outline"
            size="sm"
            className="h-8 px-2 lg:px-3"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Client Link
          </Button>

          <Button
            onClick={() => navigate(`/projects/${project.id}`)}
            size="sm"
            className="h-8 text-white"
          >
            Manage Project
          </Button>
          {/* <Button
            onClick={() => setIsDiffModalOpen(true)}
            size="sm"
            variant="outline"
            className="h-8"
          >
            Summary
          </Button> */}
        </CardFooter>
      </Card>

      {/* <DiffModal
        isOpen={isDiffModalOpen}
        onClose={() => setIsDiffModalOpen(false)}
        projectId={project.id}
        projectName={project.name}
      /> */}
    </>
  );
};

export default ProjectCard;
