import React, { useState, useEffect } from "react";
import { createProject, fetchManagers, fetchExternalHubProjects } from "../api";
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
import {
  Loader2,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PageHeader } from "@/components/PageHeader";
// import RoadMapManagement from "@/components/RoadMapManagement";
import { toast } from "sonner";

const CreateProject = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Form State — project name + external hub id come from Form hub dropdown
  const [externalHubProjects, setExternalHubProjects] = useState([]);
  const [selectedHubProjectId, setSelectedHubProjectId] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [managers, setManagers] = useState([]);
  const [selectedManager, setSelectedManager] = useState("");

  // GitHub Config State
  const [githubToken, setGithubToken] = useState("");
  const [githubUsername, setGithubUsername] = useState("");

  // Jira Config State
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraUsername, setJiraUsername] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");

  // UI State
  const [error, setError] = useState("");
  const [validationErrors, setValidationErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [managersLoading, setManagersLoading] = useState(false);
  const [hubProjectsLoading, setHubProjectsLoading] = useState(true);
  const [hubProjectsError, setHubProjectsError] = useState("");
  const [showGithubGuide, setShowGithubGuide] = useState(false);
  const [showJiraGuide, setShowJiraGuide] = useState(false);

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

  /** Form hub titles may include spaces; strip all whitespace for stored `name` (current product rule). */
  const normalizeHubTitleForName = (title) =>
    typeof title === "string" ? title.replace(/\s+/g, "") : "";

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
        (p) => p.id === selectedHubProjectId
      );
      const nameForStore = normalizeHubTitleForName(selected?.title ?? "");
      if (!nameForStore) {
        errors.hubProject = "Selected project has no valid title";
      } else if (nameForStore.length < 3) {
        errors.hubProject =
          "project name must be at least 3 characters";
      } else if (!/^[a-zA-Z0-9_-]+$/.test(nameForStore)) {
        errors.hubProject =
          "Project title must yield only letters, numbers, hyphens, and underscores after removing spaces";
      }
    }
    if (user?.role === "admin" && !selectedManager)
      errors.manager = "Manager is required";

    // GitHub Validation (required)
    if (!githubUsername.trim())
      errors.githubUsername = "GitHub username is required";
    if (!githubToken.trim())
      errors.githubToken = "GitHub Personal Access Token is required";

    // Jira Validation (required)
    if (!jiraBaseUrl.trim()) errors.jiraBaseUrl = "Jira Base URL is required";
    if (!jiraUsername.trim())
      errors.jiraUsername = "Jira username (email) is required";
    if (!jiraApiToken.trim())
      errors.jiraApiToken = "Jira API Token is required";
    if (!jiraProjectKey.trim())
      errors.jiraProjectKey = "Jira Project Key is required";

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
        (p) => p.id === selectedHubProjectId
      );
      const projectName = normalizeHubTitleForName(
        selectedExternal?.title ?? ""
      );

      const projectData = {
        name: projectName,
        projectId: selectedHubProjectId,
        description: projectDescription,
        githubUsername: githubUsername,
        githubToken: githubToken,
        // roadmaps: processedRoadmaps,
        jiraBaseUrl: jiraBaseUrl,
        jiraProjectKey: jiraProjectKey,
        jiraUsername: jiraUsername,
        jiraApiToken: jiraApiToken,
      };

      if (user?.role === "admin") {
        projectData.assignedManagerId = parseInt(selectedManager);
      } else if (user?.role === "manager") {
        projectData.assignedManagerId = user.id;
      }

      console.log("Submitting Project Data:", projectData);
      const response = await createProject(projectData);
      console.log("Project  response:", response);
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
                  <p className="text-xs text-muted-foreground -mt-1">
                    Form hub — link an external project to this workspace.
                  </p>
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
                    <p className="text-sm text-destructive mt-1">{hubProjectsError}</p>
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
            </div>
          </CardContent>
        </Card>

        {/* GitHub Configuration Card */}
        <Card className="border-slate-200 overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-lg font-semibold text-slate-800">
                GitHub Configuration (Required)
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-slate-600 hover:text-slate-900 shrink-0"
                onClick={() => setShowGithubGuide((v) => !v)}
              >
                <HelpCircle className="h-4 w-4 mr-1.5" />
                Where to find these?
                {showGithubGuide ? (
                  <ChevronUp className="h-4 w-4 ml-1" />
                ) : (
                  <ChevronDown className="h-4 w-4 ml-1" />
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showGithubGuide && (
              <div className="rounded-lg border border-slate-200 bg-linear-to-br from-slate-50 to-slate-100/80 p-4 text-sm text-slate-700 space-y-3">
                <p className="font-medium text-slate-800">
                  How to get your GitHub credentials
                </p>
                <ol className="list-decimal list-inside space-y-2">
                  <li>
                    <strong>Username</strong> — Your GitHub login (e.g. the part
                    before{" "}
                    <code className="bg-slate-200/80 px-1 rounded">
                      github.com/your-username
                    </code>
                    ).
                  </li>
                  <li>
                    <strong>Personal Access Token (PAT)</strong> — Create one at
                    GitHub:
                    <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                      <li>
                        Go to{" "}
                        <a
                          href="https://github.com/settings/tokens"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
                        >
                          github.com/settings/tokens{" "}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </li>
                      <li>
                        Click &quot;Generate new token&quot; → &quot;Generate
                        new token (classic)&quot;
                      </li>
                      <li>
                        Give it a name, choose expiry, and enable scopes:{" "}
                        <code className="bg-slate-200/80 px-1 rounded">
                          repo
                        </code>
                        , and{" "}
                        <code className="bg-slate-200/80 px-1 rounded">
                          read:user
                        </code>{" "}
                        (or as required)
                      </li>
                      <li>
                        Copy the token (starts with{" "}
                        <code className="bg-slate-200/80 px-1 rounded">
                          ghp_
                        </code>
                        ) and paste it below. You won’t see it again.
                      </li>
                    </ul>
                  </li>
                </ol>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="githubUsername">GitHub Username</Label>
                <Input
                  id="githubUsername"
                  placeholder="octocat (no @, from github.com/username)"
                  value={githubUsername}
                  onChange={(e) => setGithubUsername(e.target.value)}
                  className={
                    validationErrors.githubUsername ? "border-destructive" : ""
                  }
                />
                {validationErrors.githubUsername && (
                  <p className="text-sm text-destructive mt-1">
                    {validationErrors.githubUsername}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="githubToken">
                  GitHub Personal Access Token
                </Label>
                <Input
                  id="githubToken"
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  className={
                    validationErrors.githubToken ? "border-destructive" : ""
                  }
                />
                {validationErrors.githubToken && (
                  <p className="text-sm text-destructive mt-1">
                    {validationErrors.githubToken}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        {/* Jira Configuration Card */}
        <Card className="border-slate-200 overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-lg font-semibold text-slate-800">
                Jira Configuration (Required)
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-slate-600 hover:text-slate-900 shrink-0"
                onClick={() => setShowJiraGuide((v) => !v)}
              >
                <HelpCircle className="h-4 w-4 mr-1.5" />
                Where to find these?
                {showJiraGuide ? (
                  <ChevronUp className="h-4 w-4 ml-1" />
                ) : (
                  <ChevronDown className="h-4 w-4 ml-1" />
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showJiraGuide && (
              <div className="rounded-lg border border-slate-200 bg-linear-to-br from-slate-50 to-slate-100/80 p-4 text-sm text-slate-700 space-y-3">
                <p className="font-medium text-slate-800">
                  How to get your Jira credentials
                </p>
                <ol className="list-decimal list-inside space-y-2">
                  <li>
                    <strong>Jira Base URL</strong> — The URL you use for Jira
                    (e.g.{" "}
                    <code className="bg-slate-200/80 px-1 rounded">
                      https://yourcompany.atlassian.net
                    </code>
                    ). It’s in your browser when you’re in Jira.
                  </li>
                  <li>
                    <strong>Jira Username</strong> — The email address you use
                    to sign in to Jira/Atlassian.
                  </li>
                  <li>
                    <strong>Jira API Token</strong> — Create one at Atlassian:
                    <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                      <li>
                        Go to{" "}
                        <a
                          href="https://id.atlassian.com/manage-profile/security/api-tokens"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
                        >
                          id.atlassian.com → Security → API tokens{" "}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </li>
                      <li>
                        Click &quot;Create API token&quot;, name it, then copy
                        the token and paste it below.
                      </li>
                    </ul>
                  </li>
                  <li>
                    <strong>Project Key</strong> — In Jira, open your project →
                    Project settings (or the project URL). The key is the short
                    code (e.g.{" "}
                    <code className="bg-slate-200/80 px-1 rounded">PROJ</code>,{" "}
                    <code className="bg-slate-200/80 px-1 rounded">DEV</code>).
                  </li>
                </ol>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="jiraBaseUrl">Jira Base URL</Label>
                <Input
                  id="jiraBaseUrl"
                  placeholder="https://mycompany.atlassian.net"
                  value={jiraBaseUrl}
                  onChange={(e) => setJiraBaseUrl(e.target.value)}
                  className={
                    validationErrors.jiraBaseUrl ? "border-destructive" : ""
                  }
                />
                {validationErrors.jiraBaseUrl && (
                  <p className="text-sm text-destructive mt-1">
                    {validationErrors.jiraBaseUrl}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="jiraUsername">Jira Username (Email)</Label>
                <Input
                  id="jiraUsername"
                  placeholder="you@company.com (Atlassian sign-in email)"
                  value={jiraUsername}
                  onChange={(e) => setJiraUsername(e.target.value)}
                  className={
                    validationErrors.jiraUsername ? "border-destructive" : ""
                  }
                />
                {validationErrors.jiraUsername && (
                  <p className="text-sm text-destructive mt-1">
                    {validationErrors.jiraUsername}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="jiraProjectKey">Project Key</Label>
              <Input
                id="jiraProjectKey"
                placeholder="PROJ or DEV (from project URL/settings)"
                value={jiraProjectKey}
                onChange={(e) => setJiraProjectKey(e.target.value)}
                className={
                  validationErrors.jiraProjectKey ? "border-destructive" : ""
                }
              />
              {validationErrors.jiraProjectKey && (
                <p className="text-sm text-destructive mt-1">
                  {validationErrors.jiraProjectKey}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="jiraApiToken">Jira API Token</Label>
              <Input
                id="jiraApiToken"
                type="password"
                placeholder="ATATT3xFfGF0... (long token from id.atlassian.com)"
                value={jiraApiToken}
                onChange={(e) => setJiraApiToken(e.target.value)}
                className={
                  validationErrors.jiraApiToken ? "border-destructive" : ""
                }
              />
              {validationErrors.jiraApiToken && (
                <p className="text-sm text-destructive mt-1">
                  {validationErrors.jiraApiToken}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

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
