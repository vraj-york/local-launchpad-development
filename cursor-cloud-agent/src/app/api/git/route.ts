import { execFile } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { join } from "path";
import { getWorkspace } from "@/lib/workspace";
import { badRequest, serverError, parseJsonBody } from "@/lib/errors";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

let cache: { data: Record<string, unknown>; ts: number; key: string } | null = null;
const CACHE_TTL = 10_000;

async function git(args: string[], cwd: string, maxBuffer = 1024 * 512): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function gitRaw(args: string[], cwd: string, maxBuffer = 1024 * 1024): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer,
    });
    return stdout;
  } catch (err: unknown) {
    const e = err as { stdout?: string };
    if (e.stdout) return e.stdout;
    return "";
  }
}

async function gitOrThrow(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 15_000,
    maxBuffer: 1024 * 512,
  });
  return stdout.trim();
}

function parseWorkspace(req: Request): string {
  const url = new URL(req.url);
  return url.searchParams.get("workspace") || getWorkspace();
}

async function resolveGitRoot(cwd: string): Promise<string> {
  const root = await git(["rev-parse", "--show-toplevel"], cwd);
  return root || cwd;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const detail = url.searchParams.get("detail");
  const rawCwd = parseWorkspace(req);
  const cwd = await resolveGitRoot(rawCwd);

  if (detail === "status") {
    return getDetailedStatus(cwd);
  }
  if (detail === "diff") {
    const file = url.searchParams.get("file");
    return getDiff(cwd, file);
  }
  if (detail === "branches") {
    return getBranches(cwd);
  }

  const cacheKey = cwd;
  if (cache && cache.key === cacheKey && Date.now() - cache.ts < CACHE_TTL) {
    return Response.json(cache.data);
  }

  const [branch, porcelain, lastCommit, remote] = await Promise.all([
    git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    git(["status", "--porcelain"], cwd),
    git(["log", "-1", "--format=%s"], cwd),
    git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd),
  ]);

  if (!branch) {
    return Response.json({ branch: null, changedFiles: 0, lastCommit: null, hasRemote: false });
  }

  const changedFiles = porcelain ? porcelain.split("\n").filter(Boolean).length : 0;
  const hasRemote = remote !== "";
  const data = { branch, changedFiles, lastCommit: lastCommit || null, hasRemote };
  cache = { data, ts: Date.now(), key: cacheKey };
  return Response.json(data);
}

interface FileStatus {
  file: string;
  status: string;
  staged: boolean;
}

async function getDetailedStatus(cwd: string) {
  const [branch, porcelainRaw] = await Promise.all([
    git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    gitRaw(["status", "--porcelain"], cwd),
  ]);
  const porcelain = porcelainRaw.trimEnd();

  if (!branch) {
    return Response.json({ branch: null, files: [] });
  }

  const statusMap: Record<string, string> = {
    M: "modified",
    A: "added",
    D: "deleted",
    R: "renamed",
    C: "copied",
    "?": "untracked",
  };

  const files: FileStatus[] = [];
  for (const line of porcelain.split("\n")) {
    if (!line) continue;
    const index = line[0];
    const worktree = line[1];
    const file = line.slice(3);

    if (index !== " " && index !== "?") {
      files.push({ file, status: statusMap[index] || "modified", staged: true });
    } else if (worktree !== " ") {
      files.push({ file, status: worktree === "?" ? "untracked" : (statusMap[worktree] || "modified"), staged: false });
    }
  }

  let ahead = 0;
  let behind = 0;
  const abRaw = await git(["rev-list", "--left-right", "--count", "HEAD...@{u}"], cwd);
  if (abRaw) {
    const parts = abRaw.split(/\s+/);
    ahead = parseInt(parts[0], 10) || 0;
    behind = parseInt(parts[1], 10) || 0;
  }

  return Response.json({ branch, files, ahead, behind });
}

async function getDiff(cwd: string, file: string | null) {
  if (!file) {
    let diff = await gitRaw(["diff", "HEAD"], cwd);
    if (!diff) diff = await gitRaw(["diff", "--cached"], cwd);
    if (!diff) diff = await gitRaw(["diff"], cwd);
    return Response.json({ diff: diff.trim() });
  }

  const strategies: string[][] = [
    ["diff", "HEAD", "--", file],
    ["diff", "--cached", "--", file],
    ["diff", "--", file],
    ["diff", "--no-index", "/dev/null", file],
  ];

  let diff = "";
  for (const args of strategies) {
    diff = await gitRaw(args, cwd);
    if (diff) break;
  }

  if (!diff) {
    try {
      const content = await readFile(join(cwd, file), "utf-8");
      const lines = content.split("\n").map((l) => "+" + l).join("\n");
      diff = `diff --git a/${file} b/${file}\nnew file\n--- /dev/null\n+++ b/${file}\n${lines}\n`;
    } catch {
      // file unreadable (e.g. deleted)
    }
  }

  return Response.json({ diff: diff.trim() });
}

async function getBranches(cwd: string) {
  const current = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const raw = await git(["branch", "--format=%(refname:short)"], cwd);
  const local = raw ? raw.split("\n").filter(Boolean) : [];
  const remoteRaw = await git(["branch", "-r", "--format=%(refname:short)"], cwd);
  const remote = remoteRaw
    ? remoteRaw.split("\n").filter((b) => b && !b.includes("HEAD")).map((b) => b.replace(/^origin\//, ""))
    : [];
  const remoteOnly = remote.filter((b) => !local.includes(b));
  return Response.json({ current, local, remoteOnly });
}

export async function POST(req: Request) {
  const body = await parseJsonBody<{
    action: string;
    message?: string;
    workspace?: string;
    files?: string[];
    branch?: string;
  }>(req);
  if (body instanceof Response) return body;

  const rawCwd = body.workspace || getWorkspace();
  const cwd = await resolveGitRoot(rawCwd);
  const action = body.action;

  try {
    switch (action) {
      case "commit": {
        if (!body.message?.trim()) return badRequest("Commit message is required");
        if (body.files?.length) {
          await gitOrThrow(["add", "--", ...body.files], cwd);
        } else {
          await gitOrThrow(["add", "-A"], cwd);
        }
        await gitOrThrow(["commit", "-m", body.message.trim()], cwd);
        cache = null;
        return Response.json({ ok: true });
      }
      case "push": {
        await gitOrThrow(["push"], cwd);
        cache = null;
        return Response.json({ ok: true });
      }
      case "fetch": {
        await gitOrThrow(["fetch"], cwd);
        cache = null;
        return Response.json({ ok: true });
      }
      case "pull": {
        const output = await gitOrThrow(["pull"], cwd);
        cache = null;
        return Response.json({ ok: true, output });
      }
      case "stage": {
        if (!body.files?.length) return badRequest("No files specified");
        await gitOrThrow(["add", "--", ...body.files], cwd);
        cache = null;
        return Response.json({ ok: true });
      }
      case "unstage": {
        if (!body.files?.length) return badRequest("No files specified");
        await gitOrThrow(["reset", "HEAD", "--", ...body.files], cwd);
        cache = null;
        return Response.json({ ok: true });
      }
      case "discard": {
        if (!body.files?.length) return badRequest("No files specified");
        const porcelain = (await gitRaw(["status", "--porcelain"], cwd)).trimEnd();
        const untrackedSet = new Set<string>();
        const newStagedSet = new Set<string>();
        for (const line of porcelain.split("\n")) {
          if (!line) continue;
          if (line.startsWith("?")) untrackedSet.add(line.slice(3));
          else if (line[0] === "A") newStagedSet.add(line.slice(3));
        }
        const tracked: string[] = [];
        const newStaged: string[] = [];
        const untracked: string[] = [];
        for (const f of body.files) {
          if (untrackedSet.has(f)) untracked.push(f);
          else if (newStagedSet.has(f)) newStaged.push(f);
          else tracked.push(f);
        }
        if (tracked.length) await gitOrThrow(["checkout", "HEAD", "--", ...tracked], cwd);
        if (newStaged.length) await gitOrThrow(["rm", "-f", "--", ...newStaged], cwd);
        if (untracked.length) await gitOrThrow(["clean", "-f", "--", ...untracked], cwd);
        cache = null;
        return Response.json({ ok: true });
      }
      case "checkout": {
        if (!body.branch) return badRequest("Branch name is required");
        await gitOrThrow(["checkout", body.branch], cwd);
        cache = null;
        return Response.json({ ok: true });
      }
      case "create_branch": {
        if (!body.branch) return badRequest("Branch name is required");
        await gitOrThrow(["checkout", "-b", body.branch], cwd);
        cache = null;
        return Response.json({ ok: true });
      }
      default:
        return badRequest("Unknown action: " + String(action));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Git operation failed";
    return serverError(msg);
  }
}
