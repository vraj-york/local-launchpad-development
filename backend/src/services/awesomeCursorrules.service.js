import fetch from "node-fetch";
import fs from "fs-extra";
import path from "path";
import { execa } from "execa";
import ApiError from "../utils/apiError.js";
import { getBackendRoot } from "../utils/instanceRoot.js";
import { parseGitRepoPath } from "./github.service.js";
import { parseScmRepoPath } from "../utils/scmPath.js";
import { resolveGithubCredentialsFromProject } from "./integrationCredential.service.js";
import {
  authenticatedCloneUrl,
  configureGithubHttpExtraHeader,
  configureGithubHttpsAuthInsteadOf,
  git,
  gitHeadlessEnv,
  normalizeGithubRepoPath,
  publicHttpsRepoUrl,
} from "../utils/developerRepoGit.util.js";

const OWNER = "PatrickJS";
const REPO = "awesome-cursorrules";
const RULES_PREFIX = "rules";

const FOLDER_NAME_RE = /^[a-zA-Z0-9._-]+$/;

function githubHeaders() {
  const h = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Launchpad-Backend-CursorRules",
  };
  if (process.env.GITHUB_TOKEN) {
    h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return h;
}

function encodeRepoContentPath(urlPath) {
  return String(urlPath)
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

async function githubFetchJson(urlPath) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeRepoContentPath(urlPath)}`;
  const res = await fetch(url, { headers: githubHeaders() });
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (res.status === 403 && remaining === "0") {
    throw new ApiError(
      503,
      "GitHub API rate limit exceeded. Set GITHUB_TOKEN in the backend environment for higher limits.",
    );
  }
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(
      res.status === 404 ? 404 : res.status >= 500 ? 502 : 400,
      `GitHub API error (${res.status}): ${text.slice(0, 400)}`,
    );
  }
  return res.json();
}

/**
 * List immediate subfolders of `rules/` (PatrickJS/awesome-cursorrules).
 */
export async function listAwesomeCursorrulesFolders() {
  const data = await githubFetchJson(RULES_PREFIX);
  if (!Array.isArray(data)) {
    throw new ApiError(502, "Unexpected GitHub API response for rules catalog");
  }
  const folders = data
    .filter((item) => item.type === "dir" && typeof item.name === "string")
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));
  return folders;
}

function assertSafeFolderName(name) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    !FOLDER_NAME_RE.test(name) ||
    name.includes("..")
  ) {
    throw new ApiError(400, `Invalid or unsafe folder name: ${String(name)}`);
  }
}

async function listFilesRecursive(repoPathPrefix) {
  const data = await githubFetchJson(repoPathPrefix);
  if (!Array.isArray(data)) {
    return [];
  }
  const out = [];
  for (const item of data) {
    if (item.type === "file") {
      out.push(item);
    } else if (item.type === "dir" && item.path) {
      const nested = await listFilesRecursive(item.path);
      out.push(...nested);
    }
  }
  return out;
}

async function getFileBuffer(fileMeta) {
  if (fileMeta.download_url) {
    const res = await fetch(fileMeta.download_url, {
      headers: { "User-Agent": "Launchpad-Backend-CursorRules" },
    });
    if (!res.ok) {
      throw new ApiError(502, `Failed to download ${fileMeta.path}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  const one = await githubFetchJson(fileMeta.path);
  if (one.content && one.encoding === "base64") {
    return Buffer.from(String(one.content).replace(/\n/g, ""), "base64");
  }
  throw new ApiError(502, `Could not read content for ${fileMeta.path}`);
}

const MAX_FOLDERS_PER_IMPORT = 25;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/** Relative path inside the developer repo (POSIX-style for `git` CLI). */
const RULES_REL_IN_REPO = ".cursor/rules/awesome-cursorrules";

function rulesPackDir(workDir, folderName) {
  return path.join(workDir, ".cursor", "rules", "awesome-cursorrules", folderName);
}

function cursorRulesImportCommitMessage() {
  const custom = (process.env.CURSOR_RULES_IMPORT_COMMIT_MESSAGE || "").trim();
  if (custom) return custom;
  return "Add Cursor rules from awesome-cursorrules";
}

/**
 * Clone the GitHub developer repository, write rule packs under
 * `.cursor/rules/awesome-cursorrules/<folder>/...`, commit, and push.
 */
export async function importAwesomeCursorrulesFolders(project, folderNames) {
  if (!Array.isArray(folderNames) || folderNames.length === 0) {
    throw new ApiError(400, "folders must be a non-empty array of folder names");
  }
  if (folderNames.length > MAX_FOLDERS_PER_IMPORT) {
    throw new ApiError(400, `At most ${MAX_FOLDERS_PER_IMPORT} folders per import`);
  }

  const trimmedDev = String(project.developmentRepoUrl || "").trim();
  if (!trimmedDev) {
    throw new ApiError(
      400,
      "Add a developer repository (development repository URL) on the project before importing Cursor rules.",
    );
  }

  const devNorm = normalizeGithubRepoPath(project.developmentRepoUrl || "");
  if (!devNorm) {
    const scm = parseScmRepoPath(trimmedDev);
    if (scm?.provider === "bitbucket") {
      throw new ApiError(
        400,
        "Cursor rules import supports GitHub developer repositories only. Set developmentRepoUrl to github.com/owner/repo.",
      );
    }
    throw new ApiError(
      400,
      "developmentRepoUrl must be a valid GitHub repository path (e.g. github.com/owner/repo).",
    );
  }

  const { githubToken, githubUsername } = await resolveGithubCredentialsFromProject(project);
  const token = githubToken?.trim();
  if (!token) {
    throw new ApiError(400, "GitHub credentials are required to push Cursor rules to the developer repository.");
  }

  const devParsed = parseGitRepoPath(devNorm);
  if (!devParsed) {
    throw new ApiError(400, "Invalid GitHub repository path.");
  }

  const devAuthUrl = authenticatedCloneUrl(devParsed, token, githubUsername);
  const devPublicUrl = publicHttpsRepoUrl(devParsed);
  const developmentRepoDisplayUrl = `https://github.com/${devParsed.owner}/${devParsed.repo}`;
  if (!devAuthUrl) {
    throw new ApiError(400, "Could not build authenticated git URL.");
  }

  const catalog = new Set(await listAwesomeCursorrulesFolders());

  const tmpBase = path.join(
    getBackendRoot(),
    "_tmp_cursor_rules",
    `proj_${project.id}_${Date.now()}`,
  );
  const workDir = path.join(tmpBase, "repo");
  const authorName =
    (process.env.DEVELOPER_SUBMODULE_COMMITTER_NAME || "Launchpad").trim() || "Launchpad";
  const authorEmail =
    (process.env.DEVELOPER_SUBMODULE_COMMITTER_EMAIL || "noreply@launchpad.local").trim() ||
    "noreply@launchpad.local";
  const gitIdent = ["-c", `user.name=${authorName}`, "-c", `user.email=${authorEmail}`];

  const written = [];
  let totalBytes = 0;

  try {
    await fs.ensureDir(tmpBase);
    await git(tmpBase, ["clone", devAuthUrl, workDir]);
    await configureGithubHttpsAuthInsteadOf(workDir, token, githubUsername);
    await configureGithubHttpExtraHeader(workDir, token, githubUsername);

    for (const rawName of folderNames) {
      const name = String(rawName).trim();
      assertSafeFolderName(name);
      if (!catalog.has(name)) {
        throw new ApiError(400, `Unknown rules folder: ${name}`);
      }

      const prefix = `${RULES_PREFIX}/${name}`;
      const files = await listFilesRecursive(prefix);
      const baseDir = rulesPackDir(workDir, name);

      for (const fileMeta of files) {
        const rel = fileMeta.path.startsWith(prefix + "/")
          ? fileMeta.path.slice(prefix.length + 1)
          : path.basename(fileMeta.path);
        if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
          throw new ApiError(400, `Unsafe file path in repo: ${fileMeta.path}`);
        }
        const buf = await getFileBuffer(fileMeta);
        totalBytes += buf.length;
        if (totalBytes > MAX_TOTAL_BYTES) {
          throw new ApiError(413, "Total import size exceeds limit");
        }
        const outPath = path.join(baseDir, rel);
        await fs.ensureDir(path.dirname(outPath));
        await fs.writeFile(outPath, buf);
        written.push({ folder: name, path: rel });
      }
    }

    await git(workDir, ["add", "-f", RULES_REL_IN_REPO]);

    const diffCached = await execa("git", ["diff", "--cached", "--quiet"], {
      cwd: workDir,
      reject: false,
      env: gitHeadlessEnv(),
    });

    const commitMsg = cursorRulesImportCommitMessage();

    if (diffCached.exitCode === 0) {
      return {
        developmentRepoUrl: developmentRepoDisplayUrl,
        importedFolders: [...new Set(folderNames.map((s) => String(s).trim()))],
        filesWritten: written.length,
        files: written,
        skipped: true,
        pushed: false,
        commitSha: null,
      };
    }

    await git(workDir, [...gitIdent, "commit", "-m", commitMsg]);

    const rev = await git(workDir, ["rev-parse", "HEAD"]);
    const commitSha = String(rev.stdout || "").trim();

    await git(workDir, ["remote", "set-url", "origin", devPublicUrl]);
    await git(workDir, ["push", "origin", "HEAD"]);

    return {
      developmentRepoUrl: developmentRepoDisplayUrl,
      importedFolders: [...new Set(folderNames.map((s) => String(s).trim()))],
      filesWritten: written.length,
      files: written,
      skipped: false,
      pushed: true,
      commitSha: commitSha || null,
    };
  } finally {
    await fs.remove(tmpBase).catch(() => {});
  }
}
