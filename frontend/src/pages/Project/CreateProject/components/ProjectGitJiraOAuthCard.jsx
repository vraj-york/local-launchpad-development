import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
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
import githubMarkSvg from "@/assets/apps/GitHub.svg";
import bitbucketMarkSvg from "@/assets/apps/BitBucket.svg";
import jiraMarkSvg from "@/assets/apps/Jira.svg";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/** Renders brand SVGs from `src/assets` (Vite resolves imports to URLs). */
function IntegrationBrandImg({ src, className, invertOnDark }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        "pointer-events-none shrink-0 object-contain",
        invertOnDark && "dark:invert dark:opacity-90",
        className,
      )}
    />
  );
}

const GH_REPO_PATH_RE =
  /^(https?:\/\/)?github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?$/i;

const BB_REPO_PATH_RE =
  /^(https?:\/\/)?bitbucket\.org\/[^/\s]+\/[^/\s]+(?:\.git)?$/i;

function normalizeRepoPathForCompare(p) {
  return String(p || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

/** @returns {'github'|'bitbucket'|null} */
function repositoryPlatformFromUrl(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  const hasGh = s.includes("github.com");
  const hasBb = s.includes("bitbucket.org");
  if (hasGh && hasBb) return null;
  if (hasBb) return "bitbucket";
  if (hasGh) return "github";
  return null;
}

const REPO_PLATFORM_PAIR_MISMATCH_MSG =
  "Source repository and development repository must be on the same platform (GitHub or Bitbucket).";

const REPO_PLATFORM_IMMUTABLE_MSG =
  "Repository platform cannot be changed once set. Both source and development repositories must remain on the same platform.";

const PM_CREATE_GITJIRA_OAUTH_DRAFT = "pm_create_gitjira_oauth_draft";
const OAUTH_DRAFT_MAX_AGE_MS = 15 * 60 * 1000;

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
    oauthReturnTo,
    onBeforeOAuthRedirect,
    /** Create flow: one-time restore from localStorage draft */
    initialCreateDraft = null,
    /** Create flow: called when persisted fields change (for localStorage) */
    onCreateFieldsChange,
  },
  ref,
) {
  const isEdit = variant === "edit";
  const oauthDraftRestoredRef = useRef(false);
  const createDraftHydratedRef = useRef(false);

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
  const [developmentRepoUrlInput, setDevelopmentRepoUrlInput] = useState("");
  const [devRepoMode, setDevRepoMode] = useState(() =>
    isEdit ? "keep" : "pick",
  );
  const [devRepoPickNonce, setDevRepoPickNonce] = useState(0);
  const [jiraProjects, setJiraProjects] = useState([]);
  const [jiraProjectsLoading, setJiraProjectsLoading] = useState(false);
  const [jiraBaseUrlResolved, setJiraBaseUrlResolved] = useState("");

  const githubConnections = integrationsPayload?.github?.connections ?? [];
  const bitbucketConnections = integrationsPayload?.bitbucket?.connections ?? [];
  const jiraConnections = integrationsPayload?.jira?.connections ?? [];

  const activeRepos = scmHost === "github" ? githubRepos : bitbucketRepos;

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
      setJiraProjectKey(editProject.jiraProjectKey ?? "");
      {
        const devUrl = String(editProject.developmentRepoUrl ?? "").trim();
        setDevelopmentRepoUrlInput(String(editProject.developmentRepoUrl ?? ""));
        setDevRepoMode(devUrl ? "keep" : "pick");
      }
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
      if (
        initialCreateDraft &&
        typeof initialCreateDraft === "object" &&
        Object.keys(initialCreateDraft).length > 0
      ) {
        return;
      }
      createDraftHydratedRef.current = false;
      setScmHost("github");
      setRepoMode("auto");
      setPickedRepoPath("");
      setGitRepoPathManual("");
      setDevelopmentRepoUrlInput("");
      setDevRepoMode("pick");
      setDevRepoPickNonce(0);
      setJiraProjectKey("");
    }
  }, [syncKey, isEdit, editProject, initialCreateDraft]);

  useEffect(() => {
    if (isEdit || !integrationsPayload) return;
    const gh = integrationsPayload.github?.connections ?? [];
    const bb = integrationsPayload.bitbucket?.connections ?? [];
    if (!createDraftHydratedRef.current && !gh.length && bb.length) setScmHost("bitbucket");
  }, [integrationsPayload, isEdit]);

  useEffect(() => {
    if (!integrationsPayload) return;
    const gh = integrationsPayload.github?.connections ?? [];
    const bb = integrationsPayload.bitbucket?.connections ?? [];
    const ji = integrationsPayload.jira?.connections ?? [];

    const draftHasKeys =
      initialCreateDraft &&
      typeof initialCreateDraft === "object" &&
      Object.keys(initialCreateDraft).length > 0;
    if (!isEdit && draftHasKeys && !createDraftHydratedRef.current) {
      createDraftHydratedRef.current = true;
      const d = initialCreateDraft;
      if (d.scmHost === "github" || d.scmHost === "bitbucket") setScmHost(d.scmHost);
      if (d.repoMode === "auto" || d.repoMode === "pick" || d.repoMode === "manual")
        setRepoMode(d.repoMode);
      if (typeof d.pickedRepoPath === "string") setPickedRepoPath(d.pickedRepoPath);
      if (typeof d.gitRepoPathManual === "string") setGitRepoPathManual(d.gitRepoPathManual);
      if (typeof d.developmentRepoUrlInput === "string")
        setDevelopmentRepoUrlInput(d.developmentRepoUrlInput);
      if (d.devRepoMode === "pick" || d.devRepoMode === "manual") {
        setDevRepoMode(d.devRepoMode);
      } else if (
        typeof d.developmentRepoUrlInput === "string" &&
        d.developmentRepoUrlInput.trim()
      ) {
        setDevRepoMode("manual");
      }
      if (typeof d.jiraProjectKey === "string") setJiraProjectKey(d.jiraProjectKey);
      if (typeof d.jiraBaseUrlResolved === "string") setJiraBaseUrlResolved(d.jiraBaseUrlResolved);

      const wantGh = d.selectedGithubConnectionId != null ? String(d.selectedGithubConnectionId) : "";
      const wantBb = d.selectedBitbucketConnectionId != null ? String(d.selectedBitbucketConnectionId) : "";
      const wantJi = d.selectedJiraConnectionId != null ? String(d.selectedJiraConnectionId) : "";
      setSelectedGithubConnectionId(
        wantGh && gh.some((c) => String(c.id) === wantGh)
          ? wantGh
          : gh[0]
            ? String(gh[0].id)
            : "",
      );
      setSelectedBitbucketConnectionId(
        wantBb && bb.some((c) => String(c.id) === wantBb)
          ? wantBb
          : bb[0]
            ? String(bb[0].id)
            : "",
      );
      setSelectedJiraConnectionId(
        wantJi && ji.some((c) => String(c.id) === wantJi)
          ? wantJi
          : ji[0]
            ? String(ji[0].id)
            : "",
      );
      return;
    }

    if (!isEdit && createDraftHydratedRef.current) {
      return;
    }

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
  }, [integrationsPayload, isEdit, editProject, initialCreateDraft]);

  useEffect(() => {
    if (isEdit || oauthDraftRestoredRef.current || !integrationsPayload) return;
    try {
      const raw = sessionStorage.getItem(PM_CREATE_GITJIRA_OAUTH_DRAFT);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (
        typeof d?.savedAt !== "number" ||
        Date.now() - d.savedAt > OAUTH_DRAFT_MAX_AGE_MS
      ) {
        sessionStorage.removeItem(PM_CREATE_GITJIRA_OAUTH_DRAFT);
        return;
      }
      oauthDraftRestoredRef.current = true;
      sessionStorage.removeItem(PM_CREATE_GITJIRA_OAUTH_DRAFT);
      const gh = integrationsPayload.github?.connections ?? [];
      const bb = integrationsPayload.bitbucket?.connections ?? [];
      const ji = integrationsPayload.jira?.connections ?? [];
      if (d.scmHost === "github" || d.scmHost === "bitbucket") setScmHost(d.scmHost);
      if (d.repoMode === "auto" || d.repoMode === "pick" || d.repoMode === "manual") {
        setRepoMode(d.repoMode);
      }
      if (typeof d.pickedRepoPath === "string") setPickedRepoPath(d.pickedRepoPath);
      if (typeof d.gitRepoPathManual === "string") setGitRepoPathManual(d.gitRepoPathManual);
      if (typeof d.jiraProjectKey === "string") setJiraProjectKey(d.jiraProjectKey);
      if (typeof d.developmentRepoUrlInput === "string") {
        setDevelopmentRepoUrlInput(d.developmentRepoUrlInput);
      }
      if (d.devRepoMode === "pick" || d.devRepoMode === "manual") {
        setDevRepoMode(d.devRepoMode);
      } else if (
        typeof d.developmentRepoUrlInput === "string" &&
        d.developmentRepoUrlInput.trim()
      ) {
        setDevRepoMode("manual");
      }
      if (typeof d.jiraBaseUrlResolved === "string") setJiraBaseUrlResolved(d.jiraBaseUrlResolved);
      if (typeof d.selectedGithubConnectionId === "string" && d.selectedGithubConnectionId) {
        if (gh.some((c) => String(c.id) === d.selectedGithubConnectionId)) {
          setSelectedGithubConnectionId(d.selectedGithubConnectionId);
        }
      }
      if (typeof d.selectedBitbucketConnectionId === "string" && d.selectedBitbucketConnectionId) {
        if (bb.some((c) => String(c.id) === d.selectedBitbucketConnectionId)) {
          setSelectedBitbucketConnectionId(d.selectedBitbucketConnectionId);
        }
      }
      if (typeof d.selectedJiraConnectionId === "string" && d.selectedJiraConnectionId) {
        if (ji.some((c) => String(c.id) === d.selectedJiraConnectionId)) {
          setSelectedJiraConnectionId(d.selectedJiraConnectionId);
        }
      }
    } catch {
      try {
        sessionStorage.removeItem(PM_CREATE_GITJIRA_OAUTH_DRAFT);
      } catch {
        /* ignore */
      }
    }
  }, [integrationsPayload, isEdit]);

  const persistCreateGitJiraDraftForOAuth = useCallback(() => {
    if (isEdit) return;
    try {
      sessionStorage.setItem(
        PM_CREATE_GITJIRA_OAUTH_DRAFT,
        JSON.stringify({
          savedAt: Date.now(),
          scmHost,
          selectedGithubConnectionId,
          selectedBitbucketConnectionId,
          selectedJiraConnectionId,
          repoMode,
          pickedRepoPath,
          gitRepoPathManual,
          jiraProjectKey,
          developmentRepoUrlInput,
          devRepoMode,
          jiraBaseUrlResolved,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [
    isEdit,
    scmHost,
    selectedGithubConnectionId,
    selectedBitbucketConnectionId,
    selectedJiraConnectionId,
    repoMode,
    pickedRepoPath,
    gitRepoPathManual,
    jiraProjectKey,
    developmentRepoUrlInput,
    devRepoMode,
    jiraBaseUrlResolved,
  ]);

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
      const dev = developmentRepoUrlInput.trim();
      const devPathRe = scmHost === "github" ? GH_REPO_PATH_RE : BB_REPO_PATH_RE;
      const devExample =
        scmHost === "github"
          ? "github.com/org/other-repo"
          : "bitbucket.org/workspace/other-repo";
      if (!dev) {
        errors.developmentRepoUrl = "Developer repository path is required";
      } else if (!devPathRe.test(dev)) {
        errors.developmentRepoUrl = `Enter a valid path (e.g. ${devExample})`;
      }
      if (
        !errors.developmentRepoUrl &&
        (repoMode === "manual" || repoMode === "pick") &&
        (devRepoMode === "manual" || devRepoMode === "pick")
      ) {
        const mainRaw =
          repoMode === "manual" ? gitRepoPathManual.trim() : pickedRepoPath.trim();
        if (
          mainRaw &&
          normalizeRepoPathForCompare(mainRaw) === normalizeRepoPathForCompare(dev)
        ) {
          errors.developmentRepoUrl =
            "Must be a different repository than the platform repository";
        }
        if (!errors.developmentRepoUrl && mainRaw && dev) {
          const mp = repositoryPlatformFromUrl(mainRaw);
          const dp = repositoryPlatformFromUrl(dev);
          if (mp && dp && mp !== dp) {
            errors.developmentRepoUrl = REPO_PLATFORM_PAIR_MISMATCH_MSG;
          }
        }
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
      developmentRepoUrlInput,
      devRepoMode,
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
      const dev = developmentRepoUrlInput.trim();
      const devPathRe = scmHost === "github" ? GH_REPO_PATH_RE : BB_REPO_PATH_RE;
      const devExample =
        scmHost === "github"
          ? "github.com/org/other-repo"
          : "bitbucket.org/workspace/other-repo";
      if (dev && !devPathRe.test(dev)) {
        errors.developmentRepoUrl = `Enter a valid path (e.g. ${devExample})`;
      }
      const lockedPl = repositoryPlatformFromUrl(currentPath);
      const mainNext =
        repoMode === "keep"
          ? currentPath
          : repoMode === "pick"
            ? pickedRepoPath.trim()
            : gitRepoPathManual.trim();
      if (!errors.developmentRepoUrl && dev && lockedPl) {
        const dp = repositoryPlatformFromUrl(dev);
        if (dp && dp !== lockedPl) {
          errors.developmentRepoUrl = REPO_PLATFORM_IMMUTABLE_MSG;
        }
      }
      if (!errors.gitRepoPath && lockedPl && mainNext) {
        const mp = repositoryPlatformFromUrl(mainNext);
        if (mp && mp !== lockedPl) {
          errors.gitRepoPath = REPO_PLATFORM_IMMUTABLE_MSG;
        }
      }
      if (!errors.developmentRepoUrl && mainNext && dev) {
        const mp = repositoryPlatformFromUrl(mainNext);
        const dp = repositoryPlatformFromUrl(dev);
        if (mp && dp && mp !== dp) {
          errors.developmentRepoUrl = REPO_PLATFORM_PAIR_MISMATCH_MSG;
        }
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
      developmentRepoUrlInput,
      devRepoMode,
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
      developmentRepoUrl: developmentRepoUrlInput.trim(),
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
    developmentRepoUrlInput,
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

  const createDraftSnapshotForParent = useMemo(
    () => ({
      scmHost,
      selectedGithubConnectionId,
      selectedBitbucketConnectionId,
      selectedJiraConnectionId,
      repoMode,
      pickedRepoPath,
      gitRepoPathManual,
      developmentRepoUrlInput,
      devRepoMode,
      jiraProjectKey,
      jiraBaseUrlResolved,
    }),
    [
      scmHost,
      selectedGithubConnectionId,
      selectedBitbucketConnectionId,
      selectedJiraConnectionId,
      repoMode,
      pickedRepoPath,
      gitRepoPathManual,
      developmentRepoUrlInput,
      devRepoMode,
      jiraProjectKey,
      jiraBaseUrlResolved,
    ],
  );

  useEffect(() => {
    if (isEdit || typeof onCreateFieldsChange !== "function") return;
    onCreateFieldsChange(createDraftSnapshotForParent);
  }, [isEdit, onCreateFieldsChange, createDraftSnapshotForParent]);

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
      getDevelopmentRepoUrl: () => developmentRepoUrlInput.trim(),
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
      developmentRepoUrlInput,
      devRepoMode,
    ],
  );

  return (
    <>
      {validationErrors.integrations ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {validationErrors.integrations}
        </div>
      ) : null}

      <Card className="border-border shadow-sm overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold text-foreground flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5" aria-hidden>
              <IntegrationBrandImg src={githubMarkSvg} invertOnDark className="size-5" />
              <IntegrationBrandImg src={bitbucketMarkSvg} className="size-5" />
            </span>
            <span>Code host</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground font-normal pt-1">
            {isEdit ? (
              <>
                Pick GitHub or Bitbucket and the account for this repo. Manage connections on{" "}
                <Link
                  to="/settings/integrations"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Integrations
                </Link>
                ; reconnecting only refreshes an existing link.
              </>
            ) : (
              <>
                One code host per project. Add accounts under{" "}
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
        <div className="space-y-2">
          <Label>Code host</Label>
          <Select
            value={scmHost}
            onValueChange={(v) => {
              setScmHost(v);
              setPickedRepoPath("");
              setGitRepoPathManual("");
            }}
            disabled={integrationsLoading}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="github">
                <IntegrationBrandImg src={githubMarkSvg} invertOnDark className="size-4" />
                GitHub
              </SelectItem>
              <SelectItem value="bitbucket">
                <IntegrationBrandImg src={bitbucketMarkSvg} className="size-4" />
                Bitbucket
              </SelectItem>
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
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4 transition-colors">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="font-medium text-foreground flex min-w-0 items-center gap-2">
                {scmHost === "github" ? (
                  <>
                    <IntegrationBrandImg src={githubMarkSvg} invertOnDark className="size-5 shrink-0" />
                    <span>GitHub account</span>
                  </>
                ) : (
                  <>
                    <IntegrationBrandImg src={bitbucketMarkSvg} className="size-5 shrink-0" />
                    <span>Bitbucket account</span>
                  </>
                )}
              </div>
              {scmHost === "github" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full shrink-0 sm:w-auto"
                  disabled={integrationsLoading || oauthBusy}
                  onClick={async () => {
                    setOauthBusy("gh");
                    try {
                      oauthDraftRestoredRef.current = false;
                      onBeforeOAuthRedirect?.();
                      persistCreateGitJiraDraftForOAuth();
                      const opts = oauthReturnTo ? { returnTo: oauthReturnTo } : {};
                      const url = isEdit
                        ? await getGithubOAuthAuthorizeUrl(selectedGithubConnectionId, opts)
                        : await getGithubOAuthAuthorizeUrl(undefined, opts);
                      window.location.href = url;
                    } catch (e) {
                      toast.error(e.message || "Could not start GitHub OAuth");
                      setOauthBusy(null);
                    }
                  }}
                >
                  {oauthBusy === "gh" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <IntegrationBrandImg src={githubMarkSvg} invertOnDark className="mr-2 size-4" />
                  )}
                  {isEdit ? "Reconnect selected account" : "Add GitHub account"}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full shrink-0 sm:w-auto"
                  disabled={integrationsLoading || oauthBusy}
                  onClick={async () => {
                    setOauthBusy("bb");
                    try {
                      oauthDraftRestoredRef.current = false;
                      onBeforeOAuthRedirect?.();
                      persistCreateGitJiraDraftForOAuth();
                      const opts = oauthReturnTo ? { returnTo: oauthReturnTo } : {};
                      const url = isEdit
                        ? await getBitbucketOAuthAuthorizeUrl(
                            selectedBitbucketConnectionId,
                            opts,
                          )
                        : await getBitbucketOAuthAuthorizeUrl(undefined, opts);
                      window.location.href = url;
                    } catch (e) {
                      toast.error(e.message || "Could not start Bitbucket OAuth");
                      setOauthBusy(null);
                    }
                  }}
                >
                  {oauthBusy === "bb" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <IntegrationBrandImg src={bitbucketMarkSvg} className="mr-2 size-4" />
                  )}
                  {isEdit ? "Reconnect selected account" : "Add Bitbucket account"}
                </Button>
              )}
            </div>
            {integrationsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : scmHost === "github" ? (
              <Select
                value={selectedGithubConnectionId || undefined}
                onValueChange={setSelectedGithubConnectionId}
                disabled={githubConnections.length === 0}
              >
                <SelectTrigger className="w-full">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <IntegrationBrandImg src={githubMarkSvg} invertOnDark className="size-4" />
                    <SelectValue placeholder="Select GitHub account" />
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {githubConnections.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.login ? `@${c.login}` : `Account #${c.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select
                value={selectedBitbucketConnectionId || undefined}
                onValueChange={setSelectedBitbucketConnectionId}
                disabled={bitbucketConnections.length === 0}
              >
                <SelectTrigger className="w-full">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <IntegrationBrandImg src={bitbucketMarkSvg} className="size-4" />
                    <SelectValue placeholder="Select Bitbucket account" />
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {bitbucketConnections.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.login ? c.login : `Account #${c.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
        </div>

        <div className="space-y-2">
          <Label>Launchpad Repository</Label>
          <Select
            value={repoMode}
            onValueChange={(v) => {
              setRepoMode(v);
              if (v !== "pick") setPickedRepoPath("");
              if (v !== "manual") setGitRepoPathManual("");
            }}
          >
            <SelectTrigger className="w-full">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {scmHost === "github" ? (
                  <IntegrationBrandImg src={githubMarkSvg} invertOnDark className="size-4" />
                ) : (
                  <IntegrationBrandImg src={bitbucketMarkSvg} className="size-4" />
                )}
                <SelectValue />
              </span>
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
              <Select
                value={pickedRepoPath || undefined}
                onValueChange={setPickedRepoPath}
                disabled={
                  !(scmHost === "github"
                    ? selectedGithubConnectionId
                    : selectedBitbucketConnectionId) || reposLoading
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={reposLoading ? "Loading…" : "Choose repository"}
                  />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {activeRepos.map((r) => (
                    <SelectItem key={r.gitRepoPath} value={r.gitRepoPath}>
                      {scmHost === "github" ? (
                        <IntegrationBrandImg src={githubMarkSvg} invertOnDark className="size-3.5" />
                      ) : (
                        <IntegrationBrandImg src={bitbucketMarkSvg} className="size-3.5" />
                      )}
                      <span>
                        {r.fullName}
                        {r.private ? " (private)" : ""}
                      </span>
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
          <Label>Development repository{isEdit ? " (optional)" : " (required)"}</Label>
          <Select
            value={devRepoMode}
            onValueChange={(v) => {
              setDevRepoMode(v);
              if (v === "keep" && isEdit && editProject) {
                setDevelopmentRepoUrlInput(String(editProject.developmentRepoUrl ?? ""));
              } else if (v === "pick") {
                setDevelopmentRepoUrlInput("");
              }
              setDevRepoPickNonce((n) => n + 1);
            }}
          >
            <SelectTrigger className="w-full">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {scmHost === "github" ? (
                  <IntegrationBrandImg src={githubMarkSvg} invertOnDark className="size-4" />
                ) : (
                  <IntegrationBrandImg src={bitbucketMarkSvg} className="size-4" />
                )}
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              {isEdit ? (
                <SelectItem value="keep">Keep current development repository</SelectItem>
              ) : null}
              <SelectItem value="pick">Link an existing repository</SelectItem>
              <SelectItem value="manual">Enter repository path manually</SelectItem>
            </SelectContent>
          </Select>
          {devRepoMode === "pick" && (
            <div className="space-y-2 pt-1">
              <Select
                key={devRepoPickNonce}
                value={developmentRepoUrlInput || undefined}
                onValueChange={(v) => {
                  setDevelopmentRepoUrlInput(v);
                  setDevRepoPickNonce((n) => n + 1);
                }}
                disabled={
                  !(scmHost === "github"
                    ? selectedGithubConnectionId
                    : selectedBitbucketConnectionId) || reposLoading
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={reposLoading ? "Loading…" : "Choose repository"}
                  />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {activeRepos.map((r) => (
                    <SelectItem key={`devrepo-${r.gitRepoPath}`} value={r.gitRepoPath}>
                      {scmHost === "github" ? (
                        <IntegrationBrandImg src={githubMarkSvg} invertOnDark className="size-3.5" />
                      ) : (
                        <IntegrationBrandImg src={bitbucketMarkSvg} className="size-3.5" />
                      )}
                      <span>
                        {r.fullName}
                        {r.private ? " (private)" : ""}
                      </span>
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
          {devRepoMode === "manual" && (
            <div className="space-y-1 pt-1">
              <Input
                id="developmentRepoUrl-manual-shared"
                placeholder={
                  scmHost === "github"
                    ? "github.com/org/customer-repo"
                    : "bitbucket.org/workspace/customer-repo"
                }
                value={developmentRepoUrlInput}
                onChange={(e) => setDevelopmentRepoUrlInput(e.target.value)}
                className={
                  validationErrors.developmentRepoUrl ? "border-destructive" : ""
                }
              />
              <p className="text-xs text-muted-foreground">
                Must be a repo the selected {scmHost === "github" ? "GitHub" : "Bitbucket"}{" "}
                account can access, and different from the Launchpad repository.
              </p>
            </div>
          )}
          {devRepoMode === "keep" && isEdit && editProject?.developmentRepoUrl && (
            <p className="text-xs text-muted-foreground font-mono break-all">
              Current: {editProject.developmentRepoUrl}
            </p>
          )}
          {validationErrors.developmentRepoUrl && (
            <p className="text-sm text-destructive">{validationErrors.developmentRepoUrl}</p>
          )}
        </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold text-foreground flex flex-wrap items-center gap-2">
            <IntegrationBrandImg src={jiraMarkSvg} className="size-5" />
            <span>Jira</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground font-normal pt-1">
            {isEdit ? (
              <>
                Link the Jira site and project for tickets. Sites are managed on{" "}
                <Link
                  to="/settings/integrations"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Integrations
                </Link>
                .
              </>
            ) : (
              <>
                Choose a saved Jira site and project key. Add sites on{" "}
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
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4 transition-colors">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="font-medium text-foreground flex min-w-0 items-center gap-2">
                <IntegrationBrandImg src={jiraMarkSvg} className="size-5 shrink-0" />
                <span>Jira site</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full shrink-0 sm:w-auto"
                disabled={integrationsLoading || oauthBusy}
                onClick={async () => {
                  setOauthBusy("ji");
                  try {
                    oauthDraftRestoredRef.current = false;
                    onBeforeOAuthRedirect?.();
                    persistCreateGitJiraDraftForOAuth();
                    const opts = oauthReturnTo ? { returnTo: oauthReturnTo } : {};
                    const url = isEdit
                      ? await getJiraOAuthAuthorizeUrl(selectedJiraConnectionId, opts)
                      : await getJiraOAuthAuthorizeUrl(undefined, opts);
                    window.location.href = url;
                  } catch (e) {
                    toast.error(e.message || "Could not start Jira OAuth");
                    setOauthBusy(null);
                  }
                }}
              >
                {oauthBusy === "ji" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <IntegrationBrandImg src={jiraMarkSvg} className="mr-2 size-4" />
                )}
                {isEdit ? "Reconnect selected site" : "Add Jira site"}
              </Button>
            </div>
            {integrationsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <Select
                value={selectedJiraConnectionId || undefined}
                onValueChange={setSelectedJiraConnectionId}
                disabled={jiraConnections.length === 0}
              >
                <SelectTrigger className="w-full">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <IntegrationBrandImg src={jiraMarkSvg} className="size-4" />
                    <SelectValue placeholder="Select Jira site" />
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {jiraConnections.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.baseUrl || `Site #${c.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <SelectTrigger id="jiraProjectPick-shared" className="w-full">
                <SelectValue placeholder="Select project (or type key below)" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {jiraProjects.map((p) => (
                  <SelectItem key={p.id} value={p.key}>
                    <IntegrationBrandImg src={jiraMarkSvg} className="size-3.5" />
                    <span>
                      {p.key} — {p.name}
                    </span>
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
    </>
  );
});

export default ProjectGitJiraOAuthCard;
