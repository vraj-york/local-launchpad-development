import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import { parseScmRepoPath } from "../utils/scmPath.js";
import { getBackendRoot } from "../utils/instanceRoot.js";

const GITHUB_API = "https://api.github.com";

const GIT_REVERT_IDENTITY = [
  "-c",
  "user.email=client-link-revert@noreply.local",
  "-c",
  "user.name=Client Link Revert",
];

function gitStderrFromError(err) {
  if (!err || typeof err !== "object") return String(err || "git failed");
  const b = err.stderr;
  if (Buffer.isBuffer(b)) return b.toString("utf8").trim();
  if (typeof b === "string") return b.trim();
  return String(err.message || "git failed");
}

function gitExecInDir(args, cwd) {
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 50 * 1024 * 1024,
    timeout: 600000,
  });
}

/**
 * Parse gitRepoPath for GitHub only (e.g. github.com/owner/repo). Bitbucket paths return null.
 * @param {string} gitRepoPath
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGitRepoPath(gitRepoPath) {
  const p = parseScmRepoPath(gitRepoPath);
  if (!p || p.provider !== "github") return null;
  return { owner: p.owner, repo: p.repo };
}

/**
 * GET /repos/:owner/:repo — verify token can read repo and get default_branch (for Cursor source.ref).
 * @returns {Promise<{ ok: true, defaultBranch: string, fullName?: string } | { ok: false, status: number, message: string }>}
 */
export async function getRepositoryMetadata(owner, repo, token) {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: typeof data?.message === "string" ? data.message : res.statusText,
    };
  }
  const defaultBranch =
    typeof data.default_branch === "string" && data.default_branch.trim()
      ? data.default_branch.trim()
      : "main";
  return {
    ok: true,
    defaultBranch,
    fullName: typeof data.full_name === "string" ? data.full_name : undefined,
  };
}

/**
 * Compare two refs (branch/tag/sha) and return changed files + commit summary.
 * GET /repos/:owner/:repo/compare/:base...:head
 * @returns {Promise<{ ok: true, status: number, data: object } | { ok: false, status: number, message: string }>}
 */
export async function compareRefs(owner, repo, baseRef, headRef, token) {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(headRef)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: typeof data?.message === "string" ? data.message : res.statusText,
    };
  }
  return { ok: true, status: res.status, data };
}

/**
 * Get SHA of a branch. GET /repos/:owner/:repo/git/ref/heads/:branch
 * @returns {Promise<{ sha: string } | null>}
 */
export async function getBranchSha(owner, repo, branch, token) {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const sha = data?.object?.sha;
  return sha ? { sha } : null;
}

/**
 * Get commit SHA + parent SHAs for a ref or SHA.
 * GET /repos/:owner/:repo/commits/:ref
 * @returns {Promise<{ ok: true, sha: string, parents: string[], message?: string | null } | { ok: false, status: number, message: string }>}
 */
export async function getCommitInfo(owner, repo, ref, token) {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: typeof data?.message === "string" ? data.message : res.statusText,
    };
  }
  const sha = typeof data?.sha === "string" ? data.sha : null;
  const parents = Array.isArray(data?.parents)
    ? data.parents
        .map((p) => (typeof p?.sha === "string" ? p.sha : null))
        .filter(Boolean)
    : [];
  if (!sha) {
    return { ok: false, status: 502, message: "GitHub commit response missing SHA." };
  }
  const commitMessage =
    typeof data?.commit?.message === "string" ? data.commit.message.trim() : null;
  return { ok: true, sha, parents, message: commitMessage };
}

/**
 * List recent commits on a ref (branch name or SHA). Newest first.
 * GET /repos/:owner/:repo/commits?sha=&per_page=
 */
export async function listCommitsOnRef(owner, repo, ref, token, perPage = 5) {
  const refEnc = typeof ref === "string" ? ref.trim() : "";
  if (!refEnc) return { ok: false, message: "ref required" };
  const n = Math.min(Math.max(Number(perPage) || 5, 1), 30);
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(refEnc)}&per_page=${n}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      data && typeof data.message === "string" ? data.message : res.statusText;
    return { ok: false, message: msg };
  }
  if (!Array.isArray(data)) {
    return { ok: false, message: "unexpected commits response" };
  }
  const commits = data.map((row) => {
    const shaFull = typeof row?.sha === "string" ? row.sha : "";
    const rawMsg =
      typeof row?.commit?.message === "string" ? row.commit.message.trim() : "";
    const messageFirstLine = rawMsg ? rawMsg.split("\n")[0].trim() || null : null;
    return {
      sha: shaFull,
      shaShort: shaFull ? shaFull.slice(0, 7) : "",
      messageFirstLine,
    };
  });
  return { ok: true, commits };
}

/**
 * Create a branch at the given SHA. POST /repos/:owner/:repo/git/refs
 * @returns {Promise<{ ok: boolean, status: number, message?: string }>}
 */
export async function createBranch(owner, repo, branchName, sha, token) {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
  });
  const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, message: data?.message };
}

/**
 * Ensure a branch exists; if not, create it from fromBranch.
 * @param {string} owner
 * @param {string} repo
 * @param {string} newBranch
 * @param {string} fromBranch
 * @param {string} token
 * @returns {Promise<{ ok: boolean, created?: boolean, error?: string }>}
 */
export async function ensureBranchFrom(owner, repo, newBranch, fromBranch, token) {
  const refUrl = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(newBranch)}`;
  const refRes = await fetch(refUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (refRes.ok) return { ok: true, created: false };
  if (refRes.status !== 404) {
    const err = await refRes.json().catch(() => ({}));
    return { ok: false, error: err?.message || `Failed to check branch: ${refRes.status}` };
  }
  const shaResult = await getBranchSha(owner, repo, fromBranch, token);
  if (!shaResult) {
    return { ok: false, error: `Default branch "${fromBranch}" not found; cannot create "${newBranch}" branch.` };
  }
  const createResult = await createBranch(owner, repo, newBranch, shaResult.sha, token);
  if (!createResult.ok) {
    return { ok: false, error: createResult.message || `Failed to create branch: ${createResult.status}` };
  }
  return { ok: true, created: true };
}

/**
 * Merge head into base. POST /repos/:owner/:repo/merges
 * @param {string} owner
 * @param {string} repo
 * @param {string} base - base branch name
 * @param {string} head - head branch name
 * @param {string} token
 * @returns {Promise<{ ok: boolean, status: number, data?: object, message?: string }>}
 */
export async function mergeBranch(owner, repo, base, head, token) {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/merges`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ base, head }),
  });
  const data = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? data : undefined,
    message: data?.message,
  };
}

/**
 * Force-update a ref (e.g. branch) to a new SHA. PATCH /repos/:owner/:repo/git/refs/:ref
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref - e.g. "heads/launchpad" (without refs/ prefix for the API path: refs/heads/launchpad)
 * @param {string} sha
 * @param {boolean} force
 * @param {string} token
 * @returns {Promise<{ ok: boolean, status: number, data?: object, message?: string }>}
 */
export async function updateRef(owner, repo, ref, sha, force, token) {
  const refPath = ref.startsWith("refs/") ? ref.replace(/^refs\//, "") : ref;
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/${refPath}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sha, force: !!force }),
  });
  const data = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? data : undefined,
    message: data?.message,
  };
}

/**
 * Create a lightweight tag at a commit SHA. POST /repos/:owner/:repo/git/refs
 * @param {string} owner
 * @param {string} repo
 * @param {string} tagName - e.g. "v1.0.0"
 * @param {string} sha
 * @param {string} token
 * @returns {Promise<{ ok: boolean, status: number, message?: string }>}
 */
export async function createTag(owner, repo, tagName, sha, token) {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: `refs/tags/${tagName}`, sha }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, message: data?.message };
}

/**
 * Resolve a tag ref to its target commit SHA (lightweight or annotated tag object).
 * @returns {Promise<string | null>}
 */
export async function getTagCommitSha(owner, repo, tagName, token) {
  const refUrl = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/tags/${encodeURIComponent(tagName)}`;
  const res = await fetch(refUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const obj = data?.object;
  if (!obj?.sha) return null;
  if (obj.type === "commit") return obj.sha;
  if (obj.type === "tag") {
    const tagUrl = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/tags/${encodeURIComponent(obj.sha)}`;
    const tagRes = await fetch(tagUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!tagRes.ok) return null;
    const tagData = await tagRes.json().catch(() => ({}));
    return tagData?.object?.sha || null;
  }
  return null;
}

/**
 * Create a lightweight tag, or if it already exists: succeed if it points at the same commit,
 * otherwise force-move the tag to sha (recover from partial runs / retries).
 */
/**
 * Encode path for GitHub "contents" API URLs (per-segment).
 * @param {string} filePath
 * @returns {string}
 */
export function encodeGitHubContentsPath(filePath) {
  return String(filePath || "")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/**
 * GET /repos/:owner/:repo/contents/:path — metadata for update (sha).
 * @returns {Promise<{ ok: true, sha: string } | { ok: false, status: number, notFound?: boolean, message?: string }>}
 */
export async function getRepositoryContentSha(owner, repo, filePath, ref, token) {
  const enc = encodeGitHubContentsPath(filePath);
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${enc}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) {
    return { ok: false, status: 404, notFound: true, message: "Not found" };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: typeof data?.message === "string" ? data.message : res.statusText,
    };
  }
  const sha = typeof data?.sha === "string" ? data.sha : null;
  if (!sha) {
    return { ok: false, status: 502, message: "GitHub contents response missing sha" };
  }
  return { ok: true, sha };
}

/**
 * Create or update a file on a branch. PUT /repos/:owner/:repo/contents/:path
 * @param {string} owner
 * @param {string} repo
 * @param {string} filePath
 * @param {{ message: string, contentBase64: string, branch: string, token: string, fileSha?: string|null }} opts
 * @returns {Promise<{ ok: true, path: string, commitSha?: string } | { ok: false, status: number, message?: string }>}
 */
export async function putRepositoryContents(owner, repo, filePath, opts) {
  const { message, contentBase64, branch, token, fileSha = null } = opts;
  const enc = encodeGitHubContentsPath(filePath);
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${enc}`;
  const body = {
    message,
    content: contentBase64,
    branch,
  };
  if (fileSha) body.sha = fileSha;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: typeof data?.message === "string" ? data.message : res.statusText,
    };
  }
  const commitSha =
    typeof data?.commit?.sha === "string" ? data.commit.sha : undefined;
  return { ok: true, path: filePath, commitSha };
}

export async function createTagIdempotent(owner, repo, tagName, sha, token) {
  const first = await createTag(owner, repo, tagName, sha, token);
  if (first.ok) return { ok: true };

  const msg = (first.message || "").toLowerCase();
  const duplicate =
    first.status === 422 ||
    msg.includes("already exists") ||
    msg.includes("reference already exists");

  if (!duplicate) return first;

  const existing = await getTagCommitSha(owner, repo, tagName, token);
  if (existing && existing.toLowerCase() === sha.toLowerCase()) {
    return { ok: true };
  }

  const moved = await updateRef(owner, repo, `tags/${tagName}`, sha, true, token);
  if (moved.ok) return { ok: true };
  return {
    ok: false,
    status: moved.status,
    message: moved.message || first.message || "Failed to create or move tag",
  };
}

/**
 * Clone `branchName`, run `git revert <commitSha>` on it, push to origin.
 * Requires the `git` CLI on the server. Used for client-link “revert merged chat” on the agent branch.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {string} branchName
 * @param {string} commitSha — full or short SHA of the commit to revert (the chat’s applied commit)
 * @returns {Promise<{ ok: true, newHeadSha: string } | { ok: false, message: string }>}
 */
export async function revertCommitOnRemoteBranch(owner, repo, token, branchName, commitSha) {
  const branch = String(branchName || "").trim();
  const sha = String(commitSha || "").trim();
  if (!branch || !sha) {
    return { ok: false, message: "Branch and commit SHA are required." };
  }

  const cmp = await compareRefs(owner, repo, sha, branch, token);
  if (!cmp.ok) {
    return {
      ok: false,
      message: cmp.message || "Could not verify commit is on the agent branch.",
    };
  }
  const st = String(cmp.data?.status || "").toLowerCase();
  if (st !== "ahead" && st !== "identical") {
    return {
      ok: false,
      message:
        "That commit is not an ancestor of the agent branch tip; cannot revert it on that branch.",
    };
  }

  const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  const tmp = path.join(
    getBackendRoot(),
    "_tmp_git_revert",
    `rv_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
  );

  try {
    await fs.ensureDir(tmp);
    gitExecInDir(["clone", "--branch", branch, "--single-branch", cloneUrl, "."], tmp);

    try {
      gitExecInDir([...GIT_REVERT_IDENTITY, "revert", sha, "--no-edit"], tmp);
    } catch (e1) {
      const t1 = gitStderrFromError(e1);
      if (/merge commit/i.test(t1) && !/-m\s+/.test(t1)) {
        try {
          gitExecInDir([...GIT_REVERT_IDENTITY, "revert", "-m", "1", sha, "--no-edit"], tmp);
        } catch (e2) {
          return {
            ok: false,
            message: gitStderrFromError(e2) || "git revert failed for merge commit (-m 1).",
          };
        }
      } else {
        return {
          ok: false,
          message: t1 || "git revert failed (resolve conflicts locally if needed).",
        };
      }
    }

    gitExecInDir(["push", "origin", `HEAD:refs/heads/${branch}`], tmp);

    const head = await getBranchSha(owner, repo, branch, token);
    if (!head?.sha) {
      return { ok: false, message: "Revert pushed but could not read branch HEAD from GitHub." };
    }
    return { ok: true, newHeadSha: head.sha };
  } catch (err) {
    return {
      ok: false,
      message: gitStderrFromError(err) || err?.message || "Git revert or push failed.",
    };
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
}
