import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { applyPendingClientChatMessageShaTransaction } from "./chat.service.js";

const GIT_SHA_RE = /^[0-9a-f]{7,40}$/i;

function timingSafeEqualUtf8(a, b) {
  try {
    const ba = Buffer.from(String(a), "utf8");
    const bb = Buffer.from(String(b), "utf8");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function verifySha256HubSignature(rawBody, secret, headerVal) {
  if (!secret || headerVal == null || headerVal === "") return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqualUtf8(expected, String(headerVal).trim());
}

function canonicalGitRepoPath(provider, owner, repo) {
  const host = provider === "bitbucket" ? "bitbucket.org" : "github.com";
  return `${host}/${owner}/${repo}`;
}

/**
 * @param {Buffer} rawBody
 * @param {import("express").Request} req
 */
async function applyPushForProjectBranch(project, branch, sha) {
  const rows = await prisma.figmaConversion.findMany({
    where: {
      projectId: project.id,
      deferLaunchpadMerge: true,
      pendingClientChatMessageId: { not: null },
    },
    orderBy: { id: "desc" },
    select: {
      id: true,
      targetBranchName: true,
      pendingClientChatMessageId: true,
      releaseId: true,
    },
  });
  const br = branch.trim().toLowerCase();
  const conv = rows.find(
    (r) =>
      typeof r.targetBranchName === "string" && r.targetBranchName.trim().toLowerCase() === br,
  );
  if (!conv?.pendingClientChatMessageId || !conv.releaseId) return 0;

  await applyPendingClientChatMessageShaTransaction({
    projectId: project.id,
    releaseId: conv.releaseId,
    chatHistoryId: conv.pendingClientChatMessageId,
    tipSha: sha,
    figmaConversionId: conv.id,
    source: "scm-webhook",
  });
  return 1;
}

/**
 * @param {{ provider: 'github'|'bitbucket', owner: string, repo: string, branch: string, sha: string }} p
 */
export async function applyLaunchpadScmPushToPendingMessages(p) {
  const { provider, owner, repo, branch, sha } = p;
  if (!GIT_SHA_RE.test(sha)) return { projects: 0, applied: 0 };
  const canonical = canonicalGitRepoPath(provider, owner, repo);
  const projects = await prisma.project.findMany({
    where: {
      gitRepoPath: { equals: canonical, mode: "insensitive" },
    },
  });
  let applied = 0;
  for (const project of projects) {
    applied += await applyPushForProjectBranch(project, branch, sha);
  }
  return { projects: projects.length, applied };
}

function readRawBody(req) {
  return Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "", "utf8");
}

export async function handleGithubPushRequest(req, res) {
  const secret = (process.env.GITHUB_PUSH_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    res.status(503).send("not configured");
    return;
  }
  const raw = readRawBody(req);
  const sig = req.headers["x-hub-signature-256"];
  if (!verifySha256HubSignature(raw, secret, sig)) {
    console.warn("[webhook:github] invalid or missing X-Hub-Signature-256 (check GITHUB_PUSH_WEBHOOK_SECRET matches hook secret)");
    res.status(401).send("invalid signature");
    return;
  }

  let json;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    console.warn("[webhook:github] body is not valid JSON");
    res.status(400).send("bad json");
    return;
  }

  const after = typeof json.after === "string" ? json.after.trim() : "";
  if (!after || /^0+$/.test(after)) {
    res.status(200).json({ ok: true, skipped: true, reason: "no_tip_sha" });
    return;
  }

  const fullName =
    typeof json.repository?.full_name === "string" ? json.repository.full_name.trim() : "";
  const parts = fullName.split("/").filter(Boolean);
  if (parts.length < 2) {
    res.status(200).json({ ok: true, skipped: true, reason: "no_repository" });
    return;
  }
  const [own, rep] = parts;

  const ref = typeof json.ref === "string" ? json.ref.trim() : "";
  let branch = "";
  if (ref.startsWith("refs/heads/")) {
    branch = ref.slice("refs/heads/".length);
  } else if (ref.startsWith("refs/tags/")) {
    res.status(200).json({ ok: true, skipped: true, reason: "tag_push" });
    return;
  }
  if (!branch) {
    res.status(200).json({ ok: true, skipped: true, reason: "no_branch" });
    return;
  }

  const summary = await applyLaunchpadScmPushToPendingMessages({
    provider: "github",
    owner: own,
    repo: rep,
    branch,
    sha: after,
  });
  if (summary.applied > 0 || summary.projects > 0) {
    console.info(
      `[webhook:github] ${fullName}@${branch.slice(0, 48)} matchedProjects=${summary.projects} appliedPending=${summary.applied}`,
    );
  }
  res.status(200).json({ ok: true, ...summary });
}

export async function handleBitbucketPushRequest(req, res) {
  const secret = (process.env.BITBUCKET_PUSH_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    res.status(503).send("not configured");
    return;
  }
  const raw = readRawBody(req);
  const sig =
    req.headers["x-hub-signature-256"] || req.headers["x-hub-signature"];
  if (!verifySha256HubSignature(raw, secret, sig)) {
    console.warn("[webhook:bitbucket] invalid signature (check BITBUCKET_PUSH_WEBHOOK_SECRET)");
    res.status(401).send("invalid signature");
    return;
  }

  let json;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    console.warn("[webhook:bitbucket] body is not valid JSON");
    res.status(400).send("bad json");
    return;
  }

  const fullName =
    typeof json.repository?.full_name === "string"
      ? json.repository.full_name.trim()
      : "";
  const rp = fullName.split("/").filter(Boolean);
  if (rp.length < 2) {
    res.status(200).json({ ok: true, skipped: true, reason: "no_repository" });
    return;
  }
  const [workspace, repoSlug] = rp;

  const changes = Array.isArray(json.push?.changes) ? json.push.changes : [];
  let applied = 0;
  for (const ch of changes) {
    const nw = ch?.new;
    if (!nw || String(nw.type || "").toLowerCase() !== "branch") continue;
    const name = typeof nw.name === "string" ? nw.name.trim() : "";
    const hash = nw.target?.hash ? String(nw.target.hash).trim() : "";
    if (!name || !hash) continue;
    const summary = await applyLaunchpadScmPushToPendingMessages({
      provider: "bitbucket",
      owner: workspace,
      repo: repoSlug,
      branch: name,
      sha: hash,
    });
    applied += summary.applied;
  }

  if (applied > 0) {
    console.info(`[webhook:bitbucket] ${fullName} appliedPending=${applied}`);
  }
  res.status(200).json({
    ok: true,
    applied,
    changes: changes.length,
  });
}
