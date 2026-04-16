import fetch from "node-fetch";
import { getLaunchpadGithubPushWebhookUrl } from "../utils/apiPublicBaseUrl.js";

const GITHUB_API = "https://api.github.com";

const LAUNCHPAD_GITHUB_HOOK_PATH = "/api/webhooks/github/push";

function githubHookConfigUrlMatchesLaunchpad(configUrl, expectedUrl) {
  const exp = String(expectedUrl || "").trim();
  const u = String(configUrl || "").trim();
  if (!exp || !u) return false;
  if (u === exp) return true;
  try {
    return new URL(u).pathname === LAUNCHPAD_GITHUB_HOOK_PATH;
  } catch {
    return u.replace(/\/+$/, "") === exp.replace(/\/+$/, "");
  }
}

async function githubJson(method, path, token, body) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const msg =
      typeof data?.message === "string" ? data.message : `${res.status} ${text}`.slice(0, 500);
    throw new Error(msg);
  }
  return data;
}

/**
 * @returns {Promise<any[]>}
 */
export async function listGithubRepoWebhooks(owner, repo, token) {
  const data = await githubJson(
    "GET",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/hooks`,
    token,
    null,
  );
  return Array.isArray(data) ? data : [];
}

/**
 * Ensures a single GitHub repo webhook for Launchpad push events.
 * @returns {Promise<{ ok: true, created?: boolean, updated?: boolean, hookId?: number } | { ok: false, skipped: true, reason: string }>}
 */
export async function createOrUpdateLaunchpadGithubPushWebhook(owner, repo, token) {
  const hookUrl = getLaunchpadGithubPushWebhookUrl();
  const secret = (process.env.GITHUB_PUSH_WEBHOOK_SECRET || "").trim();
  if (!hookUrl || !secret) {
    return { ok: false, skipped: true, reason: "missing_api_public_base_or_secret" };
  }

  const hooks = await listGithubRepoWebhooks(owner, repo, token);
  const existing = hooks.find((h) => githubHookConfigUrlMatchesLaunchpad(h?.config?.url, hookUrl));

  const payload = {
    name: "web",
    active: true,
    events: ["push"],
    config: {
      url: hookUrl,
      content_type: "json",
      secret,
      insecure_ssl: "0",
    },
  };

  if (existing?.id) {
    await githubJson(
      "PATCH",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/hooks/${existing.id}`,
      token,
      payload,
    );
    return { ok: true, updated: true, hookId: existing.id };
  }

  const created = await githubJson(
    "POST",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/hooks`,
    token,
    payload,
  );
  return { ok: true, created: true, hookId: created?.id };
}
