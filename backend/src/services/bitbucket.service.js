import fetch from "node-fetch";

const BB_API = "https://api.bitbucket.org/2.0";

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

/**
 * @returns {Promise<{ ok: true, defaultBranch: string, fullName?: string } | { ok: false, status: number, message: string }>}
 */
export async function getBitbucketRepositoryMetadata(workspace, repoSlug, token) {
  const url = `${BB_API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: typeof data?.error?.message === "string" ? data.error.message : res.statusText,
    };
  }
  const mainbranch = data.mainbranch?.name || data.mainbranch;
  const defaultBranch =
    typeof mainbranch === "string" && mainbranch.trim() ? mainbranch.trim() : "main";
  const fullName = data.full_name || `${workspace}/${repoSlug}`;
  return { ok: true, defaultBranch, fullName };
}

/**
 * Create repository under workspace (slug).
 */
export async function createBitbucketRepository(workspace, repoSlug, token, { isPrivate = false } = {}) {
  const url = `${BB_API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scm: "git",
      is_private: Boolean(isPrivate),
    }),
  });
  const text = await res.text();
  if (res.status === 200 || res.status === 201) return;
  if (res.status === 400 && /already exists/i.test(text)) return;
  throw new Error(`Bitbucket repo create failed (${res.status}): ${text.slice(0, 500)}`);
}

/**
 * First workspace where the user is a member (for default repo creation).
 */
export async function getDefaultBitbucketWorkspace(token) {
  const url = `${BB_API}/workspaces?role=member&pagelen=1`;
  const res = await fetch(url, { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : `Bitbucket workspaces ${res.status}`,
    );
  }
  const w = Array.isArray(data.values) && data.values[0] ? data.values[0] : null;
  const slug = w?.slug ? String(w.slug).trim() : "";
  if (!slug) throw new Error("No Bitbucket workspace found for this account");
  return slug;
}

/**
 * Compare two refs — returns GitHub-shaped payload for chat/cursor.
 * @returns {Promise<{ ok: true, data: object } | { ok: false, status: number, message: string }>}
 */
export async function compareBitbucketRefs(workspace, repoSlug, baseRef, headRef, token) {
  const spec = `${baseRef}..${headRef}`;
  const url = `${BB_API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/diffstat/${encodeURIComponent(spec)}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: typeof data?.error?.message === "string" ? data.error.message : res.statusText,
    };
  }
  const values = Array.isArray(data.values) ? data.values : [];
  let additions = 0;
  let deletions = 0;
  const files = values.map((v) => {
    const pathNew = v.new?.path || v.new?.file || "";
    const pathOld = v.old?.path || v.old?.file || "";
    const filename = pathNew || pathOld || "unknown";
    const la = Number(v.lines_added || 0);
    const lr = Number(v.lines_removed || 0);
    additions += la;
    deletions += lr;
    let status = "modified";
    if (v.status === "added" || v.status === "ADDED") status = "added";
    else if (v.status === "removed" || v.status === "REMOVED") status = "removed";
    else if (v.status === "renamed" || v.status === "RENAMED") status = "renamed";
    return {
      filename,
      status,
      additions: la,
      deletions: lr,
      changes: la + lr,
    };
  });

  const status =
    files.length === 0 && additions === 0 && deletions === 0 ? "identical" : "ahead";

  return {
    ok: true,
    data: {
      status,
      files,
      commits: [],
      total_additions: additions,
      total_deletions: deletions,
      total_changes: additions + deletions,
    },
  };
}

/**
 * @returns {Promise<{ sha: string } | null>}
 */
export async function getBitbucketBranchTipSha(workspace, repoSlug, branch, token) {
  const url = `${BB_API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/refs/branches/${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const sha = data?.target?.hash;
  return sha ? { sha: String(sha) } : null;
}

/**
 * Same success/error shape as github.service getCommitInfo (for scm facade).
 * @returns {Promise<
 *   | { ok: true, sha: string, parents: string[] }
 *   | { ok: false, status: number, message: string }
 * >}
 */
export async function getBitbucketCommitInfo(workspace, repoSlug, ref, token) {
  const url = `${BB_API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/commit/${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: typeof data?.error?.message === "string" ? data.error.message : res.statusText,
    };
  }
  const sha = data.hash;
  if (!sha) {
    return { ok: false, status: 502, message: "Bitbucket commit response missing hash." };
  }
  const parents = Array.isArray(data.parents)
    ? data.parents.map((p) => (typeof p?.hash === "string" ? p.hash : null)).filter(Boolean)
    : [];
  return { ok: true, sha: String(sha), parents };
}

/**
 * Single-file commit via Bitbucket src API (multipart).
 * @returns {Promise<{ ok: true, path: string, commitSha?: string } | { ok: false, status: number, message?: string }>}
 */
export async function putBitbucketRepositoryContents(workspace, repoSlug, filePath, opts) {
  const { message, contentBase64, branch, token } = opts;
  const boundary = `----form${Date.now()}`;
  const buf = Buffer.from(contentBase64, "base64");
  const name = String(filePath || "file").replace(/^\/+/, "") || "file";

  const parts = [];
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="message"\r\n\r\n${message}\r\n`);
  parts.push(`--${boundary}\r\n`);
  parts.push(
    `Content-Disposition: form-data; name="branch"\r\n\r\n${branch}\r\n`,
  );
  parts.push(`--${boundary}\r\n`);
  parts.push(
    `Content-Disposition: form-data; name="${name}"; filename="${name.split("/").pop()}"\r\n`,
  );
  parts.push(`Content-Type: application/octet-stream\r\n\r\n`);
  const head = Buffer.from(parts.join(""), "utf8");
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([head, buf, tail]);

  const url = `${BB_API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/src`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, status: res.status, message: t.slice(0, 300) };
  }
  return { ok: true, path: filePath };
}

export async function deleteBitbucketBranch(workspace, repoSlug, branchName, token) {
  const url = `${BB_API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/refs/branches/${encodeURIComponent(branchName)}`;
  const res = await fetch(url, { method: "DELETE", headers: authHeaders(token) });
  return res.ok || res.status === 404;
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, status: number, message: string }>}
 */
export async function createBitbucketBranchAt(workspace, repoSlug, branchName, targetHash, token) {
  const url = `${BB_API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/refs/branches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: branchName, target: { hash: targetHash } }),
  });
  const text = await res.text().catch(() => "");
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, message: text.slice(0, 500) };
}

/**
 * Move branch tip to commit (delete + recreate if branch exists).
 * @returns {Promise<{ ok: true } | { ok: false, status: number, message: string }>}
 */
export async function setBitbucketBranchTip(workspace, repoSlug, branchName, targetHash, token) {
  const cur = await getBitbucketBranchTipSha(workspace, repoSlug, branchName, token);
  if (cur?.sha && cur.sha.toLowerCase() === targetHash.toLowerCase()) {
    return { ok: true };
  }
  if (cur?.sha) {
    await deleteBitbucketBranch(workspace, repoSlug, branchName, token);
  }
  return createBitbucketBranchAt(workspace, repoSlug, branchName, targetHash, token);
}

export async function getBitbucketTagTipHash(workspace, repoSlug, tagName, token) {
  const url = `${BB_API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/refs/tags/${encodeURIComponent(tagName)}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const h = data?.target?.hash;
  return h ? String(h) : null;
}

export async function deleteBitbucketTag(workspace, repoSlug, tagName, token) {
  const url = `${BB_API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/refs/tags/${encodeURIComponent(tagName)}`;
  const res = await fetch(url, { method: "DELETE", headers: authHeaders(token) });
  return res.ok || res.status === 404;
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, status: number, message: string }>}
 */
export async function createBitbucketTag(workspace, repoSlug, tagName, commitHash, token) {
  const url = `${BB_API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/refs/tags`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: tagName, target: { hash: commitHash } }),
  });
  const text = await res.text().catch(() => "");
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, message: text.slice(0, 500) };
}

/**
 * Same intent as github createTagIdempotent.
 * @returns {Promise<{ ok: true } | { ok: false, status: number, message: string }>}
 */
export async function createBitbucketTagIdempotent(workspace, repoSlug, tagName, sha, token) {
  const first = await createBitbucketTag(workspace, repoSlug, tagName, sha, token);
  if (first.ok) return { ok: true };

  const msg = (first.message || "").toLowerCase();
  const duplicate =
    first.status === 409 ||
    first.status === 400 ||
    msg.includes("already exists") ||
    msg.includes("already exist");

  if (!duplicate) return first;

  const existing = await getBitbucketTagTipHash(workspace, repoSlug, tagName, token);
  if (existing && existing.toLowerCase() === sha.toLowerCase()) {
    return { ok: true };
  }

  if (existing) {
    await deleteBitbucketTag(workspace, repoSlug, tagName, token);
    const second = await createBitbucketTag(workspace, repoSlug, tagName, sha, token);
    if (second.ok) return { ok: true };
    return second;
  }

  return first;
}
