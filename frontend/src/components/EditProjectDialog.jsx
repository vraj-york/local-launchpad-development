import React, { useEffect, useState } from "react";
import { updateProject, fetchExternalHubProjects } from "@/api";
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
  Loader2,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";

function normEmailListField(v) {
  if (v == null || String(v).trim() === "") return null;
  return String(v).trim();
}

function buildUpdatePayload({
  description,
  githubUsername,
  githubToken,
  jiraBaseUrl,
  jiraUsername,
  jiraProjectKey,
  jiraApiToken,
  assignedUserEmails,
  stakeholderEmails,
  project,
}) {
  const payload = {};

  if (description !== undefined) {
    const t = description.trim();
    payload.description = t === "" ? null : t;
  }

  const ghUser = githubUsername.trim();
  if (ghUser) payload.githubUsername = ghUser;

  const ghTok = githubToken.trim();
  if (ghTok) payload.githubToken = ghTok;

  const jBase = jiraBaseUrl.trim();
  if (jBase) payload.jiraBaseUrl = jBase;

  const jUser = jiraUsername.trim();
  if (jUser) payload.jiraUsername = jUser;

  const jKey = jiraProjectKey.trim();
  if (jKey) payload.jiraProjectKey = jKey;

  const jTok = jiraApiToken.trim();
  if (jTok) payload.jiraApiToken = jTok;

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

  return payload;
}

const EditProjectDialog = ({ open, onOpenChange, project, onSaved }) => {

  const [projectDescription, setProjectDescription] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraUsername, setJiraUsername] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");

  const [assignedUserEmailTags, setAssignedUserEmailTags] = useState([]);
  const [stakeholderEmailTags, setStakeholderEmailTags] = useState([]);
  const [hubProjectsForEmails, setHubProjectsForEmails] = useState([]);

  const [validationErrors, setValidationErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [showGithubGuide, setShowGithubGuide] = useState(false);
  const [showJiraGuide, setShowJiraGuide] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [showJiraToken, setShowJiraToken] = useState(false);

  useEffect(() => {
    if (!open || !project) return;
    setProjectDescription(project.description ?? "");
    setGithubUsername(project.githubUsername ?? "");
    setGithubToken(project.githubToken ?? "");
    setJiraBaseUrl(project.jiraBaseUrl ?? "");
    setJiraUsername(project.jiraUsername ?? "");
    setJiraProjectKey(project.jiraProjectKey ?? "");
    setJiraApiToken(project.jiraApiToken ?? "");
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

  const validateForm = () => {
    const errors = {};

    if (!githubUsername.trim()) {
      errors.githubUsername = "GitHub username is required";
    }
    const githubStored = Boolean(project?.githubToken?.trim?.());
    if (!githubToken.trim() && !githubStored) {
      errors.githubToken =
        "GitHub token is required (stored credentials missing; add a token to save)";
    }

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
      const payload = buildUpdatePayload({
        description: projectDescription,
        githubUsername,
        githubToken,
        jiraBaseUrl,
        jiraUsername,
        jiraProjectKey,
        jiraApiToken,
        assignedUserEmails: emailsArrayToStorageString(assignedUserEmailTags),
        stakeholderEmails: emailsArrayToStorageString(stakeholderEmailTags),
        project,
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
              {showGithubGuide && (
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
                    className={validationErrors.githubUsername ? "border-destructive" : ""}
                  />
                  {validationErrors.githubUsername && (
                    <p className="text-sm text-destructive">{validationErrors.githubUsername}</p>
                  )}
                </div>
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
              {showJiraGuide && (
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
                  <Label htmlFor="edit-jiraBaseUrl">Jira Base URL</Label>
                  <Input
                    id="edit-jiraBaseUrl"
                    placeholder="https://mycompany.atlassian.net"
                    value={jiraBaseUrl}
                    onChange={(e) => setJiraBaseUrl(e.target.value)}
                    className={validationErrors.jiraBaseUrl ? "border-destructive" : ""}
                  />
                  {validationErrors.jiraBaseUrl && (
                    <p className="text-sm text-destructive">{validationErrors.jiraBaseUrl}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-jiraUsername">Jira username (email)</Label>
                  <Input
                    id="edit-jiraUsername"
                    placeholder="you@company.com"
                    value={jiraUsername}
                    onChange={(e) => setJiraUsername(e.target.value)}
                    className={validationErrors.jiraUsername ? "border-destructive" : ""}
                  />
                  {validationErrors.jiraUsername && (
                    <p className="text-sm text-destructive">{validationErrors.jiraUsername}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-jiraProjectKey">Project key</Label>
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
              </div>

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
            </CardContent>
          </Card>

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
