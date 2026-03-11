import fetch from "node-fetch";

const GITHUB_API = "https://api.github.com";

/**
 * Parse gitRepoPath (e.g. "github.com/owner/repo" or "https://github.com/owner/repo") into { owner, repo }.
 * @param {string} gitRepoPath
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGitRepoPath(gitRepoPath) {
  const s = typeof gitRepoPath === "string" ? gitRepoPath.trim() : "";
  if (!s) return null;
  let path = s
    .replace(/^https?:\/\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^github\.com\/?/i, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts[1] };
  }
  return null;
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
