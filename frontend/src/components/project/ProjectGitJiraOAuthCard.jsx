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
  fetchBitbucketReposPage,
  fetchGithubReposPage,
  fetchJiraProjectsForConnection,
  getBitbucketOAuthAuthorizeUrl,
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

const GH_REPO_PATH_RE =
  /^(https?:\/\/)?github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?$/i;

/**
 * Shared GitHub or Bitbucket + Jira OAuth UI for create project and edit project (creator/admin).
 * @typedef {{
 *   github?: { connections?: Array<{id:number, login?:string|null}> },
 *   bitbucket?: { connections?: Array<{id:number, login?:string|null}> },
 *   jira?: { connections?: Array<{id:number, baseUrl?:string|null}> },
 * }} IntegrationsPayload
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

  const [scmHost, setScmHost] = useState("github");
  const [selectedGithubConnectionId, setSelectedGithubConnectionId] = useState("");
  const [selectedBitbucketConnectionId, setSelectedBitbucketConnectionId] = useState("");
  const [selectedJiraConnectionId, setSelectedJiraConnectionId] = useState("");
  const [repoMode, setRepoMode] = useState(isEdit ? "keep" : "auto");
  const [pickedRepoPath, setPickedRepoPath] = useState("");
  const [gitRepoPathManual, setGitRepoPathManual] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [oauthBusy, setOauthBusy] = useState(null);
  const [githubRepos, setGithubRepos] = useState([]);
  const [bitbucketRepos, setBitbucketRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposPage, setReposPage] = useState(1);
  const [reposHasMore, setReposHasMore] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [developerRepoUrlInput, setDeveloperRepoUrlInput] = useState("");
  const [devRepoPickNonce, setDevRepoPickNonce] = useState(0);
  const [jiraProjects, setJiraProjects] = useState([]);
  const [jiraProjectsLoading, setJiraProjectsLoading] = useState(false);
  const [jiraBaseUrlResolved, setJiraBaseUrlResolved] = useState("");

  const githubConnections = integrationsPayload?.github?.connections ?? [];
  const bitbucketConnections = integrationsPayload?.bitbucket?.connections ?? [];
  const jiraConnections = integrationsPayload?.jira?.connections ?? [];

  const activeRepos = scmHost === "github" ? githubRepos : bitbucketRepos;

  const filteredRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return activeRepos;
    return activeRepos.filter((r) =>
      String(r.fullName || "").toLowerCase().includes(q),
    );
  }, [activeRepos, repoSearch]);

  const gitRepoPath =
    repoMode === "manual"
      ? gitRepoPathManual
      : repoMode === "pick"
        ? pickedRepoPath
        : "";

  useEffect(() => {
    if (syncKey === "__closed__" || !syncKey) return;
    if (isEdit && editProject) {
      const useBb = editProject.bitbucketConnectionId != null;
      setScmHost(useBb ? "bitbucket" : "github");
      setSelectedGithubConnectionId(
        editProject.githubConnectionId != null
          ? String(editProject.githubConnectionId)
          : "",
      );
      setSelectedBitbucketConnectionId(
        editProject.bitbucketConnectionId != null
          ? String(editProject.bitbucketConnectionId)
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
      setDeveloperRepoUrlInput(String(editProject.developerRepoUrl ?? ""));
      setDevRepoPickNonce(0);
      setGithubRepos([]);
      setBitbucketRepos([]);
      setReposHasMore(false);
      setReposPage(1);
      setJiraProjects([]);
      setJiraBaseUrlResolved("");
      return;
    }
    if (!isEdit) {
      setScmHost("github");
      setRepoMode("auto");
      setPickedRepoPath("");
      setGitRepoPathManual("");
      setRepoSearch("");
      setDeveloperRepoUrlInput("");
      setDevRepoPickNonce(0);
      setJiraProjectKey("");
    }
  }, [syncKey, isEdit, editProject]);

  useEffect(() => {
    if (isEdit || !integrationsPayload) return;
    const gh = integrationsPayload.github?.connections ?? [];
    const bb = integrationsPayload.bitbucket?.connections ?? [];
    if (!gh.length && bb.length) setScmHost("bitbucket");
  }, [integrationsPayload, isEdit]);

  useEffect(() => {
    if (!integrationsPayload) return;
    const gh = integrationsPayload.github?.connections ?? [];
    const bb = integrationsPayload.bitbucket?.connections ?? [];
    const ji = integrationsPayload.jira?.connections ?? [];
    setSelectedGithubConnectionId((prev) => {
      if (isEdit && editProject?.githubConnectionId != null) {
        const want = String(editProject.githubConnectionId);
        if (gh.some((c) => String(c.id) === want)) return want;
      }
      if (prev && gh.some((c) => String(c.id) === prev)) return prev;
      return gh[0] ? String(gh[0].id) : "";
    });
    setSelectedBitbucketConnectionId((prev) => {
      if (isEdit && editProject?.bitbucketConnectionId != null) {
        const want = String(editProject.bitbucketConnectionId);
        if (bb.some((c) => String(c.id) === want)) return want;
      }
      if (prev && bb.some((c) => String(c.id) === prev)) return prev;
      return bb[0] ? String(bb[0].id) : "";
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
    const connId =
      scmHost === "github" ? selectedGithubConnectionId : selectedBitbucketConnectionId;
    if (!connId) {
      setGithubRepos([]);
      setBitbucketRepos([]);
      setReposHasMore(false);
      setReposPage(1);
      return;
    }
    let cancelled = false;
    (async () => {
      setReposLoading(true);
      setGithubRepos([]);
      setBitbucketRepos([]);
      setReposPage(1);
      try {
        const fetchPage =
          scmHost === "github" ? fetchGithubReposPage : fetchBitbucketReposPage;
        const data = await fetchPage(connId, {
          page: 1,
          ...repoListOpts,
        });
        if (!cancelled) {
          const rows = data.repos || [];
          if (scmHost === "github") setGithubRepos(rows);
          else setBitbucketRepos(rows);
          setReposHasMore(Boolean(data.hasMore));
          setReposPage(1);
        }
      } catch (e) {
        const msg =
          e?.response?.data?.error ||
          e?.message ||
          (scmHost === "github"
            ? "Could not load GitHub repositories"
            : "Could not load Bitbucket repositories");
        if (!cancelled) {
          toast.error(msg);
          setGithubRepos([]);
          setBitbucketRepos([]);
          setReposHasMore(false);
        }
      } finally {
        if (!cancelled) setReposLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    scmHost,
    selectedGithubConnectionId,
    selectedBitbucketConnectionId,
    repoListOpts,
  ]);

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

  const loadMoreRepos = useCallback(async () => {
    const connId =
      scmHost === "github" ? selectedGithubConnectionId : selectedBitbucketConnectionId;
    if (!connId || !reposHasMore || reposLoading) return;
    setReposLoading(true);
    const nextPage = reposPage + 1;
    try {
      const fetchPage =
        scmHost === "github" ? fetchGithubReposPage : fetchBitbucketReposPage;
      const data = await fetchPage(connId, {
        page: nextPage,
        ...repoListOpts,
      });
      const batch = data.repos || [];
      if (scmHost === "github") {
        setGithubRepos((prev) => [...prev, ...batch]);
      } else {
        setBitbucketRepos((prev) => [...prev, ...batch]);
      }
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
    scmHost,
    selectedGithubConnectionId,
    selectedBitbucketConnectionId,
    reposHasMore,
    reposLoading,
    reposPage,
    repoListOpts,
  ]);

  const validateCreate = useCallback(
    (integrationsLoadingFlag) => {
      const errors = {};
      const ghConns = integrationsPayload?.github?.connections ?? [];
      const bbConns = integrationsPayload?.bitbucket?.connections ?? [];
      const jiConns = integrationsPayload?.jira?.connections ?? [];
      if (integrationsLoadingFlag) {
        errors.integrations = "Checking integrations…";
      } else if (scmHost === "github") {
        if (ghConns.length === 0) {
          errors.integrations =
            "Add at least one GitHub account (Integrations) or switch code host to Bitbucket";
        } else if (!selectedGithubConnectionId) {
          errors.integrations = "Select a GitHub account for this project";
        }
      } else if (bbConns.length === 0) {
        errors.integrations =
          "Add at least one Bitbucket account (Integrations) or switch code host to GitHub";
      } else if (!selectedBitbucketConnectionId) {
        errors.integrations = "Select a Bitbucket account for this project";
      }
      if (!errors.integrations) {
        if (jiConns.length === 0) {
          errors.integrations = "Add at least one Jira site (Integrations) before continuing";
        } else if (!selectedJiraConnectionId) {
          errors.integrations = "Select a Jira site for this project";
        }
      }
      if (!jiraProjectKey.trim()) {
        errors.jiraProjectKey =
          "Jira project key is required (pick a project or type the key)";
      }
      if (repoMode === "manual") {
        if (!gitRepoPathManual.trim()) {
          errors.gitRepoPath =
            scmHost === "github"
              ? "Enter a repository path (e.g. github.com/org/repo)"
              : "Enter a repository path (e.g. bitbucket.org/workspace/repo-slug)";
        }
      } else if (repoMode === "pick") {
        if (!pickedRepoPath.trim()) {
          errors.gitRepoPath = "Choose a repository from the list";
        }
      }
      const dev = developerRepoUrlInput.trim();
      if (dev && !GH_REPO_PATH_RE.test(dev)) {
        errors.developerRepoUrl =
          "Enter a valid GitHub path (e.g. github.com/org/other-repo)";
      }
      return errors;
    },
    [
      integrationsPayload,
      scmHost,
      selectedGithubConnectionId,
      selectedBitbucketConnectionId,
      selectedJiraConnectionId,
      jiraProjectKey,
      repoMode,
      gitRepoPathManual,
      pickedRepoPath,
      developerRepoUrlInput,
    ],
  );

  const validateEdit = useCallback(
    (project, integrationsLoadingFlag) => {
      const errors = {};
      const ghConns = integrationsPayload?.github?.connections ?? [];
      const bbConns = integrationsPayload?.bitbucket?.connections ?? [];
      const jiConns = integrationsPayload?.jira?.connections ?? [];
      if (integrationsLoadingFlag) {
        errors.integrations = "Loading integration connections…";
      } else if (scmHost === "github") {
        if (ghConns.length === 0) {
          errors.integrations = "No GitHub OAuth connections for the project owner";
        } else if (!selectedGithubConnectionId) {
          errors.integrations = "Select a GitHub account";
        }
      } else if (bbConns.length === 0) {
        errors.integrations = "No Bitbucket OAuth connections for the project owner";
      } else if (!selectedBitbucketConnectionId) {
        errors.integrations = "Select a Bitbucket account";
      }
      if (!errors.integrations) {
        if (jiConns.length === 0) {
          errors.integrations = "No Jira OAuth connections for the project owner";
        } else if (!selectedJiraConnectionId) {
          errors.integrations = "Select a Jira site";
        }
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
      const dev = developerRepoUrlInput.trim();
      if (dev && !GH_REPO_PATH_RE.test(dev)) {
        errors.developerRepoUrl =
          "Enter a valid GitHub path (e.g. github.com/org/other-repo)";
      }
      return errors;
    },
    [
      integrationsPayload,
      scmHost,
      selectedGithubConnectionId,
      selectedBitbucketConnectionId,
      selectedJiraConnectionId,
      jiraProjectKey,
      repoMode,
      gitRepoPathManual,
      pickedRepoPath,
      developerRepoUrlInput,
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
    const base = {
      jiraConnectionId: Number(selectedJiraConnectionId),
      gitRepoPath: gitRepoPathOut,
      developerRepoUrl: developerRepoUrlInput.trim() || undefined,
      jiraProjectKey: jiraProjectKey.trim(),
      jiraBaseUrl: jiraBaseUrlResolved || jiConn?.baseUrl || undefined,
    };
    if (scmHost === "github") {
      return {
        ...base,
        githubConnectionId: Number(selectedGithubConnectionId),
        bitbucketConnectionId: null,
      };
    }
    return {
      ...base,
      bitbucketConnectionId: Number(selectedBitbucketConnectionId),
      githubConnectionId: null,
    };
  }, [
    integrationsPayload,
    scmHost,
    selectedGithubConnectionId,
    selectedBitbucketConnectionId,
    selectedJiraConnectionId,
    repoMode,
    gitRepoPathManual,
    pickedRepoPath,
    developerRepoUrlInput,
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
      getScmHost: () => scmHost,
      getSelectedGithubConnectionId: () => selectedGithubConnectionId,
      getSelectedBitbucketConnectionId: () => selectedBitbucketConnectionId,
      getSelectedJiraConnectionId: () => selectedJiraConnectionId,
      getJiraProjectKey: () => jiraProjectKey.trim(),
      getJiraBaseUrl: () => {
        const jiConns = integrationsPayload?.jira?.connections ?? [];
        const jiConn = jiConns.find((c) => String(c.id) === selectedJiraConnectionId);
        return jiraBaseUrlResolved || jiConn?.baseUrl || "";
      },
      getDeveloperRepoUrl: () => developerRepoUrlInput.trim(),
    }),
    [
      validateCreate,
      validateEdit,
      getCreatePayload,
      getEditResolvedGitRepoPath,
      scmHost,
      selectedGithubConnectionId,
      selectedBitbucketConnectionId,
      selectedJiraConnectionId,
      jiraProjectKey,
      jiraBaseUrlResolved,
      integrationsPayload,
      developerRepoUrlInput,
    ],
  );

  return (
    <Card className="border-slate-200 overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold text-slate-800">
          Code host &amp; Jira for this project
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
        <div className="space-y-2">
          <Label>Code host</Label>
          <Select
            value={scmHost}
            onValueChange={(v) => {
              setScmHost(v);
              setPickedRepoPath("");
              setGitRepoPathManual("");
              setRepoSearch("");
            }}
            disabled={integrationsLoading}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="github">GitHub</SelectItem>
              <SelectItem value="bitbucket">Bitbucket</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Each project uses one host for its repository (not both). Connect accounts under{" "}
            <Link
              to="/settings/integrations"
              className="text-primary underline-offset-4 hover:underline"
            >
              Integrations
            </Link>
            .
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3 rounded-lg border border-slate-200 p-4">
            <div className="font-medium text-slate-800">
              {scmHost === "github" ? "GitHub account" : "Bitbucket account"}
            </div>
            {integrationsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : scmHost === "github" ? (
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
            ) : (
              <>
                <Select
                  value={selectedBitbucketConnectionId || undefined}
                  onValueChange={setSelectedBitbucketConnectionId}
                  disabled={bitbucketConnections.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Bitbucket account" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {bitbucketConnections.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.login ? c.login : `Account #${c.id}`}
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
                    setOauthBusy("bb");
                    try {
                      const url = isEdit
                        ? await getBitbucketOAuthAuthorizeUrl(selectedBitbucketConnectionId)
                        : await getBitbucketOAuthAuthorizeUrl();
                      window.location.href = url;
                    } catch (e) {
                      toast.error(e.message || "Could not start Bitbucket OAuth");
                      setOauthBusy(null);
                    }
                  }}
                >
                  {oauthBusy === "bb" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {isEdit ? "Reconnect selected account" : "Add Bitbucket account"}
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
                disabled={
                  !(scmHost === "github"
                    ? selectedGithubConnectionId
                    : selectedBitbucketConnectionId) || reposLoading
                }
              />
              <Select
                value={pickedRepoPath || undefined}
                onValueChange={setPickedRepoPath}
                disabled={
                  !(scmHost === "github"
                    ? selectedGithubConnectionId
                    : selectedBitbucketConnectionId) || reposLoading
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={reposLoading ? "Loading…" : "Choose repository"}
                  />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {filteredRepos.map((r) => (
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
                  onClick={loadMoreRepos}
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
                placeholder={
                  scmHost === "github"
                    ? "github.com/org/repository"
                    : "bitbucket.org/workspace/repository"
                }
                value={gitRepoPath}
                onChange={(e) => setGitRepoPathManual(e.target.value)}
                className={
                  validationErrors.gitRepoPath ? "border-destructive" : ""
                }
              />
              <p className="text-xs text-muted-foreground">
                Must be a repo the selected {scmHost === "github" ? "GitHub" : "Bitbucket"}{" "}
                account can access.
              </p>
            </div>
          )}
          {repoMode === "auto" && (
            <p className="text-xs text-muted-foreground">
              A new repository will be created under your selected{" "}
              {scmHost === "github" ? "GitHub" : "Bitbucket"} account when you submit.
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
          <Label htmlFor="developerRepoUrl-shared">Developer repository (optional)</Label>
          <p className="text-xs text-muted-foreground">
            Customer repo that receives the platform repo as a git submodule at{" "}
            <code className="text-xs">launchpad-frontend/</code>. On lock:{" "}
            <code className="text-xs">git fetch</code> / <code className="text-xs">git checkout</code>{" "}
            to the active version commit in that folder, then commit and push the parent repo
            (default message: &quot;Update the Launchpad branch&quot;).
          </p>
          <Input
            id="developerRepoUrl-shared"
            placeholder={
              scmHost === "github"
                ? "github.com/org/customer-repo"
                : "bitbucket.org/workspace/customer-repo"
            }
            value={developerRepoUrlInput}
            onChange={(e) => setDeveloperRepoUrlInput(e.target.value)}
            className={validationErrors.developerRepoUrl ? "border-destructive" : ""}
          />
          {(scmHost === "github"
            ? selectedGithubConnectionId
            : selectedBitbucketConnectionId) &&
            filteredRepos.length > 0 && (
            <Select
              key={devRepoPickNonce}
              onValueChange={(v) => {
                setDeveloperRepoUrlInput(v);
                setDevRepoPickNonce((n) => n + 1);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Or choose from your repositories…" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {filteredRepos.map((r) => (
                  <SelectItem key={`devrepo-${r.gitRepoPath}`} value={r.gitRepoPath}>
                    {r.fullName}
                    {r.private ? " (private)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {validationErrors.developerRepoUrl && (
            <p className="text-sm text-destructive">{validationErrors.developerRepoUrl}</p>
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
