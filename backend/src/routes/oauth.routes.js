import express from "express";
import { authenticateToken } from "../middleware/auth.middleware.js";
import {
  assertProjectAccess,
  getCreatorIntegrationConnectionsForEditor,
} from "../services/project.service.js";
import {
  signOAuthState,
  verifyOAuthState,
  sanitizeOAuthReturnPath,
  completeGithubOAuth,
  completeBitbucketOAuth,
  completeJiraOAuth,
  getIntegrationsStatus,
  deleteGithubConnection,
  deleteBitbucketConnection,
  deleteJiraConnection,
  assertGithubConnectionRowForListing,
  assertBitbucketConnectionRowForListing,
  assertJiraConnectionRowForListing,
  ensureFreshGithubConnection,
  ensureFreshBitbucketConnection,
  ensureFreshJiraConnection,
  listGithubReposPage,
  listBitbucketReposPage,
  listJiraProjectsForConnection,
} from "../services/oauthConnection.service.js";
import { getPublicFrontendBaseUrl } from "../utils/publicFrontendUrl.js";

const router = express.Router();

const FRONTEND = () => getPublicFrontendBaseUrl();

function redirectWithError(res, provider, message, returnPath = null) {
  const q = new URLSearchParams({ provider, error: message.slice(0, 200) });
  if (returnPath) q.set("return_to", returnPath);
  res.redirect(302, `${FRONTEND()}/integrations/callback?${q.toString()}`);
}

function redirectOk(res, provider, returnPath = null) {
  const q = new URLSearchParams({ provider, ok: "1" });
  if (returnPath) q.set("return_to", returnPath);
  res.redirect(302, `${FRONTEND()}/integrations/callback?${q.toString()}`);
}

function returnPathFromStateToken(state) {
  if (!state) return null;
  try {
    const decoded = verifyOAuthState(state);
    return decoded.returnPath || null;
  } catch {
    return null;
  }
}

function parseReturnToQuery(query) {
  const raw = query?.returnTo ?? query?.return_to;
  if (raw == null || raw === "") return null;
  return sanitizeOAuthReturnPath(raw);
}

function parseReconnectId(query) {
  const raw = query?.reconnectId ?? query?.reconnect_id;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** GET /api/integrations/status */
router.get("/status", authenticateToken, async (req, res, next) => {
  try {
    const status = await getIntegrationsStatus(req.user.id);
    res.json(status);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/integrations/creator-connections/:projectId
 * Same shape as /status but for the project creator (creator or admin only).
 */
router.get("/creator-connections/:projectId", authenticateToken, async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId < 1) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }
    const status = await getCreatorIntegrationConnectionsForEditor(projectId, req.user);
    res.json(status);
  } catch (e) {
    next(e);
  }
});

/** GET /api/integrations/github/start — JSON { url } (SPA + Bearer) or 302 redirect */
router.get("/github/start", authenticateToken, (req, res) => {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(503).json({ error: "GitHub OAuth is not configured on the server" });
    return;
  }
  const reconnectId = parseReconnectId(req.query);
  const returnPath = parseReturnToQuery(req.query);
  const state = signOAuthState(req.user.id, "github", reconnectId, returnPath);
  const scope = process.env.GITHUB_OAUTH_SCOPES || "repo read:user";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
  });
  if (process.env.GITHUB_OAUTH_ALLOW_REFRESH === "1") {
    params.set("allow_signup", "true");
  }
  const url = `https://github.com/login/oauth/authorize?${params.toString()}`;
  const wantsJson = (req.get("Accept") || "").includes("application/json");
  if (wantsJson) {
    res.json({ url });
    return;
  }
  res.redirect(302, url);
});

/** GET /api/integrations/github/callback */
router.get("/github/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const err = typeof req.query.error === "string" ? req.query.error : "";
  const rpErr = returnPathFromStateToken(state);
  if (err) {
    redirectWithError(res, "github", err, rpErr);
    return;
  }
  if (!code || !state) {
    redirectWithError(res, "github", "missing_code_or_state", rpErr);
    return;
  }
  try {
    const decoded = verifyOAuthState(state);
    if (decoded.provider !== "github") {
      redirectWithError(res, "github", "invalid_state", decoded.returnPath || null);
      return;
    }
    await completeGithubOAuth(code, state);
    redirectOk(res, "github", decoded.returnPath || null);
  } catch (e) {
    const rp = returnPathFromStateToken(state);
    redirectWithError(res, "github", e.message || "oauth_failed", rp);
  }
});

/** GET /api/integrations/github/repos?connectionId=&page=&projectId= */
router.get("/github/repos", authenticateToken, async (req, res, next) => {
  try {
    const projectIdRaw = req.query.projectId;
    const projectId =
      projectIdRaw != null && String(projectIdRaw).trim() !== ""
        ? Number(projectIdRaw)
        : null;
    if (projectId != null && (!Number.isInteger(projectId) || projectId < 1)) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
    if (projectId != null) {
      await assertProjectAccess(projectId, req.user);
    }
    const row = await assertGithubConnectionRowForListing(
      req.user,
      req.query.connectionId,
      projectId,
    );
    const fresh = await ensureFreshGithubConnection(row);
    const page = Math.max(1, Number(req.query.page) || 1);
    const result = await listGithubReposPage(fresh.accessToken, { page, perPage: 100 });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/** GET /api/integrations/bitbucket/start */
router.get("/bitbucket/start", authenticateToken, (req, res) => {
  const clientId = process.env.BITBUCKET_OAUTH_CLIENT_ID;
  const redirectUri = process.env.BITBUCKET_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(503).json({ error: "Bitbucket OAuth is not configured on the server" });
    return;
  }
  const reconnectId = parseReconnectId(req.query);
  const returnPath = parseReturnToQuery(req.query);
  const state = signOAuthState(req.user.id, "bitbucket", reconnectId, returnPath);
  const scope = process.env.BITBUCKET_OAUTH_SCOPES || "account repository webhook";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    scope,
  });
  const url = `https://bitbucket.org/site/oauth2/authorize?${params.toString()}`;
  if ((req.get("Accept") || "").includes("application/json")) {
    res.json({ url });
    return;
  }
  res.redirect(302, url);
});

router.get("/bitbucket/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const err = typeof req.query.error === "string" ? req.query.error : "";
  const rpErr = returnPathFromStateToken(state);
  if (err) {
    redirectWithError(res, "bitbucket", err, rpErr);
    return;
  }
  if (!code || !state) {
    redirectWithError(res, "bitbucket", "missing_code_or_state", rpErr);
    return;
  }
  try {
    const decoded = verifyOAuthState(state);
    if (decoded.provider !== "bitbucket") {
      redirectWithError(res, "bitbucket", "invalid_state", decoded.returnPath || null);
      return;
    }
    await completeBitbucketOAuth(code, state);
    redirectOk(res, "bitbucket", decoded.returnPath || null);
  } catch (e) {
    const rp = returnPathFromStateToken(state);
    redirectWithError(res, "bitbucket", e.message || "oauth_failed", rp);
  }
});

router.get("/bitbucket/repos", authenticateToken, async (req, res, next) => {
  try {
    const projectIdRaw = req.query.projectId;
    const projectId =
      projectIdRaw != null && String(projectIdRaw).trim() !== ""
        ? Number(projectIdRaw)
        : null;
    if (projectId != null && (!Number.isInteger(projectId) || projectId < 1)) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
    if (projectId != null) {
      await assertProjectAccess(projectId, req.user);
    }
    const row = await assertBitbucketConnectionRowForListing(
      req.user,
      req.query.connectionId,
      projectId,
    );
    const fresh = await ensureFreshBitbucketConnection(row);
    const page = Math.max(1, Number(req.query.page) || 1);
    const result = await listBitbucketReposPage(fresh.accessToken, { page, pagelen: 100 });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/** GET /api/integrations/jira/start — JSON { url } or 302 */
router.get("/jira/start", authenticateToken, (req, res) => {
  const clientId = process.env.ATLASSIAN_OAUTH_CLIENT_ID;
  const redirectUri = process.env.ATLASSIAN_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(503).json({ error: "Atlassian OAuth is not configured on the server" });
    return;
  }
  const reconnectId = parseReconnectId(req.query);
  const returnPath = parseReturnToQuery(req.query);
  const state = signOAuthState(req.user.id, "jira", reconnectId, returnPath);
  const scope =
    process.env.ATLASSIAN_OAUTH_SCOPES ||
    "read:jira-user read:jira-work write:jira-work offline_access";
  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: clientId,
    scope,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    prompt: "consent",
  });
  const url = `https://auth.atlassian.com/authorize?${params.toString()}`;
  if ((req.get("Accept") || "").includes("application/json")) {
    res.json({ url });
    return;
  }
  res.redirect(302, url);
});

/** GET /api/integrations/jira/callback */
router.get("/jira/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const err = typeof req.query.error === "string" ? req.query.error : "";
  const rpErr = returnPathFromStateToken(state);
  if (err) {
    redirectWithError(res, "jira", err, rpErr);
    return;
  }
  if (!code || !state) {
    redirectWithError(res, "jira", "missing_code_or_state", rpErr);
    return;
  }
  try {
    const decoded = verifyOAuthState(state);
    if (decoded.provider !== "jira") {
      redirectWithError(res, "jira", "invalid_state", decoded.returnPath || null);
      return;
    }
    await completeJiraOAuth(code, state);
    redirectOk(res, "jira", decoded.returnPath || null);
  } catch (e) {
    const rp = returnPathFromStateToken(state);
    redirectWithError(res, "jira", e.message || "oauth_failed", rp);
  }
});

/** GET /api/integrations/jira/projects?connectionId=&projectId= */
router.get("/jira/projects", authenticateToken, async (req, res, next) => {
  try {
    const projectIdRaw = req.query.projectId;
    const projectId =
      projectIdRaw != null && String(projectIdRaw).trim() !== ""
        ? Number(projectIdRaw)
        : null;
    if (projectId != null && (!Number.isInteger(projectId) || projectId < 1)) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
    if (projectId != null) {
      await assertProjectAccess(projectId, req.user);
    }
    const row = await assertJiraConnectionRowForListing(
      req.user,
      req.query.connectionId,
      projectId,
    );
    const fresh = await ensureFreshJiraConnection(row);
    const cloudId = row.atlassianCloudId;
    const projects = await listJiraProjectsForConnection(fresh.accessToken, cloudId);
    res.json({ projects, jiraBaseUrl: fresh.jiraBaseUrl || row.jiraBaseUrl || null });
  } catch (e) {
    next(e);
  }
});

router.delete("/github/:connectionId", authenticateToken, async (req, res, next) => {
  try {
    await deleteGithubConnection(req.user.id, req.params.connectionId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete("/bitbucket/:connectionId", authenticateToken, async (req, res, next) => {
  try {
    await deleteBitbucketConnection(req.user.id, req.params.connectionId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete("/jira/:connectionId", authenticateToken, async (req, res, next) => {
  try {
    await deleteJiraConnection(req.user.id, req.params.connectionId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
