/**
 * Launchpad Developer Integration — API path constants (relative to VITE_API_URL).
 *
 * Follows the same grouped-endpoint convention as the platform UI reference in the
 * `launchpad-frontend` submodule (`launchpad-frontend/src/const/common/api.const.ts`).
 * Keep paths aligned with `backend/src/routes/*.routes.js` and `backend/src/app.js`.
 */

export const API_ENDPOINTS = {
  auth: {
    me: "/api/auth/me",
    /** Reserved for Launchpad-native refresh; Hub refresh uses HUB_API_URL. */
    refresh: "/api/auth/refresh",
  },
  figma: {
    complete: "/api/figma/complete",
  },
  integrations: {
    status: "/api/integrations/status",
    cursorStatus: "/api/integrations/cursor/status",
    cursorSyncGithubPat: "/api/integrations/cursor/sync-github-pat",
    cursorPat: "/api/integrations/cursor/pat",
    githubStart: "/api/integrations/github/start",
    jiraStart: "/api/integrations/jira/start",
    bitbucketStart: "/api/integrations/bitbucket/start",
    figmaStart: "/api/integrations/figma/start",
    githubRepos: "/api/integrations/github/repos",
    bitbucketRepos: "/api/integrations/bitbucket/repos",
    jiraProjects: "/api/integrations/jira/projects",
    creatorConnections: (projectId) =>
      `/api/integrations/creator-connections/${projectId}`,
    githubConnection: (connectionId) =>
      `/api/integrations/github/${connectionId}`,
    bitbucketConnection: (connectionId) =>
      `/api/integrations/bitbucket/${connectionId}`,
    jiraConnection: (connectionId) =>
      `/api/integrations/jira/${connectionId}`,
    figmaConnection: (connectionId) =>
      `/api/integrations/figma/${connectionId}`,
  },
  projects: {
    root: "/api/projects",
    byId: (projectId) => `/api/projects/${projectId}`,
    publicBySlug: (encSlug) => `/api/projects/public/${encSlug}`,
    switch: (projectId) => `/api/projects/${projectId}/switch`,
    scratchAgent: (projectId) => `/api/projects/${projectId}/scratch-agent`,
    generateJiraTickets: (projectId) =>
      `/api/projects/${projectId}/generate-jira-tickets`,
    cursorRulesCatalog: (projectId) =>
      `/api/projects/${projectId}/cursor-rules/catalog`,
    cursorRulesCustom: (projectId) =>
      `/api/projects/${projectId}/cursor-rules/custom`,
    cursorRulesImport: (projectId) =>
      `/api/projects/${projectId}/cursor-rules/import`,
    versionActivate: (projectId, versionId) =>
      `/api/projects/${projectId}/versions/${versionId}/activate`,
    revertToBaseline: (projectId, activeReleaseId) =>
      `/api/projects/${projectId}/releases/${activeReleaseId}/revert-to-baseline`,
    migrateFrontend: (projectId, releaseId) =>
      `/api/projects/${projectId}/releases/${releaseId}/migrate-frontend`,
  },
  releases: {
    root: "/api/releases",
    byProject: (projectId) => `/api/releases/project/${projectId}`,
    upload: (releaseId) => `/api/releases/${releaseId}/upload`,
    lock: (releaseId) => `/api/releases/${releaseId}/lock`,
    publicLock: (releaseId) => `/api/releases/${releaseId}/public-lock`,
    status: (releaseId) => `/api/releases/${releaseId}/status`,
    byId: (releaseId) => `/api/releases/${releaseId}`,
    changelog: (releaseId) => `/api/releases/${releaseId}/changelog`,
    regenerateReviewSummary: (releaseId) =>
      `/api/releases/${releaseId}/regenerate-review-summary`,
  },
  chat: {
    followup: (slugEnc) => `/api/chat/${slugEnc}/followup`,
    aiPreviewSvg: (slugEnc) => `/api/chat/${slugEnc}/ai-preview-svg`,
    agentStatus: (slugEnc) => `/api/chat/${slugEnc}/agent-status`,
    summary: (slugEnc) => `/api/chat/${slugEnc}/summary`,
    messages: (slugEnc) => `/api/chat/${slugEnc}/messages`,
    revertMerge: (slugEnc) => `/api/chat/${slugEnc}/revert-merge`,
    refreshBuild: (slugEnc) => `/api/chat/${slugEnc}/refresh-build`,
  },
  cursor: {
    agentById: (agentIdEnc) => `/api/cursor/agents/${agentIdEnc}`,
  },
};

/** Public client-link chat routes — no JWT; see axios request interceptor. */
export const CHAT_API_PREFIX = "/api/chat/";

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
};
