import { prisma } from "../lib/prisma.js";
import { resolveCursorRepositoryUrl } from "./cursor.service.js";
import { parseScmRepoPath } from "../utils/scmPath.js";
import { resolveScmCredentialsFromProject } from "./integrationCredential.service.js";
import {
  scmGetBranchSha,
  scmGetRepositoryMetadata,
} from "./scmFacade.service.js";

/**
 * True when a `FigmaConversion` exists for this project+release with a linked `ProjectVersion`
 * whose `projectId` and `releaseId` match (version identity via `projectVersionId`).
 */
async function hasVersionedFigmaConversionForRelease(projectId, releaseId) {
  const rid = Number(releaseId);
  if (!Number.isInteger(rid) || rid < 1) return false;
  const row = await prisma.figmaConversion.findFirst({
    where: {
      projectId,
      releaseId: rid,
      projectVersionId: { not: null },
      projectVersion: {
        projectId,
        releaseId: rid,
      },
    },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Base Git ref for client-link Cursor agents (persist git path; launchpad vs default branch).
 * @throws {Error} with .code REPO_UNRESOLVED | SCM_NOT_CONFIGURED
 */
async function resolveClientChatGitSource(project, forceLaunchpadBase = false) {
  const resolved = resolveCursorRepositoryUrl(project);
  if (!resolved.repositoryUrl) {
    const err = new Error(
      "Could not resolve repository for this project. Set gitRepoPath or connect GitHub/Bitbucket.",
    );
    err.code = "REPO_UNRESOLVED";
    throw err;
  }
  if (resolved.gitRepoPathToPersist) {
    await prisma.project.update({
      where: { id: project.id },
      data: { gitRepoPath: resolved.gitRepoPathToPersist },
    });
    project.gitRepoPath = resolved.gitRepoPathToPersist;
  }
  let parsed = parseScmRepoPath(project.gitRepoPath || "");
  if (!parsed && resolved.repositoryUrl) {
    parsed = parseScmRepoPath(resolved.repositoryUrl);
  }
  if (!parsed) {
    const err = new Error(
      "Could not resolve repository owner/slug for this project.",
    );
    err.code = "REPO_UNRESOLVED";
    throw err;
  }
  let scm;
  try {
    scm = await resolveScmCredentialsFromProject(project);
  } catch (e) {
    const err = new Error(
      typeof e?.message === "string"
        ? e.message
        : "Repository credentials are not configured for this project.",
    );
    err.code = "SCM_NOT_CONFIGURED";
    throw err;
  }
  const token = scm.token?.trim() || "";
  if (!token) {
    const err = new Error("Repository token is not configured for this project.");
    err.code = "SCM_NOT_CONFIGURED";
    throw err;
  }
  if (scm.provider !== parsed.provider) {
    const err = new Error(
      `gitRepoPath points to ${parsed.provider} but project credentials are for ${scm.provider}.`,
    );
    err.code = "REPO_UNRESOLVED";
    throw err;
  }

  let sourceRef = "launchpad";
  const lp = await scmGetBranchSha(parsed.provider, parsed.owner, parsed.repo, "launchpad", token);
  const launchpadMissing = !lp?.sha;
  if (launchpadMissing && !forceLaunchpadBase) {
    const meta = await scmGetRepositoryMetadata(
      parsed.provider,
      parsed.owner,
      parsed.repo,
      token,
    );
    if (meta.ok) {
      sourceRef = meta.defaultBranch || "main";
    }
  }
  return {
    repositoryUrl: resolved.repositoryUrl,
    sourceRef,
    parsed,
    token,
  };
}

/**
 * Git line for client-link agents and revert-to-baseline: `launchpad` when a versioned
 * `FigmaConversion` exists for this project+release; otherwise the repository default branch.
 * @throws {Error} with .code REPO_UNRESOLVED | SCM_NOT_CONFIGURED (same as chat client-link)
 */
export async function resolveGitSourceForNewClientChatAgent(
  project,
  forceLaunchpadBase,
  releaseId,
) {
  const useLaunchpad = await hasVersionedFigmaConversionForRelease(project.id, releaseId);
  const resolved = await resolveClientChatGitSource(project, forceLaunchpadBase);
  if (useLaunchpad) {
    return resolved;
  }
  const meta = await scmGetRepositoryMetadata(
    resolved.parsed.provider,
    resolved.parsed.owner,
    resolved.parsed.repo,
    resolved.token,
  );
  const def = meta.ok ? String(meta.defaultBranch || "").trim() : "";
  return {
    ...resolved,
    sourceRef: def || "main",
  };
}
