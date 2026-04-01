import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  createProject,
  fetchManagers,
  fetchExternalHubProjects,
  fetchIntegrationsStatus,
} from "../api";
import {
  validateOptionalCommaSeparatedEmails,
  uniqueEmailsForHubProject,
  emailsArrayToStorageString,
} from "@/utils/emailList";
import { EmailMultiSelect } from "@/components/EmailMultiSelect";
import { useAuth } from "../context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { Loader2, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PageHeader } from "@/components/PageHeader";
import ProjectGitJiraOAuthCard from "@/components/project/ProjectGitJiraOAuthCard";
// import RoadMapManagement from "@/components/RoadMapManagement";
import { toast } from "sonner";

const CreateProject = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const gitJiraRef = useRef(null);

  // Form State — project name + external hub id come from Form hub dropdown
  const [externalHubProjects, setExternalHubProjects] = useState([]);
  const [selectedHubProjectId, setSelectedHubProjectId] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [managers, setManagers] = useState([]);
  const [selectedManager, setSelectedManager] = useState("");

  const [integrationsStatus, setIntegrationsStatus] = useState(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);

  const [assignedUserEmailTags, setAssignedUserEmailTags] = useState([]);
  const [stakeholderEmailTags, setStakeholderEmailTags] = useState([]);

  // UI State
  const [error, setError] = useState("");
  const [validationErrors, setValidationErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [managersLoading, setManagersLoading] = useState(false);
  const [hubProjectsLoading, setHubProjectsLoading] = useState(true);
  const [hubProjectsError, setHubProjectsError] = useState("");

  // Load managers if admin
  useEffect(() => {
    if (user?.role === "admin") {
      const loadManagers = async () => {
        setManagersLoading(true);
        try {
          const data = await fetchManagers();
          setManagers(data);
        } catch (err) {
          console.error("Failed to fetch managers:", err);
          setError("Failed to load managers. Please refresh.");
        } finally {
          setManagersLoading(false);
        }
      };
      loadManagers();
    }
  }, [user]);

  const loadIntegrations = async () => {
    setIntegrationsLoading(true);
    try {
      const data = await fetchIntegrationsStatus();
      setIntegrationsStatus(data);
    } catch (e) {
      console.error(e);
      setIntegrationsStatus(null);
    } finally {
      setIntegrationsLoading(false);
    }
  };

  useEffect(() => {
    loadIntegrations();
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") loadIntegrations();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadHubProjects = async () => {
      setHubProjectsLoading(true);
      setHubProjectsError("");
      try {
        const list = await fetchExternalHubProjects();
        if (!cancelled) setExternalHubProjects(list);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to fetch Form hub projects:", err);
          setHubProjectsError(
            err?.error || "Could not load projects from Form hub."
          );
          setExternalHubProjects([]);
        }
      } finally {
        if (!cancelled) setHubProjectsLoading(false);
      }
    };
    loadHubProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  const validateForm = () => {
    const errors = {};

    // Form hub project (required)
    if (!selectedHubProjectId) {
      errors.hubProject = "Please select a project from hub";
    } else {
      const selected = externalHubProjects.find(
        (p) => p.id === selectedHubProjectId,
      );
      const projectName = selected?.title ?? "";
      const trimmed = projectName.trim();
      if (!trimmed) {
        errors.hubProject = "Selected project has no valid title";
      } else if (trimmed.length < 3 || trimmed.length > 100) {
        errors.hubProject = "Project name must be between 3 and 100 characters";
      }
    }
    if (user?.role === "admin" && !selectedManager)
      errors.manager = "Manager is required";

    Object.assign(
      errors,
      gitJiraRef.current?.validateCreate?.(integrationsLoading) ?? {},
    );

    const assignedErr = validateOptionalCommaSeparatedEmails(
      emailsArrayToStorageString(assignedUserEmailTags),
      "Assigned users",
    );
    if (assignedErr) errors.assignedUserEmails = assignedErr;
    const stakeholderErr = validateOptionalCommaSeparatedEmails(
      emailsArrayToStorageString(stakeholderEmailTags),
      "Stakeholders",
    );
    if (stakeholderErr) errors.stakeholderEmails = stakeholderErr;

    // Roadmap is optional; validate only when user has added roadmaps
    // if (roadmaps.length > 0) {
    //   roadmaps.forEach((roadmap) => {
    //     if (!roadmap.title.trim())
    //       errors[`roadmap-${roadmap.id}-title`] = "Roadmap title is required";
    //     if (!roadmap.timelineStart)
    //       errors[`roadmap-${roadmap.id}-timelineStart`] =
    //         "Start date is required";
    //     if (!roadmap.timelineEnd)
    //       errors[`roadmap-${roadmap.id}-timelineEnd`] = "End date is required";

    //     if (roadmap.items.length === 0) {
    //       errors[`roadmap-${roadmap.id}-items`] =
    //         "At least one item is required";
    //     } else {
    //       roadmap.items.forEach((item) => {
    //         if (!item.title.trim())
    //           errors[`item-${item.id}-title`] = "Item title is required";
    //         if (!item.startDate)
    //           errors[`item-${item.id}-startDate`] = "Start date is required";
    //         if (!item.endDate)
    //           errors[`item-${item.id}-endDate`] = "End date is required";
    //       });
    //     }
    //   });
    // }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setValidationErrors({});

    if (!validateForm()) {
      toast.error("Please fix the validation errors");
      return;
    }

    setLoading(true);

    try {
      // Process roadmaps when provided (optional at project creation)
      // const processedRoadmaps =
      //   roadmaps.length > 0
      //     ? roadmaps.map((roadmap) => {
      //         const { id, ...roadmapRest } = roadmap;
      //         return {
      //           ...roadmapRest,
      //           timelineStart: new Date(roadmap.timelineStart).toISOString(),
      //           timelineEnd: new Date(roadmap.timelineEnd).toISOString(),
      //           items: (roadmap.items || []).map((item) => {
      //             const { id: itemId, ...itemRest } = item;
      //             return {
      //               ...itemRest,
      //               startDate: new Date(item.startDate).toISOString(),
      //               endDate: new Date(item.endDate).toISOString(),
      //               priority: item.priority || "MEDIUM",
      //             };
      //           }),
      //         };
      //       })
      //     : [];

      const selectedExternal = externalHubProjects.find(
        (p) => p.id === selectedHubProjectId,
      );
      const projectName = selectedExternal?.title ?? "";

      const oauthFields = gitJiraRef.current?.getCreatePayload?.() ?? {};
      const projectData = {
        name: projectName,
        projectId: selectedHubProjectId,
        description: projectDescription,
        ...oauthFields,
        assignedUserEmails:
          emailsArrayToStorageString(assignedUserEmailTags) || undefined,
        stakeholderEmails:
          emailsArrayToStorageString(stakeholderEmailTags) || undefined,
      };

      if (user?.role === "admin") {
        projectData.assignedManagerId = parseInt(selectedManager);
      } else if (user?.role === "manager") {
        projectData.assignedManagerId = user.id;
      }
      const response = await createProject(projectData);
      toast.success("Project created successfully");

      // Navigate to the new project or dashboard
      navigate("/dashboard");
    } catch (err) {
      console.error(err);
      toast.error(err.error || "Failed to create project. Please try again.");
      setError(err.error || "Failed to create project. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const selectedHubProject = useMemo(
    () =>
      externalHubProjects.find((p) => p.id === selectedHubProjectId) ?? null,
    [externalHubProjects, selectedHubProjectId],
  );
  const assignedHubSuggestions = useMemo(
    () =>
      selectedHubProject ? uniqueEmailsForHubProject(selectedHubProject) : [],
    [selectedHubProject],
  );

  return (
    <div className="container mx-auto">
      <PageHeader
        title="Create New Project"
        description="Start a new project workspace."
      />
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="border-slate-200">
          <CardContent className="space-y-6 pt-6">
            {error && (
              <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="hub-project">Select Project</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex text-slate-500 hover:text-slate-700 focus:outline-none"
                          aria-label="Form hub project info"
                        >
                          <Info className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[260px]">
                        Choose one project from Form hub. Spaces in the title
                        are removed for the internal project name. The hub
                        project ID is saved with your workspace.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {/* <p className="text-xs text-muted-foreground -mt-1">
                    Form hub — link an external project to this workspace.
                  </p> */}
                  <Select
                    value={selectedHubProjectId || undefined}
                    onValueChange={setSelectedHubProjectId}
                    disabled={hubProjectsLoading}
                  >
                    <SelectTrigger
                      id="hub-project"
                      className={
                        validationErrors.hubProject
                          ? "border-destructive w-full text-left"
                          : "w-full text-left"
                      }
                    >
                      <SelectValue
                        placeholder={
                          hubProjectsLoading
                            ? "Loading Form hub projects..."
                            : "Select a project from Form hub"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {externalHubProjects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {hubProjectsError && (
                    <p className="text-sm text-destructive mt-1">
                      {hubProjectsError}
                    </p>
                  )}
                  {validationErrors.hubProject && (
                    <p className="text-sm text-destructive mt-1">
                      {validationErrors.hubProject}
                    </p>
                  )}
                  {hubProjectsLoading && (
                    <p className="text-xs text-muted-foreground">
                      Fetching projects from Form hub...
                    </p>
                  )}
                </div>
                {user?.role === "admin" && (
                  <div className="space-y-2">
                    <Label htmlFor="manager">Assigned Manager</Label>
                    <Select
                      value={selectedManager}
                      onValueChange={setSelectedManager}
                      disabled={managersLoading}
                    >
                      <SelectTrigger
                        className={
                          validationErrors.manager
                            ? "border-destructive w-full"
                            : "w-full"
                        }
                      >
                        <SelectValue
                          placeholder={
                            managersLoading
                              ? "Loading managers..."
                              : "Select a manager"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {managers.map((manager) => (
                          <SelectItem
                            key={manager.id}
                            value={manager.id.toString()}
                          >
                            {manager.name} ({manager.email})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {validationErrors.manager && (
                      <p className="text-sm text-destructive mt-1">
                        {validationErrors.manager}
                      </p>
                    )}
                    {managersLoading && (
                      <p className="text-xs text-muted-foreground">
                        Fetching list of managers...
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="What is this project about?"
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  rows={4}
                  className="resize-y min-h-[100px]"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="assigned-user-emails">
                    Assigned users (optional)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Pick team emails or type addresses manually.
                  </p>
                  <EmailMultiSelect
                    id="assigned-user-emails"
                    value={assignedUserEmailTags}
                    onChange={setAssignedUserEmailTags}
                    suggestions={assignedHubSuggestions}
                    error={validationErrors.assignedUserEmails}
                    placeholder="Email, then Enter"
                  />
                  {validationErrors.assignedUserEmails && (
                    <p className="text-sm text-destructive mt-1">
                      {validationErrors.assignedUserEmails}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stakeholder-emails">
                    Stakeholders (optional)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Only these emails can use lock release, report issues and AI chat feature.
                  </p>
                  <EmailMultiSelect
                    id="stakeholder-emails"
                    value={stakeholderEmailTags}
                    onChange={setStakeholderEmailTags}
                    suggestions={[]}
                    error={validationErrors.stakeholderEmails}
                    placeholder="Email, then Enter"
                  />
                  {validationErrors.stakeholderEmails && (
                    <p className="text-sm text-destructive mt-1">
                      {validationErrors.stakeholderEmails}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <ProjectGitJiraOAuthCard
          ref={gitJiraRef}
          variant="create"
          syncKey="create"
          integrationsPayload={integrationsStatus}
          integrationsLoading={integrationsLoading}
          validationErrors={validationErrors}
        />

        {/* Roadmap Configuration */}
        {/* <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-slate-800">
              Project Roadmap
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RoadMapManagement
              value={roadmaps}
              onChange={setRoadmaps}
              isEmbedded={true}
              validationErrors={validationErrors}
              initialEditingId={defaultRoadmapId}
            />
          </CardContent>
        </Card> */}
        <Button
          type="submit"
          disabled={
            loading ||
            hubProjectsLoading ||
            integrationsLoading ||
            (user?.role === "admin" && managersLoading)
          }
          className="px-8"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            "Create Project"
          )}
        </Button>
      </form>
    </div>
  );
};

export default CreateProject;
