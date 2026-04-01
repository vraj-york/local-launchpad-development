import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  forwardRef,
} from "react";
import { Link } from "react-router-dom";
import {
  fetchGithubReposPage,
  fetchJiraProjectsForConnection,
  getGithubOAuthAuthorizeUrl,
  getJiraOAuthAuthorizeUrl,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Shared GitHub + Jira OAuth UI for create project and edit project (creator/admin).
 * @typedef {{ github?: { connections?: Array<{id:number, login?:string|null}> }, jira?: { connections?: Array<{id:number, baseUrl?:string|null}> } }} IntegrationsPayload
 */
const ProjectGitJiraOAuthCard = forwardRef(function ProjectGitJiraOAuthCard(
  {
    variant,
    projectId,
    integrationsPayload,
    integrationsLoading,
    validationErrors,
    syncKey,
    editProject,
  },
  ref,
) {
  const isEdit = variant === "edit";

  const [selectedGithubConnectionId, setSelectedGithubConnectionId] = useState("");
  const [selectedJiraConnectionId, setSelectedJiraConnectionId] = useState("");
  const [repoMode, setRepoMode] = useState(isEdit ? "keep" : "auto");
  const [pickedRepoPath, setPickedRepoPath] = useState("");
  const [gitRepoPathManual, setGitRepoPathManual] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [oauthBusy, setOauthBusy] = useState(null);
  const [githubRepos, setGithubRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposPage, setReposPage] = useState(1);
  const [reposHasMore, setReposHasMore] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [jiraProjects, setJiraProjects] = useState([]);
  const [jiraProjectsLoading, setJiraProjectsLoading] = useState(false);
  const [jiraBaseUrlResolved, setJiraBaseUrlResolved] = useState("");

  const githubConnections = integrationsPayload?.github?.connections ?? [];
  const jiraConnections = integrationsPayload?.jira?.connections ?? [];

  const filteredGithubRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return githubRepos;
    return githubRepos.filter((r) =>
      String(r.fullName || "").toLowerCase().includes(q),
    );
  }, [githubRepos, repoSearch]);

  const gitRepoPath =
    repoMode === "manual"
      ? gitRepoPathManual
      : repoMode === "pick"
        ? pickedRepoPath
        : "";

  useEffect(() => {
    if (syncKey === "__closed__" || !syncKey) return;
    if (isEdit && editProject) {
      setSelectedGithubConnectionId(
        editProject.githubConnectionId != null
          ? String(editProject.githubConnectionId)
          : "",
      );
      setSelectedJiraConnectionId(
        editProject.jiraConnectionId != null ? String(editProject.jiraConnectionId) : "",
      );
      setRepoMode("keep");
      setPickedRepoPath("");
      setGitRepoPathManual("");
      setRepoSearch("");
      setJiraProjectKey(editProject.jiraProjectKey ?? "");
      setGithubRepos([]);
      setReposHasMore(false);
      setReposPage(1);
      setJiraProjects([]);
      setJiraBaseUrlResolved("");
      return;
    }
    if (!isEdit) {
      setRepoMode("auto");
      setPickedRepoPath("");
      setGitRepoPathManual("");
      setRepoSearch("");
      setJiraProjectKey("");
    }
  }, [syncKey, isEdit, editProject]);

  useEffect(() => {
    if (!integrationsPayload) return;
    const gh = integrationsPayload.github?.connections ?? [];
    const ji = integrationsPayload.jira?.connections ?? [];
    setSelectedGithubConnectionId((prev) => {
      if (isEdit && editProject?.githubConnectionId != null) {
        const want = String(editProject.githubConnectionId);
        if (gh.some((c) => String(c.id) === want)) return want;
      }
      if (prev && gh.some((c) => String(c.id) === prev)) return prev;
      return gh[0] ? String(gh[0].id) : "";
    });
    setSelectedJiraConnectionId((prev) => {
      if (isEdit && editProject?.jiraConnectionId != null) {
        const want = String(editProject.jiraConnectionId);
        if (ji.some((c) => String(c.id) === want)) return want;
      }
      if (prev && ji.some((c) => String(c.id) === prev)) return prev;
      return ji[0] ? String(ji[0].id) : "";
    });
  }, [integrationsPayload, isEdit, editProject]);

  const repoListOpts = useMemo(() => {
    const o = {};
    if (isEdit && projectId) o.projectId = projectId;
    return o;
  }, [isEdit, projectId]);

  useEffect(() => {
    if (!selectedGithubConnectionId) {
      setGithubRepos([]);
      setReposHasMore(false);
      setReposPage(1);
      return;
    }
    let cancelled = false;
    (async () => {
      setReposLoading(true);
      setGithubRepos([]);
      setReposPage(1);
      try {
        const data = await fetchGithubReposPage(selectedGithubConnectionId, {
          page: 1,
          ...repoListOpts,
        });
        if (!cancelled) {
          setGithubRepos(data.repos || []);
          setReposHasMore(Boolean(data.hasMore));
          setReposPage(1);
        }
      } catch (e) {
        const msg =
          e?.response?.data?.error || e?.message || "Could not load GitHub repositories";
        if (!cancelled) {
          toast.error(msg);
          setGithubRepos([]);
          setReposHasMore(false);
        }
      } finally {
        if (!cancelled) setReposLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedGithubConnectionId, repoListOpts]);

  useEffect(() => {
    if (!selectedJiraConnectionId) {
      setJiraProjects([]);
      setJiraBaseUrlResolved("");
      return;
    }
    let cancelled = false;
    (async () => {
      setJiraProjectsLoading(true);
      try {
        const data = await fetchJiraProjectsForConnection(selectedJiraConnectionId, repoListOpts);
        if (!cancelled) {
          setJiraProjects(Array.isArray(data.projects) ? data.projects : []);
          setJiraBaseUrlResolved(data.jiraBaseUrl || "");
        }
      } catch (e) {
        const msg =
          e?.response?.data?.error || e?.message || "Could not load Jira projects";
        if (!cancelled) {
          toast.error(msg);
          setJiraProjects([]);
          setJiraBaseUrlResolved("");
        }
      } finally {
        if (!cancelled) setJiraProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedJiraConnectionId, repoListOpts]);

  const loadMoreGithubRepos = useCallback(async () => {
    if (!selectedGithubConnectionId || !reposHasMore || reposLoading) return;
    setReposLoading(true);
    const nextPage = reposPage + 1;
    try {
      const data = await fetchGithubReposPage(selectedGithubConnectionId, {
        page: nextPage,
        ...repoListOpts,
      });
      setGithubRepos((prev) => [...prev, ...(data.repos || [])]);
      setReposHasMore(Boolean(data.hasMore));
      setReposPage(nextPage);
    } catch (e) {
      toast.error(
        e?.response?.data?.error || e.message || "Could not load more repositories",
      );
    } finally {
      setReposLoading(false);
    }
  }, [
    selectedGithubConnectionId,
    reposHasMore,
    reposLoading,
    reposPage,
    repoListOpts,
  ]);

  const validateCreate = useCallback(
    (integrationsLoadingFlag) => {
      const errors = {};
      const ghConns = integrationsPayload?.github?.connections ?? [];
      const jiConns = integrationsPayload?.jira?.connections ?? [];
      if (integrationsLoadingFlag) {
        errors.integrations = "Checking integrations…";
      } else if (ghConns.length === 0) {
        errors.integrations =
          "Add at least one GitHub account (Integrations) before continuing";
      } else if (!selectedGithubConnectionId) {
        errors.integrations = "Select a GitHub account for this project";
      } else if (jiConns.length === 0) {
        errors.integrations = "Add at least one Jira site (Integrations) before continuing";
      } else if (!selectedJiraConnectionId) {
        errors.integrations = "Select a Jira site for this project";
      }
      if (!jiraProjectKey.trim()) {
        errors.jiraProjectKey =
          "Jira project key is required (pick a project or type the key)";
      }
      if (repoMode === "manual") {
        if (!gitRepoPathManual.trim()) {
          errors.gitRepoPath = "Enter a repository path (e.g. github.com/org/repo)";
        }
      } else if (repoMode === "pick") {
        if (!pickedRepoPath.trim()) {
          errors.gitRepoPath = "Choose a repository from the list";
        }
      }
      return errors;
    },
    [
      integrationsPayload,
      selectedGithubConnectionId,
      selectedJiraConnectionId,
      jiraProjectKey,
      repoMode,
      gitRepoPathManual,
      pickedRepoPath,
    ],
  );

  const validateEdit = useCallback(
    (project, integrationsLoadingFlag) => {
      const errors = {};
      const ghConns = integrationsPayload?.github?.connections ?? [];
      const jiConns = integrationsPayload?.jira?.connections ?? [];
      if (integrationsLoadingFlag) {
        errors.integrations = "Loading integration connections…";
      } else if (ghConns.length === 0) {
        errors.integrations = "No GitHub OAuth connections for the project owner";
      } else if (!selectedGithubConnectionId) {
        errors.integrations = "Select a GitHub account";
      } else if (jiConns.length === 0) {
        errors.integrations = "No Jira OAuth connections for the project owner";
      } else if (!selectedJiraConnectionId) {
        errors.integrations = "Select a Jira site";
      }
      if (!jiraProjectKey.trim()) {
        errors.jiraProjectKey = "Jira project key is required";
      }
      const currentPath = String(project?.gitRepoPath || "").trim();
      if (repoMode === "keep") {
        if (!currentPath) errors.gitRepoPath = "Git repository path is missing; pick or enter a path";
      } else if (repoMode === "manual") {
        if (!gitRepoPathManual.trim()) {
          errors.gitRepoPath = "Enter a repository path";
        }
      } else if (repoMode === "pick") {
        if (!pickedRepoPath.trim()) {
          errors.gitRepoPath = "Choose a repository from the list";
        }
      }
      return errors;
    },
    [
      integrationsPayload,
      selectedGithubConnectionId,
      selectedJiraConnectionId,
      jiraProjectKey,
      repoMode,
      gitRepoPathManual,
      pickedRepoPath,
    ],
  );

  const getCreatePayload = useCallback(() => {
    const jiConns = integrationsPayload?.jira?.connections ?? [];
    const jiConn = jiConns.find((c) => String(c.id) === selectedJiraConnectionId);
    let gitRepoPathOut;
    if (repoMode === "manual") {
      gitRepoPathOut = gitRepoPathManual.trim() || undefined;
    } else if (repoMode === "pick") {
      gitRepoPathOut = pickedRepoPath.trim() || undefined;
    } else {
      gitRepoPathOut = undefined;
    }
    return {
      githubConnectionId: Number(selectedGithubConnectionId),
      jiraConnectionId: Number(selectedJiraConnectionId),
      gitRepoPath: gitRepoPathOut,
      jiraProjectKey: jiraProjectKey.trim(),
      jiraBaseUrl: jiraBaseUrlResolved || jiConn?.baseUrl || undefined,
    };
  }, [
    integrationsPayload,
    selectedGithubConnectionId,
    selectedJiraConnectionId,
    repoMode,
    gitRepoPathManual,
    pickedRepoPath,
    jiraProjectKey,
    jiraBaseUrlResolved,
  ]);

  const getEditResolvedGitRepoPath = useCallback(
    (project) => {
      if (repoMode === "keep") return String(project?.gitRepoPath || "").trim();
      if (repoMode === "pick") return pickedRepoPath.trim();
      return gitRepoPathManual.trim();
    },
    [repoMode, pickedRepoPath, gitRepoPathManual],
  );

  const editNextRepoPath = useMemo(() => {
    if (!isEdit || !editProject) return "";
    if (repoMode === "keep") return String(editProject.gitRepoPath || "").trim();
    if (repoMode === "pick") return pickedRepoPath.trim();
    return gitRepoPathManual.trim();
  }, [isEdit, editProject, repoMode, pickedRepoPath, gitRepoPathManual]);

  const showRepoMigrationHint =
    isEdit &&
    editProject &&
    repoMode !== "keep" &&
    editNextRepoPath &&
    editNextRepoPath !== String(editProject.gitRepoPath || "").trim();

  useImperativeHandle(
    ref,
    () => ({
      validateCreate,
      validateEdit,
      getCreatePayload,
      getEditResolvedGitRepoPath,
      getSelectedGithubConnectionId: () => selectedGithubConnectionId,
      getSelectedJiraConnectionId: () => selectedJiraConnectionId,
      getJiraProjectKey: () => jiraProjectKey.trim(),
      getJiraBaseUrl: () => {
        const jiConns = integrationsPayload?.jira?.connections ?? [];
        const jiConn = jiConns.find((c) => String(c.id) === selectedJiraConnectionId);
        return jiraBaseUrlResolved || jiConn?.baseUrl || "";
      },
    }),
    [
      validateCreate,
      validateEdit,
      getCreatePayload,
      getEditResolvedGitRepoPath,
      selectedGithubConnectionId,
      selectedJiraConnectionId,
      jiraProjectKey,
      jiraBaseUrlResolved,
      integrationsPayload,
    ],
  );

  return (
    <Card className="border-slate-200 overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold text-slate-800">
          GitHub &amp; Jira for this project
        </CardTitle>
        <p className="text-sm text-muted-foreground font-normal pt-1">
          {isEdit ? (
            <>
              Same options as create project. Add accounts on{" "}
              <Link
                to="/settings/integrations"
                className="text-primary underline-offset-4 hover:underline"
              >
                Integrations
              </Link>
              ; signing in with an account you already use only refreshes that connection.
            </>
          ) : (
            <>
              Choose which saved accounts this workspace uses. Add more on{" "}
              <Link
                to="/settings/integrations"
                className="text-primary underline-offset-4 hover:underline"
              >
                Integrations
              </Link>
              .
            </>
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {validationErrors.integrations && (
          <p className="text-sm text-destructive">{validationErrors.integrations}</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3 rounded-lg border border-slate-200 p-4">
            <div className="font-medium text-slate-800">GitHub account</div>
            {integrationsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <Select
                  value={selectedGithubConnectionId || undefined}
                  onValueChange={setSelectedGithubConnectionId}
                  disabled={githubConnections.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select GitHub account" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {githubConnections.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.login ? `@${c.login}` : `Account #${c.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={integrationsLoading || oauthBusy}
                  onClick={async () => {
                    setOauthBusy("gh");
                    try {
                      const url = isEdit
                        ? await getGithubOAuthAuthorizeUrl(selectedGithubConnectionId)
                        : await getGithubOAuthAuthorizeUrl();
                      window.location.href = url;
                    } catch (e) {
                      toast.error(e.message || "Could not start GitHub OAuth");
                      setOauthBusy(null);
                    }
                  }}
                >
                  {oauthBusy === "gh" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {isEdit ? "Reconnect selected account" : "Add GitHub account"}
                </Button>
              </>
            )}
          </div>
          <div className="space-y-3 rounded-lg border border-slate-200 p-4">
            <div className="font-medium text-slate-800">Jira site</div>
            {integrationsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <Select
                  value={selectedJiraConnectionId || undefined}
                  onValueChange={setSelectedJiraConnectionId}
                  disabled={jiraConnections.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Jira site" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {jiraConnections.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.baseUrl || `Site #${c.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={integrationsLoading || oauthBusy}
                  onClick={async () => {
                    setOauthBusy("ji");
                    try {
                      const url = isEdit
                        ? await getJiraOAuthAuthorizeUrl(selectedJiraConnectionId)
                        : await getJiraOAuthAuthorizeUrl();
                      window.location.href = url;
                    } catch (e) {
                      toast.error(e.message || "Could not start Jira OAuth");
                      setOauthBusy(null);
                    }
                  }}
                >
                  {oauthBusy === "ji" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {isEdit ? "Reconnect selected site" : "Add Jira site"}
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Repository</Label>
          <Select
            value={repoMode}
            onValueChange={(v) => {
              setRepoMode(v);
              if (v !== "pick") setPickedRepoPath("");
              if (v !== "manual") setGitRepoPathManual("");
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {isEdit ? (
                <SelectItem value="keep">Keep current repository path</SelectItem>
              ) : (
                <SelectItem value="auto">Create new repository (default)</SelectItem>
              )}
              <SelectItem value="pick">Link an existing repository</SelectItem>
              <SelectItem value="manual">Enter repository path manually</SelectItem>
            </SelectContent>
          </Select>
          {repoMode === "pick" && (
            <div className="space-y-2 pt-1">
              <Input
                placeholder="Filter repositories…"
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                disabled={!selectedGithubConnectionId || reposLoading}
              />
              <Select
                value={pickedRepoPath || undefined}
                onValueChange={setPickedRepoPath}
                disabled={!selectedGithubConnectionId || reposLoading}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={reposLoading ? "Loading…" : "Choose repository"}
                  />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {filteredGithubRepos.map((r) => (
                    <SelectItem key={r.gitRepoPath} value={r.gitRepoPath}>
                      {r.fullName}
                      {r.private ? " (private)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reposHasMore && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={reposLoading}
                  onClick={loadMoreGithubRepos}
                >
                  {reposLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Load more
                </Button>
              )}
            </div>
          )}
          {repoMode === "manual" && (
            <div className="space-y-1 pt-1">
              <Input
                id="gitRepoPathManual-shared"
                placeholder="github.com/org/repository"
                value={gitRepoPath}
                onChange={(e) => setGitRepoPathManual(e.target.value)}
                className={
                  validationErrors.gitRepoPath ? "border-destructive" : ""
                }
              />
              <p className="text-xs text-muted-foreground">
                Must be a repo the selected GitHub account can access.
              </p>
            </div>
          )}
          {repoMode === "auto" && (
            <p className="text-xs text-muted-foreground">
              A new repository will be created under the selected GitHub account when you submit.
            </p>
          )}
          {repoMode === "keep" && isEdit && editProject?.gitRepoPath && (
            <p className="text-xs text-muted-foreground font-mono break-all">
              Current: {editProject.gitRepoPath}
            </p>
          )}
          {showRepoMigrationHint && (
              <p className="text-xs text-muted-foreground rounded-md border border-border bg-muted/20 p-2">
                Saving a <strong>new</strong> path runs a one-time migration (branches and tags pushed
                to the new remote; release tags must exist there afterward).
              </p>
            )}
          {validationErrors.gitRepoPath && (
            <p className="text-sm text-destructive">{validationErrors.gitRepoPath}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="jiraProjectPick-shared">Jira project</Label>
          {jiraProjectsLoading ? (
            <p className="text-sm text-muted-foreground">Loading projects…</p>
          ) : jiraProjects.length > 0 ? (
            <Select
              value={
                jiraProjects.some((p) => p.key === jiraProjectKey)
                  ? jiraProjectKey
                  : undefined
              }
              onValueChange={(key) => setJiraProjectKey(key)}
              disabled={!selectedJiraConnectionId}
            >
              <SelectTrigger id="jiraProjectPick-shared">
                <SelectValue placeholder="Select project (or type key below)" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {jiraProjects.map((p) => (
                  <SelectItem key={p.id} value={p.key}>
                    {p.key} — {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Label htmlFor="jiraProjectKey-shared" className="text-xs text-muted-foreground">
            Project key (required)
          </Label>
          <Input
            id="jiraProjectKey-shared"
            placeholder="e.g. PROJ"
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
      </CardContent>
    </Card>
  );
});

export default ProjectGitJiraOAuthCard;
