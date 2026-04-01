import { PrismaClient } from "@prisma/client";
import ApiError from "../utils/apiError.js";
import {
  ensureFreshGithubConnection,
  ensureFreshJiraConnection,
} from "./oauthConnection.service.js";

const prisma = new PrismaClient();

/**
 * @param {object} project - Must include createdById, githubConnectionId?, githubToken?, githubUsername?
 * @returns {Promise<{ githubToken: string, githubUsername: string, source: 'oauth'|'legacy' }>}
 */
export async function resolveGithubCredentialsFromProject(project) {
  if (project.githubConnectionId) {
    const row = await prisma.userOAuthConnection.findUnique({
      where: { id: project.githubConnectionId },
    });
    if (!row || row.provider !== "github") {
      throw new ApiError(400, "Project GitHub connection is invalid");
    }
    if (row.userId !== project.createdById) {
      throw new ApiError(403, "GitHub connection does not match project owner");
    }
    const { accessToken, githubLogin } = await ensureFreshGithubConnection(row);
    const username = (githubLogin || project.githubUsername || "").trim();
    if (!username) {
      throw new ApiError(400, "GitHub login missing for OAuth connection");
    }
    return {
      githubToken: accessToken,
      githubUsername: username,
      source: "oauth",
    };
  }
  const token = project.githubToken?.trim() || "";
  const username = project.githubUsername?.trim() || "";
  if (!username || !token) {
    throw new ApiError(
      400,
      "GitHub credentials not configured. Connect GitHub under Integrations or set githubUsername and githubToken on the project.",
    );
  }
  return {
    githubToken: token,
    githubUsername: username,
    source: "legacy",
  };
}

/**
 * @param {object} project
 * @returns {Promise<
 *   | { auth: 'bearer'; accessToken: string; baseUrl: string; atlassianCloudId?: string|null; email?: string|null; projectKey?: string; issueType?: string|null }
 *   | { auth: 'basic'; apiToken: string; email: string; baseUrl: string; projectKey?: string; issueType?: string|null }
 * >}
 */
export async function resolveJiraCredentialsFromProject(project) {
  if (project.jiraConnectionId) {
    const row = await prisma.userOAuthConnection.findUnique({
      where: { id: project.jiraConnectionId },
    });
    if (!row || row.provider !== "jira_atlassian") {
      throw new ApiError(400, "Project Jira connection is invalid");
    }
    if (row.userId !== project.createdById) {
      throw new ApiError(403, "Jira connection does not match project owner");
    }
    const fresh = await ensureFreshJiraConnection(row);
    const baseUrl = (fresh.jiraBaseUrl || project.jiraBaseUrl || "").replace(/\/$/, "");
    if (!baseUrl) {
      throw new ApiError(400, "Jira site URL missing for OAuth connection");
    }
    return {
      auth: "bearer",
      accessToken: fresh.accessToken,
      baseUrl,
      atlassianCloudId: fresh.atlassianCloudId || null,
      email: fresh.atlassianAccountEmail || project.jiraUsername || null,
      projectKey: project.jiraProjectKey,
      issueType: project.jiraIssueType,
    };
  }
  const baseUrl = (project.jiraBaseUrl || "").replace(/\/$/, "");
  return {
    auth: "basic",
    baseUrl,
    apiToken: project.jiraApiToken?.trim() || "",
    email: project.jiraUsername?.trim() || "",
    projectKey: project.jiraProjectKey,
    issueType: project.jiraIssueType,
  };
}

/**
 * Flat config for createJiraTicketWithConfig / addAttachmentToJiraIssue / fetchProjectJiraTickets
 * @param {Awaited<ReturnType<typeof resolveJiraCredentialsFromProject>>} resolved
 * @param {{ jiraProjectKey?: string, jiraIssueType?: string|null }} project
 */
export function jiraIntegrationConfigFromResolved(resolved, project) {
  const projectKey = project.jiraProjectKey || resolved.projectKey;
  const issueType = project.jiraIssueType || resolved.issueType || "Task";
  if (resolved.auth === "bearer") {
    return {
      baseUrl: resolved.baseUrl,
      projectKey,
      issueType,
      auth: "bearer",
      accessToken: resolved.accessToken,
      atlassianCloudId: resolved.atlassianCloudId || undefined,
      email: resolved.email || undefined,
    };
  }
  return {
    baseUrl: resolved.baseUrl,
    projectKey,
    issueType,
    auth: "basic",
    apiToken: resolved.apiToken,
    email: resolved.email,
  };
}

export async function assertGithubConnectionOwned(userId, connectionId) {
  const row = await prisma.userOAuthConnection.findFirst({
    where: { id: Number(connectionId), userId, provider: "github" },
  });
  if (!row) {
    throw new ApiError(400, "Invalid GitHub connection for this user");
  }
  return row;
}

export async function assertJiraConnectionOwned(userId, connectionId) {
  const row = await prisma.userOAuthConnection.findFirst({
    where: { id: Number(connectionId), userId, provider: "jira_atlassian" },
  });
  if (!row) {
    throw new ApiError(400, "Invalid Jira connection for this user");
  }
  return row;
}
