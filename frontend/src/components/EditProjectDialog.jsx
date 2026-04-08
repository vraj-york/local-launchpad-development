import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  updateProject,
  fetchExternalHubProjects,
  fetchCreatorIntegrationConnections,
  fetchGithubReposPage,
  fetchJiraProjectsForConnection,
  getGithubOAuthAuthorizeUrl,
  getJiraOAuthAuthorizeUrl,
} from "@/api";
import ProjectGitJiraOAuthCard from "@/components/project/ProjectGitJiraOAuthCard";
import { useAuth } from "@/context/AuthContext";
import {
  validateOptionalCommaSeparatedEmails,
  uniqueEmailsForHubProject,
  emailsArrayToStorageString,
  storageStringToEmailsArray,
} from "@/utils/emailList";
import { EmailMultiSelect } from "@/components/EmailMultiSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";

const GH_REPO_PATH_RE =
  /^(https?:\/\/)?github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?$/i;

function normEmailListField(v) {
  if (v == null || String(v).trim() === "") return null;
  return String(v).trim();
}

function isMaskedToken(v) {
  return /^\*{2,}[A-Za-z0-9._-]{0,4}$/.test(String(v || "").trim());
}

function buildUpdatePayload({
  description,
  githubUsername,
  githubToken,
  jiraBaseUrl,
  jiraUsername,
  jiraProjectKey,
  jiraApiToken,
  gitRepoPath,
  developmentRepoUrl,
  assignedUserEmails,
  stakeholderEmails,
  project,
  useOAuthGithub,
  useOAuthJira,
  selectedGithubConnectionId,
  selectedBitbucketConnectionId,
  selectedJiraConnectionId,
  creatorIntegrations,
  sharedOAuthScmHost,
}) {
  const payload = {};

  if (description !== undefined) {
    const t = description.trim();
    payload.description = t === "" ? null : t;
  }

  const ghUser = githubUsername.trim();
  if (ghUser && (!useOAuthGithub || ghUser !== String(project?.githubUsername || "").trim())) {
    payload.githubUsername = ghUser;
  }

  const ghTok = githubToken.trim();
  if (
    !useOAuthGithub &&
    ghTok &&
    !(isMaskedToken(ghTok) && ghTok === String(project?.githubToken || "").trim())
  ) {
    payload.githubToken = ghTok;
  }

  const jBase = jiraBaseUrl.trim();
  if (jBase && (!useOAuthJira || jBase !== String(project?.jiraBaseUrl || "").trim())) {
    payload.jiraBaseUrl = jBase;
  }

  const jUser = jiraUsername.trim();
  if (jUser && (!useOAuthJira || jUser !== String(project?.jiraUsername || "").trim())) {
    payload.jiraUsername = jUser;
  }

  const jKey = jiraProjectKey.trim();
  if (jKey) payload.jiraProjectKey = jKey;

  const jTok = jiraApiToken.trim();
  if (
    !useOAuthJira &&
    jTok &&
    !(isMaskedToken(jTok) && jTok === String(project?.jiraApiToken || "").trim())
  ) {
    payload.jiraApiToken = jTok;
  }

  const repoPath = gitRepoPath.trim();
  if (repoPath && repoPath !== String(project?.gitRepoPath || "").trim()) {
    payload.gitRepoPath = repoPath;
  }

  const prevDev = String(project?.developmentRepoUrl ?? "").trim();
  const devTrim = developmentRepoUrl.trim();
  if (devTrim !== prevDev) {
    payload.developmentRepoUrl = devTrim === "" ? null : devTrim;
  }

  if (
    normEmailListField(assignedUserEmails) !==
    normEmailListField(project?.assignedUserEmails)
  ) {
    payload.assignedUserEmails = normEmailListField(assignedUserEmails);
  }
  if (
    normEmailListField(stakeholderEmails) !==
    normEmailListField(project?.stakeholderEmails)
  ) {
    payload.stakeholderEmails = normEmailListField(stakeholderEmails);
  }

  if (sharedOAuthScmHost === "github") {
    if (project?.bitbucketConnectionId != null) {
      payload.bitbucketConnectionId = null;
    }
    if (
      selectedGithubConnectionId &&
      String(selectedGithubConnectionId) !== String(project?.githubConnectionId ?? "")
    ) {
      payload.githubConnectionId = Number(selectedGithubConnectionId);
    }
  } else if (sharedOAuthScmHost === "bitbucket") {
    if (project?.githubConnectionId != null) {
      payload.githubConnectionId = null;
    }
    if (
      selectedBitbucketConnectionId &&
      String(selectedBitbucketConnectionId) !== String(project?.bitbucketConnectionId ?? "")
    ) {
      payload.bitbucketConnectionId = Number(selectedBitbucketConnectionId);
    }
  } else if (
    useOAuthGithub &&
    selectedGithubConnectionId &&
    String(selectedGithubConnectionId) !== String(project?.githubConnectionId ?? "")
  ) {
    payload.githubConnectionId = Number(selectedGithubConnectionId);
  }

  if (
    useOAuthJira &&
    selectedJiraConnectionId &&
    String(selectedJiraConnectionId) !== String(project?.jiraConnectionId ?? "")
  ) {
    payload.jiraConnectionId = Number(selectedJiraConnectionId);
    const ji = creatorIntegrations?.jira?.connections?.find(
      (c) => String(c.id) === String(selectedJiraConnectionId),
    );
    if (ji?.baseUrl) payload.jiraBaseUrl = ji.baseUrl.trim();
  }

  return payload;
}

const EditProjectDialog = ({ open, onOpenChange, project, onSaved }) => {
  const { user } = useAuth();
  const useOAuthGithub = Boolean(project?.githubConnectionId);
  const useOAuthBitbucket = Boolean(project?.bitbucketConnectionId);
  const useOAuthJira = Boolean(project?.jiraConnectionId);
  const creatorId = project?.createdBy?.id ?? project?.createdById;
  const canReconnectOAuth =
    user != null &&
    creatorId != null &&
    Number(user.id) === Number(creatorId);
  const canEditOAuthLinks =
    user?.role === "admin" ||
    (creatorId != null && user != null && Number(user.id) === Number(creatorId));
  const useSharedOAuthCard =
    canEditOAuthLinks && (useOAuthGithub || useOAuthBitbucket) && useOAuthJira;
  const gitJiraRef = useRef(null);

  const [projectDescription, setProjectDescription] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraUsername, setJiraUsername] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [gitRepoPath, setGitRepoPath] = useState("");
  const [developmentRepoUrl, setDevelopmentRepoUrl] = useState("");

  const [assignedUserEmailTags, setAssignedUserEmailTags] = useState([]);
  const [stakeholderEmailTags, setStakeholderEmailTags] = useState([]);
  const [hubProjectsForEmails, setHubProjectsForEmails] = useState([]);

  const [validationErrors, setValidationErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [showGithubGuide, setShowGithubGuide] = useState(false);
  const [showJiraGuide, setShowJiraGuide] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [showJiraToken, setShowJiraToken] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(null);
  const [creatorIntegrations, setCreatorIntegrations] = useState(null);
  const [loadingCreatorInt, setLoadingCreatorInt] = useState(false);
  const [selectedGithubConnectionId, setSelectedGithubConnectionId] = useState("");
  const [selectedJiraConnectionId, setSelectedJiraConnectionId] = useState("");
  const [githubReposEdit, setGithubReposEdit] = useState([]);
  const [reposLoadingEdit, setReposLoadingEdit] = useState(false);
  const [jiraProjectsEdit, setJiraProjectsEdit] = useState([]);
  const [jiraProjectsLoadingEdit, setJiraProjectsLoadingEdit] = useState(false);
  const [githubRepoPickSeq, setGithubRepoPickSeq] = useState(0);
  const [developmentRepoPickSeq, setDevelopmentRepoPickSeq] = useState(0);

  useEffect(() => {
    if (!open || !project) return;
    setProjectDescription(project.description ?? "");
    setGithubUsername(project.githubUsername ?? "");
    setGithubToken(project.githubToken ?? "");
    setJiraBaseUrl(project.jiraBaseUrl ?? "");
    setJiraUsername(project.jiraUsername ?? "");
    setJiraProjectKey(project.jiraProjectKey ?? "");
    setJiraApiToken(project.jiraApiToken ?? "");
    setGitRepoPath(project.gitRepoPath ?? "");
    setDevelopmentRepoUrl(String(project.developmentRepoUrl ?? ""));
    setAssignedUserEmailTags(
      storageStringToEmailsArray(project.assignedUserEmails),
    );
    setStakeholderEmailTags(
      storageStringToEmailsArray(project.stakeholderEmails),
    );
    setShowGithubToken(false);
    setShowJiraToken(false);
    setValidationErrors({});
  }, [open, project]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchExternalHubProjects();
        if (!cancelled) setHubProjectsForEmails(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setHubProjectsForEmails([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (useSharedOAuthCard) return;
    if (!open || !project) return;
    setSelectedGithubConnectionId(
      project.githubConnectionId != null ? String(project.githubConnectionId) : "",
    );
    setSelectedJiraConnectionId(
      project.jiraConnectionId != null ? String(project.jiraConnectionId) : "",
    );
  }, [
    useSharedOAuthCard,
    open,
    project?.id,
    project?.githubConnectionId,
    project?.jiraConnectionId,
  ]);

  useEffect(() => {
    if (!open || !project?.id || !canEditOAuthLinks) return;
    if (!useOAuthGithub && !useOAuthJira) return;
    let cancelled = false;
    (async () => {
      setLoadingCreatorInt(true);
      try {
        const data = await fetchCreatorIntegrationConnections(project.id);
        if (!cancelled) setCreatorIntegrations(data);
      } catch {
        if (!cancelled) setCreatorIntegrations(null);
      } finally {
        if (!cancelled) setLoadingCreatorInt(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, project?.id, canEditOAuthLinks, useOAuthGithub, useOAuthJira]);

  useEffect(() => {
    if (useSharedOAuthCard) return;
    if (!open || !project?.id || !selectedGithubConnectionId || !useOAuthGithub) {
      setGithubReposEdit([]);
      return;
    }
    if (!canEditOAuthLinks) return;
    let cancelled = false;
    (async () => {
      setReposLoadingEdit(true);
      try {
        const data = await fetchGithubReposPage(selectedGithubConnectionId, {
          page: 1,
          projectId: project.id,
        });
        if (!cancelled) setGithubReposEdit(data.repos || []);
      } catch {
        if (!cancelled) setGithubReposEdit([]);
      } finally {
        if (!cancelled) setReposLoadingEdit(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    useSharedOAuthCard,
    open,
    project?.id,
    selectedGithubConnectionId,
    useOAuthGithub,
    canEditOAuthLinks,
  ]);

  useEffect(() => {
    if (useSharedOAuthCard) return;
    if (!open || !project?.id || !selectedJiraConnectionId || !useOAuthJira) {
      setJiraProjectsEdit([]);
      return;
    }
    if (!canEditOAuthLinks) return;
    let cancelled = false;
    (async () => {
      setJiraProjectsLoadingEdit(true);
      try {
        const data = await fetchJiraProjectsForConnection(selectedJiraConnectionId, {
          projectId: project.id,
        });
        if (!cancelled) {
          setJiraProjectsEdit(Array.isArray(data.projects) ? data.projects : []);
        }
      } catch {
        if (!cancelled) setJiraProjectsEdit([]);
      } finally {
        if (!cancelled) setJiraProjectsLoadingEdit(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    useSharedOAuthCard,
    open,
    project?.id,
    selectedJiraConnectionId,
    useOAuthJira,
    canEditOAuthLinks,
  ]);

  const validateForm = () => {
    const errors = {};

    if (useSharedOAuthCard) {
      Object.assign(
        errors,
        gitJiraRef.current?.validateEdit?.(project, loadingCreatorInt) ?? {},
      );
    } else {
      if (!gitRepoPath.trim()) {
        errors.gitRepoPath = "Git repository path is required";
      }

      const devLegacy = developmentRepoUrl.trim();
      if (devLegacy && !GH_REPO_PATH_RE.test(devLegacy)) {
        errors.developmentRepoUrl =
          "Enter a valid GitHub path (e.g. github.com/org/other-repo)";
      }

      if (useOAuthGithub) {
        if (!githubUsername.trim() && !project?.githubUsername?.trim()) {
          errors.githubUsername = "GitHub login missing; reconnect under Integrations";
        }
      } else {
        if (!githubUsername.trim()) {
          errors.githubUsername = "GitHub username is required";
        }
        const githubStored = Boolean(project?.githubToken?.trim?.());
        if (!githubToken.trim() && !githubStored) {
          errors.githubToken =
            "GitHub token is required (stored credentials missing; add a token to save)";
        }
      }

      if (useOAuthJira) {
        if (!jiraProjectKey.trim()) {
          errors.jiraProjectKey = "Jira project key is required";
        }
        if (!jiraBaseUrl.trim()) {
          errors.jiraBaseUrl = "Jira site URL is required (from your OAuth site or type it)";
        }
      } else {
        if (!jiraBaseUrl.trim()) errors.jiraBaseUrl = "Jira Base URL is required";
        if (!jiraUsername.trim()) {
          errors.jiraUsername = "Jira username (email) is required";
        }
        if (!jiraProjectKey.trim()) {
          errors.jiraProjectKey = "Jira Project Key is required";
        }
        const jiraTokenStored = Boolean(project?.jiraApiToken?.trim?.());
        if (!jiraApiToken.trim() && !jiraTokenStored) {
          errors.jiraApiToken =
            "Jira API Token is required (stored credentials missing; add a token to save)";
        }
      }
    }

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

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!project?.id) return;

    if (!validateForm()) {
      toast.error("Please fix the validation errors");
      return;
    }

    setSaving(true);
    try {
      const resolvedGitPath = useSharedOAuthCard
        ? gitJiraRef.current?.getEditResolvedGitRepoPath?.(project) ?? ""
        : gitRepoPath;
      const resolvedDevelopmentRepo = useSharedOAuthCard
        ? gitJiraRef.current?.getDevelopmentRepoUrl?.() ?? ""
        : developmentRepoUrl;
      const resolvedJiraKey = useSharedOAuthCard
        ? gitJiraRef.current?.getJiraProjectKey?.() ?? ""
        : jiraProjectKey;
      const resolvedJiraBaseUrl = useSharedOAuthCard
        ? gitJiraRef.current?.getJiraBaseUrl?.() ?? jiraBaseUrl
        : jiraBaseUrl;
      const resolvedGhConn = useSharedOAuthCard
        ? gitJiraRef.current?.getSelectedGithubConnectionId?.() ?? ""
        : selectedGithubConnectionId;
      const resolvedBbConn = useSharedOAuthCard
        ? gitJiraRef.current?.getSelectedBitbucketConnectionId?.() ?? ""
        : "";
      const resolvedJiConn = useSharedOAuthCard
        ? gitJiraRef.current?.getSelectedJiraConnectionId?.() ?? ""
        : selectedJiraConnectionId;
      const sharedScmHost = useSharedOAuthCard
        ? gitJiraRef.current?.getScmHost?.() ?? "github"
        : null;

      const payload = buildUpdatePayload({
        description: projectDescription,
        githubUsername,
        githubToken,
        jiraBaseUrl: resolvedJiraBaseUrl,
        jiraUsername,
        jiraProjectKey: resolvedJiraKey,
        jiraApiToken,
        gitRepoPath: resolvedGitPath,
        developmentRepoUrl: resolvedDevelopmentRepo,
        assignedUserEmails: emailsArrayToStorageString(assignedUserEmailTags),
        stakeholderEmails: emailsArrayToStorageString(stakeholderEmailTags),
        project,
        useOAuthGithub,
        useOAuthJira,
        selectedGithubConnectionId: resolvedGhConn,
        selectedBitbucketConnectionId: resolvedBbConn,
        selectedJiraConnectionId: resolvedJiConn,
        creatorIntegrations,
        sharedOAuthScmHost: sharedScmHost,
      });

      if (Object.keys(payload).length === 0) {
        toast.error("No changes to save");
        setSaving(false);
        return;
      }

      await updateProject(project.id, payload);
      toast.success("Project updated successfully");
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      console.error(err);
      toast.error(err?.error || "Failed to update project");
    } finally {
      setSaving(false);
    }
  };

  if (!project) return null;

  const hubRowForProject = hubProjectsForEmails.find(
    (p) => p.id === project.projectId,
  );
  const assignedHubSuggestions = hubRowForProject
    ? uniqueEmailsForHubProject(hubRowForProject)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl max-h-[min(90vh,880px)] overflow-y-auto border-border bg-background shadow-xl p-0 gap-0"
        showCloseButton
      >
        <div className="px-6 pt-6 pb-2 border-b border-border bg-primary/10">
          <DialogHeader className="text-left space-y-1">
            <DialogTitle>
              Edit project
            </DialogTitle>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <Card className="border-border shadow-sm overflow-hidden">
            <CardHeader className="py-0 px-4 bg-muted/50 border-b border-border">
              <CardTitle className="text-sm font-medium text-foreground">
                Project info
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <Label>Project name</Label>
                <Input
                  value={project.name ?? ""}
                  disabled
                  className="bg-muted/60 text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  placeholder="What is this project about?"
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  rows={4}
                  className="resize-y min-h-[100px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-assigned-user-emails">
                    Assigned users (optional)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Hub emails for this workspace&apos;s linked project, or
                    type addresses manually.
                  </p>
                  <EmailMultiSelect
                    id="edit-assigned-user-emails"
                    value={assignedUserEmailTags}
                    onChange={setAssignedUserEmailTags}
                    suggestions={assignedHubSuggestions}
                    error={validationErrors.assignedUserEmails}
                    placeholder="Email, then Enter"
                  />
                  {validationErrors.assignedUserEmails && (
                    <p className="text-sm text-destructive">
                      {validationErrors.assignedUserEmails}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-stakeholder-emails">
                    Stakeholders (optional)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Add manually. Only these emails can confirm a public release
                    lock.
                  </p>
                  <EmailMultiSelect
                    id="edit-stakeholder-emails"
                    value={stakeholderEmailTags}
                    onChange={setStakeholderEmailTags}
                    suggestions={[]}
                    error={validationErrors.stakeholderEmails}
                    placeholder="Email, then Enter"
                  />
                  {validationErrors.stakeholderEmails && (
                    <p className="text-sm text-destructive">
                      {validationErrors.stakeholderEmails}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {useSharedOAuthCard ? (
            <ProjectGitJiraOAuthCard
              ref={gitJiraRef}
              variant="edit"
              projectId={project.id}
              editProject={project}
              integrationsPayload={creatorIntegrations}
              integrationsLoading={loadingCreatorInt}
              validationErrors={validationErrors}
              syncKey={open && project?.id != null ? String(project.id) : "__closed__"}
            />
          ) : (
          <>
          <Card className="border-border shadow-sm overflow-hidden">
            <CardHeader className="py-3 px-4 bg-muted/50 border-b border-border">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm font-medium text-foreground">
                  GitHub configuration
                </CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground shrink-0 h-8"
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
            <CardContent className="pt-4 space-y-4">
              {useOAuthGithub && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground space-y-2">
                  <p>
                    <span className="font-medium text-foreground">GitHub via OAuth.</span>{" "}
                    Tokens stay on the server. Update the linked account under{" "}
                    <Link
                      to="/settings/integrations"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Integrations
                    </Link>
                    {canEditOAuthLinks ? " or reconnect below." : "."}
                  </p>
                  {!canEditOAuthLinks && (
                    <p className="text-xs">
                      Only the project creator or an admin can change OAuth links. Others can still
                      edit the repository path if the new repo is accessible with the creator&apos;s
                      GitHub account.
                    </p>
                  )}
                  {canEditOAuthLinks && creatorIntegrations && (
                    <div className="space-y-2 border-t border-border pt-3 mt-2">
                      <Label className="text-xs text-foreground">GitHub account</Label>
                      {loadingCreatorInt ? (
                        <p className="text-xs text-muted-foreground">Loading…</p>
                      ) : (
                        <Select
                          value={selectedGithubConnectionId || undefined}
                          onValueChange={setSelectedGithubConnectionId}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select connection" />
                          </SelectTrigger>
                          <SelectContent className="max-h-60">
                            {(creatorIntegrations.github?.connections ?? []).map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.login ? `@${c.login}` : `Connection #${c.id}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {githubReposEdit.length > 0 && (
                        <div className="space-y-1">
                          <Label className="text-xs text-foreground">Pick repository (optional)</Label>
                          <Select
                            key={githubRepoPickSeq}
                            onValueChange={(v) => {
                              setGitRepoPath(v);
                              setGithubRepoPickSeq((s) => s + 1);
                            }}
                          >
                            <SelectTrigger className="h-9" disabled={reposLoadingEdit}>
                              <SelectValue
                                placeholder={
                                  reposLoadingEdit ? "Loading repos…" : "Choose to fill path…"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent className="max-h-52">
                              {githubReposEdit.map((r) => (
                                <SelectItem key={r.gitRepoPath} value={r.gitRepoPath}>
                                  {r.fullName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  )}
                  {canEditOAuthLinks && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={oauthBusy || !selectedGithubConnectionId}
                      onClick={async () => {
                        setOauthBusy("gh");
                        try {
                          window.location.href = await getGithubOAuthAuthorizeUrl(
                            selectedGithubConnectionId,
                          );
                        } catch (e) {
                          toast.error(e.message || "Could not start GitHub OAuth");
                          setOauthBusy(null);
                        }
                      }}
                    >
                      {oauthBusy === "gh" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Reconnect this GitHub account
                    </Button>
                  )}
                </div>
              )}
              {showGithubGuide && !useOAuthGithub && (
                <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-foreground space-y-3">
                  <p className="font-medium text-foreground">How to get your GitHub credentials</p>
                  <ol className="list-decimal list-inside space-y-2">
                    <li>
                      <strong>Username</strong> — Your GitHub login (e.g. the part before{" "}
                      <code className="bg-muted px-1 rounded text-sm">github.com/your-username</code>).
                    </li>
                    <li>
                      <strong>Personal Access Token</strong> —{" "}
                      <a
                        href="https://github.com/settings/tokens"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-0.5"
                      >
                        github.com/settings/tokens <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  </ol>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-githubUsername">GitHub username</Label>
                  <Input
                    id="edit-githubUsername"
                    placeholder="octocat"
                    value={githubUsername}
                    onChange={(e) => setGithubUsername(e.target.value)}
                    disabled={useOAuthGithub}
                    className={validationErrors.githubUsername ? "border-destructive" : ""}
                  />
                  {validationErrors.githubUsername && (
                    <p className="text-sm text-destructive">{validationErrors.githubUsername}</p>
                  )}
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="edit-gitRepoPath">Git repository path</Label>
                  <Input
                    id="edit-gitRepoPath"
                    placeholder="github.com/org/repository"
                    value={gitRepoPath}
                    onChange={(e) => setGitRepoPath(e.target.value)}
                    className={validationErrors.gitRepoPath ? "border-destructive" : ""}
                  />
                  {validationErrors.gitRepoPath && (
                    <p className="text-sm text-destructive">{validationErrors.gitRepoPath}</p>
                  )}
                  {gitRepoPath.trim() &&
                    gitRepoPath.trim() !== String(project?.gitRepoPath || "").trim() && (
                      <p className="text-xs text-muted-foreground rounded-md border border-border bg-muted/20 p-2">
                        Saving a <strong>new</strong> path runs a one-time migration: the server
                        fetches <strong>all branches and tags</strong> from the old GitHub or
                        Bitbucket remote and pushes them to the new repo (append / update only — it
                        does not delete existing refs on the destination). Release{" "}
                        <strong>tags</strong> used by this project must appear on the new remote
                        after migration.
                      </p>
                    )}
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="edit-developmentRepoUrl">Developer repository (optional)</Label>
                  <p className="text-xs text-muted-foreground">
                    On lock, the server clones the developer repo, pins the platform repo as a
                    submodule at <code className="text-xs">launchpad-frontend/</code>, runs{" "}
                    <code className="text-xs">git fetch</code> /{" "}
                    <code className="text-xs">git checkout &lt;commit&gt;</code> there for the active
                    version, then <code className="text-xs">git commit</code> /{" "}
                    <code className="text-xs">git push</code> on the parent. Commit message: env{" "}
                    <code className="text-xs">DEVELOPER_SUBMODULE_PARENT_COMMIT_MESSAGE</code> or
                    &quot;Update the Launchpad branch&quot;.
                  </p>
                  <Input
                    id="edit-developmentRepoUrl"
                    placeholder="github.com/org/customer-repo"
                    value={developmentRepoUrl}
                    onChange={(e) => setDevelopmentRepoUrl(e.target.value)}
                    className={validationErrors.developmentRepoUrl ? "border-destructive" : ""}
                  />
                  {githubReposEdit.length > 0 && useOAuthGithub && canEditOAuthLinks && (
                    <Select
                      key={developmentRepoPickSeq}
                      onValueChange={(v) => {
                        setDevelopmentRepoUrl(v);
                        setDevelopmentRepoPickSeq((s) => s + 1);
                      }}
                    >
                      <SelectTrigger className="h-9" disabled={reposLoadingEdit}>
                        <SelectValue placeholder="Or pick developer repo from list…" />
                      </SelectTrigger>
                      <SelectContent className="max-h-52">
                        {githubReposEdit.map((r) => (
                          <SelectItem key={`edit-dev-${r.gitRepoPath}`} value={r.gitRepoPath}>
                            {r.fullName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {validationErrors.developmentRepoUrl && (
                    <p className="text-sm text-destructive">{validationErrors.developmentRepoUrl}</p>
                  )}
                </div>
                {!useOAuthGithub && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit-githubToken">GitHub Personal Access Token</Label>
                    <div className="relative">
                      <Input
                        id="edit-githubToken"
                        type={showGithubToken ? "text" : "password"}
                        autoComplete="off"
                        placeholder="ghp_…"
                        value={githubToken}
                        onChange={(e) => setGithubToken(e.target.value)}
                        className={`pr-10 ${validationErrors.githubToken ? "border-destructive" : ""}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowGithubToken((v) => !v)}
                        aria-label={showGithubToken ? "Hide GitHub token" : "Show GitHub token"}
                      >
                        {showGithubToken ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {validationErrors.githubToken && (
                      <p className="text-sm text-destructive">{validationErrors.githubToken}</p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm overflow-hidden">
            <CardHeader className="py-3 px-4 bg-muted/50 border-b border-border">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm font-medium text-foreground">
                  Jira configuration
                </CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground shrink-0 h-8"
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
            <CardContent className="pt-4 space-y-4">
              {useOAuthJira && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground space-y-2">
                  <p>
                    <span className="font-medium text-foreground">Jira via OAuth.</span>{" "}
                    Manage the Atlassian link under{" "}
                    <Link
                      to="/settings/integrations"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Integrations
                    </Link>
                    {canEditOAuthLinks ? " or reconnect below." : "."}
                  </p>
                  {!canEditOAuthLinks && (
                    <p className="text-xs">
                      Only the project creator or an admin can change Jira OAuth. You can still edit
                      the Jira <strong>project key</strong> for this workspace.
                    </p>
                  )}
                  {canEditOAuthLinks && creatorIntegrations && (
                    <div className="space-y-2 border-t border-border pt-3 mt-2">
                      <Label className="text-xs text-foreground">Jira site</Label>
                      {loadingCreatorInt ? (
                        <p className="text-xs text-muted-foreground">Loading…</p>
                      ) : (
                        <Select
                          value={selectedJiraConnectionId || undefined}
                          onValueChange={setSelectedJiraConnectionId}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select connection" />
                          </SelectTrigger>
                          <SelectContent className="max-h-60">
                            {(creatorIntegrations.jira?.connections ?? []).map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.baseUrl || `Site #${c.id}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {jiraProjectsEdit.length > 0 && (
                        <div className="space-y-1">
                          <Label className="text-xs text-foreground">Pick project (optional)</Label>
                          <Select
                            value={
                              jiraProjectsEdit.some((p) => p.key === jiraProjectKey)
                                ? jiraProjectKey
                                : undefined
                            }
                            onValueChange={(key) => setJiraProjectKey(key)}
                            disabled={jiraProjectsLoadingEdit}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Choose Jira project…" />
                            </SelectTrigger>
                            <SelectContent className="max-h-52">
                              {jiraProjectsEdit.map((p) => (
                                <SelectItem key={p.id} value={p.key}>
                                  {p.key} — {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  )}
                  {canEditOAuthLinks && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={oauthBusy || !selectedJiraConnectionId}
                      onClick={async () => {
                        setOauthBusy("ji");
                        try {
                          window.location.href = await getJiraOAuthAuthorizeUrl(
                            selectedJiraConnectionId,
                          );
                        } catch (e) {
                          toast.error(e.message || "Could not start Jira OAuth");
                          setOauthBusy(null);
                        }
                      }}
                    >
                      {oauthBusy === "ji" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Reconnect this Jira site
                    </Button>
                  )}
                </div>
              )}
              {showJiraGuide && !useOAuthJira && (
                <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-foreground space-y-3">
                  <p className="font-medium text-foreground">How to get your Jira credentials</p>
                  <ol className="list-decimal list-inside space-y-2">
                    <li>
                      <strong>Jira Base URL</strong> — e.g.{" "}
                      <code className="bg-muted px-1 rounded text-sm">https://yourcompany.atlassian.net</code>
                    </li>
                    <li>
                      <strong>API token</strong> —{" "}
                      <a
                        href="https://id.atlassian.com/manage-profile/security/api-tokens"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-0.5"
                      >
                        Atlassian API tokens <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  </ol>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-jiraBaseUrl">Jira site URL</Label>
                  <Input
                    id="edit-jiraBaseUrl"
                    placeholder="https://mycompany.atlassian.net"
                    value={jiraBaseUrl}
                    onChange={(e) => setJiraBaseUrl(e.target.value)}
                    disabled={useOAuthJira}
                    className={validationErrors.jiraBaseUrl ? "border-destructive" : ""}
                  />
                  {validationErrors.jiraBaseUrl && (
                    <p className="text-sm text-destructive">{validationErrors.jiraBaseUrl}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-jiraUsername">Jira account email</Label>
                  <Input
                    id="edit-jiraUsername"
                    placeholder="you@company.com"
                    value={jiraUsername}
                    onChange={(e) => setJiraUsername(e.target.value)}
                    disabled={useOAuthJira}
                    className={validationErrors.jiraUsername ? "border-destructive" : ""}
                  />
                  {validationErrors.jiraUsername && (
                    <p className="text-sm text-destructive">{validationErrors.jiraUsername}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-jiraProjectKey">Jira project key</Label>
                <Input
                  id="edit-jiraProjectKey"
                  placeholder="PROJ"
                  value={jiraProjectKey}
                  onChange={(e) => setJiraProjectKey(e.target.value)}
                  className={validationErrors.jiraProjectKey ? "border-destructive" : ""}
                />
                {validationErrors.jiraProjectKey && (
                  <p className="text-sm text-destructive">{validationErrors.jiraProjectKey}</p>
                )}
                {useOAuthJira && (
                  <p className="text-xs text-muted-foreground">
                    This is the short project code in Jira (not your OAuth site). Change it if this
                    workspace should use a different Jira project.
                  </p>
                )}
              </div>

              {!useOAuthJira && (
                <div className="space-y-2">
                  <Label htmlFor="edit-jiraApiToken">Jira API token</Label>
                  <div className="relative">
                    <Input
                      id="edit-jiraApiToken"
                      type={showJiraToken ? "text" : "password"}
                      autoComplete="off"
                      placeholder="ATATT…"
                      value={jiraApiToken}
                      onChange={(e) => setJiraApiToken(e.target.value)}
                      className={`pr-10 ${validationErrors.jiraApiToken ? "border-destructive" : ""}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowJiraToken((v) => !v)}
                      aria-label={showJiraToken ? "Hide Jira token" : "Show Jira token"}
                    >
                      {showJiraToken ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {validationErrors.jiraApiToken && (
                    <p className="text-sm text-destructive">{validationErrors.jiraApiToken}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          </>
          )}

          <DialogFooter className="pt-2 gap-2 border-t border-border mt-2 -mx-6 px-6 py-4 bg-muted/30">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="default" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditProjectDialog;
