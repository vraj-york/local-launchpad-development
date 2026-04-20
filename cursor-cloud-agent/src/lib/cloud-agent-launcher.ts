import { promisify } from "util";
import { execFile, type ChildProcess } from "child_process";
import { homedir } from "os";
import { dirname, join } from "path";
import { access, constants, mkdir, rm } from "fs/promises";
import { createHmac } from "crypto";
import { spawnAgent } from "@/lib/cursor-cli";
import { buildAgentPromptWithImageRefs, writePromptReferenceImages } from "@/lib/prompt-reference-images";
import { applyTemporaryMcpFromHost } from "@/lib/temporary-mcp-config";
import { registerCloudAgentChild } from "@/lib/cloud-agent-child-registry";
import { markCloudAgentFinished, markCloudAgentRunning } from "@/lib/cloud-agent-registry";
import {
  clearCloudAgentStopRequest,
  isCloudAgentStopRequested,
} from "@/lib/cloud-agent-stop-request";
import { drainFollowupQueueAfterRun } from "@/lib/followup-queue";
import {
  applyLaunchDefaults,
  getAgentConversation,
  getAgentFollowupContext,
  getAgentUserEmail,
  getDecryptedApiKeyForAgent,
  setAgentConversation,
  setAgentResultFields,
  setAgentSessionId,
  updateAgentStatus,
} from "@/lib/agent-store";
import { getGithubPatForEmail } from "@/lib/github-credentials-store";
import { getFigmaAccessTokenForEmail } from "@/lib/figma-credentials-store";
import type {
  CloudConversationMessage,
  CloudFollowupRequest,
  CloudLaunchRequest,
} from "@/lib/cloud-agents-types";
import { redactGitRemoteForLog, withOptionalGithubHttpsPat } from "@/lib/github-https-pat";

const CONVERSATION_FLUSH_DEBOUNCE_MS = 150;

const execFileAsync = promisify(execFile);

/** Master switch: `CLR_CLOUD_AGENT_LOG=0` silences all `[cloud-agent:*]` diagnostics. */
function shouldLogDiag(): boolean {
  return process.env.CLR_CLOUD_AGENT_LOG !== "0";
}

/** Set `CLR_GIT_LOG=0` to silence clone/fetch/publish lines (after master switch). */
function shouldLogGit(): boolean {
  return shouldLogDiag() && process.env.CLR_GIT_LOG !== "0";
}

/** Set `CLR_RUN_LOG=0` to silence agent lifecycle / Cursor CLI lines (after master switch). */
function shouldLogRun(): boolean {
  return shouldLogDiag() && process.env.CLR_RUN_LOG !== "0";
}

function logGit(event: string, detail: Record<string, unknown>): void {
  if (!shouldLogGit()) return;
  console.log(`[cloud-agent:git] ${event}`, detail);
}

function logRun(event: string, detail: Record<string, unknown>): void {
  if (!shouldLogRun()) return;
  console.log(`[cloud-agent:run] ${event}`, detail);
}

/** Git clone + Cursor `--workspace` root lives here (not the parent `agentId/` folder). */
export const CLOUD_AGENT_REPO_SUBDIR = "repo";

export function cloudAgentRepoWorkspace(agentId: string): string {
  return join(homedir(), ".cursor-local-remote", "cloud-workdirs", agentId, CLOUD_AGENT_REPO_SUBDIR);
}

/** DB PAT for agent email, else `GITHUB_PAT_TOKEN` env. */
async function resolveGithubPatForAgentId(agentId: string): Promise<string | null> {
  const userEmail = await getAgentUserEmail(agentId);
  const fromDb = userEmail ? await getGithubPatForEmail(userEmail) : null;
  const fromEnv = process.env.GITHUB_PAT_TOKEN?.trim() ?? null;
  return (fromDb ?? fromEnv) || null;
}

async function resolveFigmaApiKeyForAgentId(
  agentId: string,
): Promise<{ key: string | null; source: "db" | "env" | "none" }> {
  const userEmail = await getAgentUserEmail(agentId);
  const fromDb = userEmail ? await getFigmaAccessTokenForEmail(userEmail) : null;
  if (fromDb?.trim()) return { key: fromDb.trim(), source: "db" };
  const fromEnv = process.env.FIGMA_API_KEY?.trim() ?? null;
  if (fromEnv) return { key: fromEnv, source: "env" };
  return { key: null, source: "none" };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Child processes get the key in their environment (same effect as `export CURSOR_API_KEY` in a shell). */
function envWithCursorKey(apiKey: string): NodeJS.ProcessEnv {
  return { ...process.env, CURSOR_API_KEY: apiKey };
}

const DEFAULT_GIT_AUTHOR_NAME = "Cursor Cloud Agent";
const DEFAULT_GIT_AUTHOR_EMAIL = "cursor-cloud-agent@localhost";

/**
 * Env for `git` subprocesses so `git commit` works without global user.name/user.email (e.g. Docker root).
 * Override with GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL (or GIT_COMMITTER_*).
 * See: https://git-scm.com/docs/git#Documentation/git.txt-codeGITAUTHORNAMEcode
 */
function gitProcessEnv(apiKey?: string, githubPat?: string | null): NodeJS.ProcessEnv {
  const name =
    process.env.GIT_AUTHOR_NAME?.trim() ||
    process.env.GIT_COMMITTER_NAME?.trim() ||
    DEFAULT_GIT_AUTHOR_NAME;
  const email =
    process.env.GIT_AUTHOR_EMAIL?.trim() ||
    process.env.GIT_COMMITTER_EMAIL?.trim() ||
    DEFAULT_GIT_AUTHOR_EMAIL;
  const pat = githubPat?.trim();
  return {
    ...process.env,
    ...(apiKey ? { CURSOR_API_KEY: apiKey } : {}),
    ...(pat ? { GH_TOKEN: pat, GITHUB_TOKEN: pat } : {}),
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

function cmdEnv(command: string, apiKey?: string, githubPat?: string | null): NodeJS.ProcessEnv {
  if (command === "git") {
    return gitProcessEnv(apiKey, githubPat);
  }
  const base = apiKey ? envWithCursorKey(apiKey) : { ...process.env };
  const pat = githubPat?.trim();
  if (pat) {
    return { ...base, GH_TOKEN: pat, GITHUB_TOKEN: pat };
  }
  return base;
}

export interface LaunchAgentBackgroundInput {
  id: string;
  request: CloudLaunchRequest;
  workspace: string;
  branchName: string;
  sourceRef: string;
  model: string;
}

interface PrContext {
  headRefName?: string;
  baseRefName?: string;
}

async function runCmd(
  command: string,
  args: string[],
  cwd?: string,
  apiKey?: string,
  githubPat?: string | null,
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    env: cmdEnv(command, apiKey, githubPat),
    encoding: "utf-8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function runCmdAllowFail(
  command: string,
  args: string[],
  cwd?: string,
  apiKey?: string,
  githubPat?: string | null,
): Promise<string> {
  try {
    return await runCmd(command, args, cwd, apiKey, githubPat);
  } catch (err) {
    const e = err as { stdout?: string };
    return (e.stdout || "").trim();
  }
}

function parseRepoFromPrUrl(prUrl: string): string | null {
  try {
    const u = new URL(prUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 4 || parts[2] !== "pull") return null;
    return `https://github.com/${parts[0]}/${parts[1]}.git`;
  } catch {
    return null;
  }
}

async function getPrContext(
  prUrl: string,
  cwd: string,
  apiKey: string,
  githubPat: string | null,
): Promise<PrContext> {
  try {
    const raw = await runCmd("gh", ["pr", "view", prUrl, "--json", "headRefName,baseRefName"], cwd, apiKey, githubPat);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { headRefName?: string; baseRefName?: string };
    return { headRefName: parsed.headRefName, baseRefName: parsed.baseRefName };
  } catch {
    return {};
  }
}

async function ensureWorkspace(
  input: LaunchAgentBackgroundInput,
  apiKey: string,
  githubPat: string | null,
): Promise<{ cwd: string; baseRef: string; workBranch: string }> {
  const cwd = input.workspace;
  const parent = dirname(cwd);
  await mkdir(parent, { recursive: true });

  const repoFromPr = input.request.source.prUrl ? parseRepoFromPrUrl(input.request.source.prUrl) : null;
  const repo = input.request.source.repository || repoFromPr;
  if (!repo) {
    throw new Error("Missing source.repository and unable to infer from source.prUrl");
  }

  const repoForGit = withOptionalGithubHttpsPat(repo, githubPat);
  const remoteForLog = redactGitRemoteForLog(repoForGit);
  const patFromEnv = Boolean(process.env.GITHUB_PAT_TOKEN?.trim());
  const patFromArg = Boolean(githubPat?.trim());

  logGit("workspace.prepare", {
    remote: remoteForLog,
    githubPatFromEnv: patFromEnv,
    githubPatFromRequest: patFromArg,
    workspace: cwd,
  });

  const k = apiKey;
  const exists = await pathExists(cwd);
  const hasGit =
    exists &&
    (await runCmdAllowFail("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], undefined, k, githubPat)) ===
      "true";

  if (!exists) {
    logGit("clone.start", { remote: remoteForLog, target: cwd });
    await runCmd("git", ["clone", repoForGit, cwd], undefined, k, githubPat);
    logGit("clone.done", { remote: remoteForLog, target: cwd });
  } else if (!hasGit) {
    await rm(cwd, { recursive: true, force: true });
    logGit("clone.start", { remote: remoteForLog, target: cwd, note: "replaced non-git directory" });
    await runCmd("git", ["clone", repoForGit, cwd], undefined, k, githubPat);
    logGit("clone.done", { remote: remoteForLog, target: cwd });
  } else {
    logGit("remote.set-url", { remote: remoteForLog, cwd });
    await runCmdAllowFail("git", ["remote", "set-url", "origin", repoForGit], cwd, k, githubPat);
    logGit("fetch.start", { cwd });
    await runCmd("git", ["fetch", "--all", "--prune"], cwd, k, githubPat);
    logGit("fetch.done", { cwd });
  }

  const prCtx = input.request.source.prUrl
    ? await getPrContext(input.request.source.prUrl, cwd, k, githubPat)
    : {};
  const baseRef = prCtx.baseRefName || input.sourceRef || "main";
  let workBranch = input.branchName;

  if (input.request.source.prUrl && input.request.target?.autoBranch === false) {
    workBranch = prCtx.headRefName || input.branchName;
    await runCmd("git", ["checkout", workBranch], cwd, k, githubPat);
  } else {
    await runCmd("git", ["checkout", baseRef], cwd, k, githubPat);
    await runCmdAllowFail("git", ["pull", "--ff-only", "origin", baseRef], cwd, k, githubPat);
    await runCmd("git", ["checkout", "-B", workBranch], cwd, k, githubPat);
  }

  return { cwd, baseRef, workBranch };
}

/**
 * Clone/fetch repo and prepare work branch (same as first phase of launch).
 * Call from POST /api/v0/agents before persisting the agent so clone failures return immediately.
 */
export async function prepareCloudAgentWorkspace(
  input: LaunchAgentBackgroundInput,
  apiKey: string,
  githubPat: string | null,
): Promise<{ cwd: string; baseRef: string; workBranch: string }> {
  return ensureWorkspace(input, apiKey, githubPat);
}

function extractTextFromEventMessage(event: Record<string, unknown>): string {
  const msg = event.message as Record<string, unknown> | undefined;
  const content = msg?.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}

function appendStreamChunk(
  messages: CloudConversationMessage[],
  nextSeq: { n: number },
  role: "user" | "assistant",
  text: string,
): void {
  const cloudType: CloudConversationMessage["type"] = role === "user" ? "user_message" : "assistant_message";
  const last = messages[messages.length - 1];
  if (last?.type === cloudType) {
    last.text += text;
  } else {
    messages.push({
      id: `msg_${String(nextSeq.n++).padStart(3, "0")}`,
      type: cloudType,
      text,
    });
  }
}

async function createCommitIfNeeded(
  cwd: string,
  id: string,
  apiKey: string,
  githubPat: string | null,
): Promise<boolean> {
  await runCmd("git", ["add", "-A"], cwd, apiKey, githubPat);
  try {
    await runCmd("git", ["diff", "--cached", "--quiet"], cwd, apiKey, githubPat);
    return false;
  } catch {
    await runCmd("git", ["commit", "-m", `chore: cloud agent ${id} changes`], cwd, apiKey, githubPat);
    return true;
  }
}

/** Best-effort: commit, push, and optional PR — failures do not fail the agent run. */
async function tryPublishCloudAgentChanges(
  agentId: string,
  autoCreatePr: boolean,
  cwd: string,
  apiKey: string,
  githubPat: string | null,
  baseRef: string,
  workBranch: string | undefined,
  summary: string,
): Promise<string | undefined> {
  if (!workBranch?.trim()) {
    logGit("publish.skip", { agentId, reason: "no_work_branch" });
    return undefined;
  }
  const wb = workBranch.trim();

  logGit("publish.begin", {
    agentId,
    cwd,
    workBranch: wb,
    baseRef,
    autoCreatePr,
  });

  let committed = false;
  try {
    committed = await createCommitIfNeeded(cwd, agentId, apiKey, githubPat);
  } catch (err) {
    logGit("publish.commit_failed", {
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }

  logGit("publish.commit_checked", { agentId, createdCommit: committed, workBranch: wb });

  if (!committed) {
    logGit("push.skip", {
      agentId,
      reason: "nothing_to_commit",
      workBranch: wb,
      note: "git had no staged changes after agent run — push not attempted",
    });
  } else {
    try {
      logGit("push.start", { branch: wb, cwd, agentId, note: "git push attempt" });
      await runCmd("git", ["push", "-u", "origin", wb], cwd, apiKey, githubPat);
      logGit("push.done", { branch: wb, cwd, agentId });
    } catch (err) {
      logGit("push.failed", {
        agentId,
        branch: wb,
        cwd,
        error: err instanceof Error ? err.message : String(err),
      });
      // nothing to push or remote rejected — still finish the run
    }
  }

  if (!autoCreatePr) {
    logGit("pr.skip", { agentId, reason: "autoCreatePr_false" });
    return undefined;
  }

  try {
    logGit("pr.attempt", { agentId, baseRef, head: wb });
    const prTitle = summary ? summary.slice(0, 120) : `Cloud agent ${agentId}`;
    const prBody = summary || `Automated changes from cloud agent ${agentId}.`;
    const prOutput = await runCmd(
      "gh",
      ["pr", "create", "--base", baseRef, "--head", wb, "--title", prTitle, "--body", prBody],
      cwd,
      apiKey,
      githubPat,
    );
    const m = prOutput.match(/https?:\/\/\S+/);
    const prUrl = m ? m[0] : undefined;
    if (prUrl) {
      logGit("pr.created", { agentId, url: prUrl });
    } else {
      logGit("pr.no_url_in_output", { agentId, snippet: prOutput.slice(0, 300) });
    }
    return prUrl;
  } catch (err) {
    logGit("pr.failed", {
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

export async function postAgentWebhook(
  webhookUrl: string | null | undefined,
  webhookSecret: string | null | undefined,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = webhookUrl?.trim();
  if (!url) return;
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = webhookSecret?.trim();
  if (secret) {
    headers["X-Webhook-Signature"] = createHmac("sha256", secret).update(body).digest("hex");
  }
  await fetch(url, { method: "POST", headers, body });
}

export async function finalizeAgentStoppedByApi(
  agentId: string,
  webhookUrl: string | null | undefined,
  webhookSecret: string | null | undefined,
): Promise<void> {
  clearCloudAgentStopRequest(agentId);
  await updateAgentStatus(agentId, "STOPPED", "Stopped by API");
  await postAgentWebhook(webhookUrl, webhookSecret, {
    id: agentId,
    status: "STOPPED",
    timestamp: Date.now(),
  });
  logRun("agent.stopped", { agentId, source: "api" });
}

async function abortRunIfStopRequested(
  agentId: string,
  webhookUrl: string | null | undefined,
  webhookSecret: string | null | undefined,
): Promise<boolean> {
  if (!isCloudAgentStopRequested(agentId)) return false;
  await finalizeAgentStoppedByApi(agentId, webhookUrl, webhookSecret);
  return true;
}

function nextMessageSeq(messages: CloudConversationMessage[]): { nextId: string; nextSeq: { n: number } } {
  let max = 0;
  for (const m of messages) {
    const r = /^msg_(\d+)$/.exec(m.id);
    if (r) max = Math.max(max, parseInt(r[1], 10));
  }
  const newNum = max + 1;
  return {
    nextId: `msg_${String(newNum).padStart(3, "0")}`,
    nextSeq: { n: newNum + 1 },
  };
}

async function consumeAgentStream(
  child: ChildProcess,
  agentId: string,
  conversationMessages: CloudConversationMessage[],
  nextSeq: { n: number },
  echoDedupe: "launch" | "followup",
): Promise<string> {
  let summary = "";
  await new Promise<void>((resolve, reject) => {
    let stdoutBuffer = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushConversation = async (): Promise<void> => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await setAgentConversation(agentId, [...conversationMessages]);
    };

    const scheduleFlush = (): void => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushConversation();
      }, CONVERSATION_FLUSH_DEBOUNCE_MS);
    };

    const processEventLine = (line: string): void => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === "system" && event.subtype === "init" && typeof event.session_id === "string") {
          void setAgentSessionId(agentId, event.session_id);
        }
        const et = event.type as string;
        if (et === "user" || et === "assistant") {
          const text = extractTextFromEventMessage(event);
          if (!text) return;
          if (et === "user") {
            if (echoDedupe === "launch") {
              if (
                conversationMessages.length === 1 &&
                conversationMessages[0].type === "user_message" &&
                text.trim() === conversationMessages[0].text.trim()
              ) {
                return;
              }
            } else {
              const lastUser = [...conversationMessages].reverse().find((m) => m.type === "user_message");
              if (lastUser && text.trim() === lastUser.text.trim()) {
                return;
              }
            }
          }
          appendStreamChunk(conversationMessages, nextSeq, et === "user" ? "user" : "assistant", text);
          scheduleFlush();
        }
      } catch {
        // ignore non-json stream lines
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        processEventLine(line);
      }
    });
    child.stderr?.on("data", () => {
      // stream consumed for process health; errors are handled by exit code
    });
    child.on("error", reject);
    child.on("close", (code) => {
      void (async () => {
        if (stdoutBuffer.trim()) {
          processEventLine(stdoutBuffer);
        }
        await flushConversation();
        const lastAsst = [...conversationMessages].reverse().find((m) => m.type === "assistant_message");
        if (lastAsst) {
          summary = lastAsst.text.trim().slice(0, 4000);
        }
        if (code === 0) resolve();
        else reject(new Error(`agent exited with code ${String(code)}`));
      })();
    });
  });
  return summary;
}

export async function launchAgentInBackground(input: LaunchAgentBackgroundInput): Promise<void> {
  markCloudAgentRunning(input.id);
  let summary = "";
  let targetPrUrl: string | undefined;
  const whUrl = input.request.webhook?.url;
  const whSecret = input.request.webhook?.secret;
  try {
    logRun("launch.begin", { agentId: input.id, model: input.model });

    const apiKey = await getDecryptedApiKeyForAgent(input.id);
    if (!apiKey) {
      logRun("launch.abort", { agentId: input.id, reason: "missing_api_key" });
      await updateAgentStatus(input.id, "FAILED", "Missing or invalid stored API key");
      await postAgentWebhook(whUrl, whSecret, {
        id: input.id,
        status: "FAILED",
        error: "Missing or invalid stored API key",
        timestamp: Date.now(),
      });
      return;
    }

    await updateAgentStatus(input.id, "RUNNING");
    await postAgentWebhook(whUrl, whSecret, { id: input.id, status: "RUNNING", timestamp: Date.now() });
    logRun("agent.status", { agentId: input.id, status: "RUNNING" });

    if (await abortRunIfStopRequested(input.id, whUrl, whSecret)) return;

    const githubPat = await resolveGithubPatForAgentId(input.id);
    if (await abortRunIfStopRequested(input.id, whUrl, whSecret)) return;

    const { cwd, baseRef, workBranch } = await ensureWorkspace(input, apiKey, githubPat);
    if (await abortRunIfStopRequested(input.id, whUrl, whSecret)) return;
    logRun("workspace.ready", { agentId: input.id, cwd, baseRef, workBranch });

    const figmaResolved = await resolveFigmaApiKeyForAgentId(input.id);
    logRun("mcp.figma", {
      agentId: input.id,
      source: figmaResolved.source,
      configured: Boolean(figmaResolved.key),
      tokenLen: figmaResolved.key?.length ?? 0,
    });
    const mcpTemp = await applyTemporaryMcpFromHost(
      cwd,
      figmaResolved.key ? { FIGMA_API_KEY: figmaResolved.key } : undefined,
    );
    if (await abortRunIfStopRequested(input.id, whUrl, whSecret)) {
      if (mcpTemp) {
        try {
          await mcpTemp.cleanup();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    try {
      const { dir: promptRefDir, relPaths } = await writePromptReferenceImages(
        cwd,
        input.id,
        input.request.prompt.images,
      );

      const agentPrompt =
        relPaths.length > 0
          ? buildAgentPromptWithImageRefs(input.request.prompt.text, relPaths)
          : input.request.prompt.text;

      const conversationMessages: CloudConversationMessage[] = [
        { id: "msg_001", type: "user_message", text: agentPrompt },
      ];
      const nextSeq = { n: 2 };
      await setAgentConversation(input.id, conversationMessages);

      logRun("cursor_cli.spawn", {
        agentId: input.id,
        workspace: cwd,
        model: input.model === "default" ? "default" : input.model,
      });
      if (await abortRunIfStopRequested(input.id, whUrl, whSecret)) return;

      const child = await spawnAgent({
        prompt: agentPrompt,
        workspace: cwd,
        model: input.model === "default" ? undefined : input.model,
        env: {
          CURSOR_API_KEY: apiKey,
        },
      });
      registerCloudAgentChild(input.id, child);

      try {
        summary = await consumeAgentStream(child, input.id, conversationMessages, nextSeq, "launch");
        logRun("cursor_cli.exited", { agentId: input.id, ok: true });
      } catch (streamErr) {
        const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        logRun("cursor_cli.exited", { agentId: input.id, ok: false, error: msg });
        throw streamErr;
      } finally {
        if (promptRefDir) {
          try {
            await rm(promptRefDir, { recursive: true, force: true });
          } catch (err) {
            console.warn("[cloud-agent] failed to remove prompt reference images:", err);
          }
        }
      }
    } finally {
      if (mcpTemp) {
        try {
          await mcpTemp.cleanup();
        } catch (err) {
          console.warn("[cloud-agent] failed to clean up temporary .cursor/mcp.json:", err);
        }
      }
    }

    const autoCreatePr = applyLaunchDefaults(input.request).target.autoCreatePr;
    targetPrUrl = await tryPublishCloudAgentChanges(
      input.id,
      autoCreatePr,
      cwd,
      apiKey,
      githubPat,
      baseRef,
      workBranch,
      summary,
    );

    await setAgentResultFields(input.id, { targetPrUrl, summary: summary || "Completed successfully" });
    await updateAgentStatus(input.id, "FINISHED");
    logRun("launch.complete", { agentId: input.id, status: "FINISHED", targetPrUrl: targetPrUrl ?? null });
    await postAgentWebhook(whUrl, whSecret, {
      id: input.id,
      status: "FINISHED",
      targetPrUrl,
      timestamp: Date.now(),
    });
  } catch (err) {
    if (isCloudAgentStopRequested(input.id)) {
      await finalizeAgentStoppedByApi(input.id, whUrl, whSecret);
    } else {
      const message = err instanceof Error ? err.message : "Launch failed";
      logRun("launch.complete", { agentId: input.id, status: "FAILED", error: message });
      await updateAgentStatus(input.id, "FAILED", message);
      await postAgentWebhook(whUrl, whSecret, { id: input.id, status: "FAILED", error: message, timestamp: Date.now() });
    }
  } finally {
    markCloudAgentFinished(input.id);
    void drainFollowupQueueAfterRun(input.id);
  }
}

export interface FollowupAgentBackgroundInput {
  id: string;
  apiKeyFingerprint: string;
  /** Normalized email; may be empty when draining legacy queue rows — resolved from agent if needed. */
  userEmailNormalized: string;
  prompt: CloudFollowupRequest["prompt"];
}

export async function followupAgentInBackground(input: FollowupAgentBackgroundInput): Promise<void> {
  const { id, apiKeyFingerprint, prompt } = input;
  let userEmailNormalized = input.userEmailNormalized?.trim() || "";
  if (!userEmailNormalized) {
    userEmailNormalized = (await getAgentUserEmail(id)) ?? "";
  }
  markCloudAgentRunning(id);
  let summary = "";
  let targetPrUrl: string | undefined;
  try {
    logRun("followup.begin", { agentId: id });

    const ctx = await getAgentFollowupContext(id, apiKeyFingerprint, userEmailNormalized);
    if (!ctx) {
      logRun("followup.abort", { agentId: id, reason: "agent_not_found" });
      await updateAgentStatus(id, "FAILED", "Agent not found");
      return;
    }
    if (!ctx.cursorSessionId) {
      logRun("followup.abort", { agentId: id, reason: "no_cursor_session" });
      await updateAgentStatus(id, "FAILED", "No Cursor session to resume; complete an initial run first");
      await postAgentWebhook(ctx.webhookUrl, ctx.webhookSecret, {
        id,
        status: "FAILED",
        error: "No Cursor session to resume",
        timestamp: Date.now(),
      });
      return;
    }

    const apiKey = await getDecryptedApiKeyForAgent(id);
    if (!apiKey) {
      logRun("followup.abort", { agentId: id, reason: "missing_api_key" });
      await updateAgentStatus(id, "FAILED", "Missing or invalid stored API key");
      await postAgentWebhook(ctx.webhookUrl, ctx.webhookSecret, {
        id,
        status: "FAILED",
        error: "Missing or invalid stored API key",
        timestamp: Date.now(),
      });
      return;
    }

    await updateAgentStatus(id, "RUNNING");
    await postAgentWebhook(ctx.webhookUrl, ctx.webhookSecret, { id, status: "RUNNING", timestamp: Date.now() });
    logRun("agent.status", { agentId: id, status: "RUNNING", mode: "followup" });

    if (await abortRunIfStopRequested(id, ctx.webhookUrl, ctx.webhookSecret)) return;

    const cwd = ctx.workspace;
    const githubPat = await resolveGithubPatForAgentId(id);
    if (await abortRunIfStopRequested(id, ctx.webhookUrl, ctx.webhookSecret)) return;
    logRun("workspace.ready", { agentId: id, cwd, workBranch: ctx.workBranch ?? null, sourceRef: ctx.sourceRef });
    const figmaResolved = await resolveFigmaApiKeyForAgentId(id);
    logRun("mcp.figma", {
      agentId: id,
      source: figmaResolved.source,
      configured: Boolean(figmaResolved.key),
      tokenLen: figmaResolved.key?.length ?? 0,
    });
    const mcpTemp = await applyTemporaryMcpFromHost(
      cwd,
      figmaResolved.key ? { FIGMA_API_KEY: figmaResolved.key } : undefined,
    );
    if (await abortRunIfStopRequested(id, ctx.webhookUrl, ctx.webhookSecret)) {
      if (mcpTemp) {
        try {
          await mcpTemp.cleanup();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    try {
      const { dir: promptRefDir, relPaths } = await writePromptReferenceImages(cwd, id, prompt.images);
      const agentPrompt =
        relPaths.length > 0 ? buildAgentPromptWithImageRefs(prompt.text, relPaths) : prompt.text.trim();

      const prior = await getAgentConversation(id);
      const { nextId, nextSeq } = nextMessageSeq(prior);
      const conversationMessages: CloudConversationMessage[] = [
        ...prior,
        { id: nextId, type: "user_message", text: agentPrompt },
      ];
      await setAgentConversation(id, conversationMessages);

      logRun("cursor_cli.spawn", {
        agentId: id,
        workspace: cwd,
        resumeSession: ctx.cursorSessionId,
        model: ctx.model === "default" ? "default" : ctx.model,
      });
      if (await abortRunIfStopRequested(id, ctx.webhookUrl, ctx.webhookSecret)) return;

      const child = await spawnAgent({
        prompt: agentPrompt,
        workspace: cwd,
        sessionId: ctx.cursorSessionId,
        model: ctx.model === "default" ? undefined : ctx.model,
        env: {
          CURSOR_API_KEY: apiKey,
        },
      });
      registerCloudAgentChild(id, child);

      try {
        summary = await consumeAgentStream(child, id, conversationMessages, nextSeq, "followup");
        logRun("cursor_cli.exited", { agentId: id, ok: true });
      } catch (streamErr) {
        const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        logRun("cursor_cli.exited", { agentId: id, ok: false, error: msg });
        throw streamErr;
      } finally {
        if (promptRefDir) {
          try {
            await rm(promptRefDir, { recursive: true, force: true });
          } catch (err) {
            console.warn("[cloud-agent] failed to remove prompt reference images:", err);
          }
        }
      }
    } finally {
      if (mcpTemp) {
        try {
          await mcpTemp.cleanup();
        } catch (err) {
          console.warn("[cloud-agent] failed to clean up temporary .cursor/mcp.json:", err);
        }
      }
    }

    targetPrUrl = await tryPublishCloudAgentChanges(
      id,
      ctx.autoCreatePr,
      cwd,
      apiKey,
      githubPat,
      ctx.sourceRef,
      ctx.workBranch ?? undefined,
      summary,
    );

    await setAgentResultFields(id, { targetPrUrl, summary: summary || "Completed successfully" });
    await updateAgentStatus(id, "FINISHED");
    logRun("followup.complete", { agentId: id, status: "FINISHED", targetPrUrl: targetPrUrl ?? null });
    await postAgentWebhook(ctx.webhookUrl, ctx.webhookSecret, {
      id,
      status: "FINISHED",
      targetPrUrl,
      timestamp: Date.now(),
    });
  } catch (err) {
    const ctxFail = await getAgentFollowupContext(id, apiKeyFingerprint, userEmailNormalized);
    if (isCloudAgentStopRequested(id)) {
      await finalizeAgentStoppedByApi(id, ctxFail?.webhookUrl, ctxFail?.webhookSecret);
    } else {
      const message = err instanceof Error ? err.message : "Follow-up failed";
      logRun("followup.complete", { agentId: id, status: "FAILED", error: message });
      await updateAgentStatus(id, "FAILED", message);
      await postAgentWebhook(ctxFail?.webhookUrl, ctxFail?.webhookSecret, {
        id,
        status: "FAILED",
        error: message,
        timestamp: Date.now(),
      });
    }
  } finally {
    markCloudAgentFinished(id);
    void drainFollowupQueueAfterRun(id);
  }
}
