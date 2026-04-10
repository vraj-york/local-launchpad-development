import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useLayoutEffect,
  useCallback,
} from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate } from "react-router-dom";
import { Loader2, Info, Sparkles } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PageHeader } from "@/components/PageHeader";
import ProjectGitJiraOAuthCard from "@/components/project/ProjectGitJiraOAuthCard";
import { toast } from "sonner";

const PM_CREATE_BODY_OAUTH_DRAFT = "pm_create_body_oauth_draft";
const OAUTH_DRAFT_MAX_AGE_MS = 15 * 60 * 1000;
const CREATE_PROJECT_OAUTH_RETURN = "/projects/new";
const CREATE_PROJECT_DRAFT_STORAGE_PREFIX = "createProjectDraft_v1";
const CREATE_PROJECT_DRAFT_VERSION = 1;

function createProjectDraftStorageKey(userId) {
  return `${CREATE_PROJECT_DRAFT_STORAGE_PREFIX}:${userId}`;
}

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

  const [startFromScratch, setStartFromScratch] = useState(false);
  const [scratchPrompt, setScratchPrompt] = useState("");

  // UI State
  const [error, setError] = useState("");
  const [validationErrors, setValidationErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [managersLoading, setManagersLoading] = useState(false);
  const [hubProjectsLoading, setHubProjectsLoading] = useState(true);
  const [hubProjectsError, setHubProjectsError] = useState("");

  const [createDraftBootstrapDone, setCreateDraftBootstrapDone] =
    useState(false);
  const [restoredOauthDraft, setRestoredOauthDraft] = useState(null);
  const [oauthDraftSnapshot, setOauthDraftSnapshot] = useState(() => ({}));
  const createDraftSaveTimerRef = useRef(null);

  const clearStoredCreateProjectDraft = useCallback(() => {
    if (!user?.id) return;
    try {
      localStorage.removeItem(createProjectDraftStorageKey(user.id));
    } catch {
      /* ignore */
    }
  }, [user?.id]);

  useLayoutEffect(() => {
    if (!user?.id) {
      setCreateDraftBootstrapDone(false);
      return;
    }
    const key = createProjectDraftStorageKey(user.id);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        setOauthDraftSnapshot({});
        setRestoredOauthDraft(null);
        setCreateDraftBootstrapDone(true);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== CREATE_PROJECT_DRAFT_VERSION) {
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
        setOauthDraftSnapshot({});
        setRestoredOauthDraft(null);
        setCreateDraftBootstrapDone(true);
        return;
      }

      if (parsed.selectedHubProjectId != null && parsed.selectedHubProjectId !== "")
        setSelectedHubProjectId(String(parsed.selectedHubProjectId));
      if (typeof parsed.projectDescription === "string")
        setProjectDescription(parsed.projectDescription);
      if (
        user?.role === "admin" &&
        parsed.selectedManager != null &&
        parsed.selectedManager !== ""
      )
        setSelectedManager(String(parsed.selectedManager));
      if (Array.isArray(parsed.assignedUserEmailTags))
        setAssignedUserEmailTags(parsed.assignedUserEmailTags);
      if (Array.isArray(parsed.stakeholderEmailTags))
        setStakeholderEmailTags(parsed.stakeholderEmailTags);
      if (typeof parsed.startFromScratch === "boolean")
        setStartFromScratch(parsed.startFromScratch);
      if (typeof parsed.scratchPrompt === "string")
        setScratchPrompt(parsed.scratchPrompt);

      const oauth =
        parsed.oauth && typeof parsed.oauth === "object" ? parsed.oauth : {};
      setOauthDraftSnapshot(oauth);
      setRestoredOauthDraft(
        oauth && Object.keys(oauth).length > 0 ? oauth : null,
      );
    } catch {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      setOauthDraftSnapshot({});
      setRestoredOauthDraft(null);
    }
    setCreateDraftBootstrapDone(true);
  }, [user?.id, user?.role]);

  const handleOauthCreateFieldsChange = useCallback((snapshot) => {
    setOauthDraftSnapshot(snapshot);
  }, []);

  useEffect(() => {
    if (!createDraftBootstrapDone || !user?.id) return;

    if (createDraftSaveTimerRef.current)
      clearTimeout(createDraftSaveTimerRef.current);
    createDraftSaveTimerRef.current = setTimeout(() => {
      createDraftSaveTimerRef.current = null;
      const payload = {
        version: CREATE_PROJECT_DRAFT_VERSION,
        selectedHubProjectId:
          selectedHubProjectId !== "" && selectedHubProjectId != null
            ? String(selectedHubProjectId)
            : "",
        projectDescription,
        selectedManager:
          user?.role === "admin" && selectedManager !== ""
            ? String(selectedManager)
            : "",
        assignedUserEmailTags,
        stakeholderEmailTags,
        startFromScratch,
        scratchPrompt,
        oauth: oauthDraftSnapshot ?? {},
      };
      try {
        localStorage.setItem(
          createProjectDraftStorageKey(user.id),
          JSON.stringify(payload),
        );
      } catch (e) {
        console.warn("Could not persist create-project draft", e);
      }
    }, 300);

    return () => {
      if (createDraftSaveTimerRef.current) {
        clearTimeout(createDraftSaveTimerRef.current);
        createDraftSaveTimerRef.current = null;
      }
    };
  }, [
    createDraftBootstrapDone,
    user?.id,
    user?.role,
    oauthDraftSnapshot,
    selectedHubProjectId,
    projectDescription,
    selectedManager,
    assignedUserEmailTags,
    stakeholderEmailTags,
    startFromScratch,
    scratchPrompt,
  ]);

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
    try {
      const raw = sessionStorage.getItem(PM_CREATE_BODY_OAUTH_DRAFT);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (
        typeof d?.savedAt !== "number" ||
        Date.now() - d.savedAt > OAUTH_DRAFT_MAX_AGE_MS
      ) {
        sessionStorage.removeItem(PM_CREATE_BODY_OAUTH_DRAFT);
        return;
      }
      sessionStorage.removeItem(PM_CREATE_BODY_OAUTH_DRAFT);
      if (d.selectedHubProjectId != null && d.selectedHubProjectId !== "") {
        setSelectedHubProjectId(d.selectedHubProjectId);
      }
      if (typeof d.projectDescription === "string") {
        setProjectDescription(d.projectDescription);
      }
      if (d.selectedManager != null && d.selectedManager !== "") {
        setSelectedManager(d.selectedManager);
      }
      if (Array.isArray(d.assignedUserEmailTags)) {
        setAssignedUserEmailTags(d.assignedUserEmailTags);
      }
      if (Array.isArray(d.stakeholderEmailTags)) {
        setStakeholderEmailTags(d.stakeholderEmailTags);
      }
      if (typeof d.startFromScratch === "boolean") {
        setStartFromScratch(d.startFromScratch);
      }
      if (typeof d.scratchPrompt === "string") {
        setScratchPrompt(d.scratchPrompt);
      }
    } catch {
      try {
        sessionStorage.removeItem(PM_CREATE_BODY_OAUTH_DRAFT);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const persistCreateBodyDraftForOAuth = useCallback(() => {
    try {
      sessionStorage.setItem(
        PM_CREATE_BODY_OAUTH_DRAFT,
        JSON.stringify({
          savedAt: Date.now(),
          selectedHubProjectId,
          projectDescription,
          selectedManager,
          assignedUserEmailTags,
          stakeholderEmailTags,
          startFromScratch,
          scratchPrompt,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [
    selectedHubProjectId,
    projectDescription,
    selectedManager,
    assignedUserEmailTags,
    stakeholderEmailTags,
    startFromScratch,
    scratchPrompt,
  ]);

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
        (p) => String(p.id) === String(selectedHubProjectId),
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

    if (startFromScratch) {
      const p = typeof scratchPrompt === "string" ? scratchPrompt.trim() : "";
      if (!p) {
        errors.scratchPrompt =
          "Initial agent prompt is required when starting from scratch";
      }
    }

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
      const selectedExternal = externalHubProjects.find(
        (p) => String(p.id) === String(selectedHubProjectId),
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
      } else {
        projectData.assignedManagerId = user.id;
      }
      if (startFromScratch) {
        projectData.isScratch = true;
        const sp =
          typeof scratchPrompt === "string" ? scratchPrompt.trim() : "";
        if (sp) {
          projectData.prompt = sp;
        }
      }
      const response = await createProject(projectData);
      clearStoredCreateProjectDraft();
      if (response?.scratchAgentStarted) {
        toast.success("Project created");
        navigate(`/projects/details/${response.id}`, {
          state: { scratchAgentRunning: true },
        });
      } else if (response?.fromScratch && !response?.scratchAgentStarted) {
        toast.success("Project created — add your prompt on the project page");
        navigate(`/projects/details/${response.id}`);
      } else {
        toast.success("Project created successfully");
        navigate("/dashboard");
      }
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
      externalHubProjects.find(
        (p) => String(p.id) === String(selectedHubProjectId),
      ) ?? null,
    [externalHubProjects, selectedHubProjectId],
  );
  const assignedHubSuggestions = useMemo(
    () =>
      selectedHubProject ? uniqueEmailsForHubProject(selectedHubProject) : [],
    [selectedHubProject],
  );

  return (
    <div className="container mx-auto max-w-3xl px-4 pb-10">
      <PageHeader
        title="Create New Project"
        description="Set up your workspace, then connect GitHub or Bitbucket and Jira below."
      />
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="border-border shadow-sm">
          <CardContent className="space-y-6 pt-6">
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm p-3"
              >
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="hub-project">Select Project</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
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
                  <Select
                    value={
                      selectedHubProjectId !== "" && selectedHubProjectId != null
                        ? String(selectedHubProjectId)
                        : undefined
                    }
                    onValueChange={(v) => setSelectedHubProjectId(String(v))}
                    disabled={hubProjectsLoading}
                  >
                    <SelectTrigger
                      id="hub-project"
                      className={
                        validationErrors.hubProject
                          ? "border-destructive w-full min-w-0 text-left"
                          : "w-full min-w-0 text-left"
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
                        <SelectItem key={p.id} value={String(p.id)}>
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
                      value={selectedManager || undefined}
                      onValueChange={(v) => setSelectedManager(String(v))}
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

              <div className="space-y-3 rounded-lg border border-border bg-primary/5 p-4 transition-colors">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="start-from-scratch"
                    checked={startFromScratch}
                    onCheckedChange={(v) => setStartFromScratch(v === true)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Sparkles
                        className="size-4 shrink-0 text-primary"
                        aria-hidden
                      />
                      <Label
                        htmlFor="start-from-scratch"
                        className="cursor-pointer font-medium text-foreground"
                      >
                        Starting from Scratch
                      </Label>
                    </div>
                    <p className="max-w-prose text-xs text-muted-foreground">
                      You can run the first Cursor agent now with a prompt below,
                      or create the project and add the prompt later on the
                      project page. Requires Cursor API configuration on the
                      server when you start the agent.
                    </p>
                  </div>
                </div>
                {startFromScratch && (
                  <div className="space-y-2 border-t border-primary/15 pt-3">
                    <Label htmlFor="scratch-prompt">
                      Initial agent prompt (optional)
                    </Label>
                    <Textarea
                      id="scratch-prompt"
                      placeholder="Describe what the agent should build or change in the repository..."
                      value={scratchPrompt}
                      onChange={(e) => setScratchPrompt(e.target.value)}
                      rows={5}
                      className={`resize-y min-h-[120px] ${
                        validationErrors.scratchPrompt
                          ? "border-destructive"
                          : ""
                      }`}
                      aria-invalid={Boolean(validationErrors.scratchPrompt)}
                    />
                    {validationErrors.scratchPrompt && (
                      <p className="text-sm text-destructive">
                        {validationErrors.scratchPrompt}
                      </p>
                    )}
                  </div>
                )}
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
          oauthReturnTo={CREATE_PROJECT_OAUTH_RETURN}
          onBeforeOAuthRedirect={persistCreateBodyDraftForOAuth}
          initialCreateDraft={restoredOauthDraft}
          onCreateFieldsChange={handleOauthCreateFieldsChange}
        />

        <Button
          type="submit"
          disabled={
            !createDraftBootstrapDone ||
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
              {startFromScratch
                ? "Creating project & starting agent..."
                : "Creating..."}
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
