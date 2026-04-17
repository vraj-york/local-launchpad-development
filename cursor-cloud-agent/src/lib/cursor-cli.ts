import { spawn, execFileSync, type ChildProcess } from "child_process";
import type { AgentMode } from "@/lib/types";
import { getConfig } from "@/lib/session-store";

let agentChecked = false;

function ensureAgentOnPath(): void {
  if (agentChecked) return;
  try {
    execFileSync("agent", ["--version"], { stdio: "ignore", timeout: 5_000 });
    agentChecked = true;
  } catch {
    throw new Error(
      "Could not find the 'agent' CLI. Make sure Cursor is installed and the CLI is on your PATH.",
    );
  }
}

export interface AgentOptions {
  prompt: string;
  sessionId?: string;
  workspace?: string;
  model?: string;
  mode?: AgentMode;
  env?: Record<string, string | undefined>;
}

async function shouldTrust(): Promise<boolean> {
  if (process.env.CURSOR_TRUST === "0") return false;
  if (process.env.CURSOR_TRUST === "1") return true;
  const val = await getConfig("trust");
  return val !== "0";
}

export async function spawnAgent(options: AgentOptions): Promise<ChildProcess> {
  ensureAgentOnPath();
  const args = [
    "-f",
    "-p",
    options.prompt,
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--approve-mcps",
  ];

  if (await shouldTrust()) {
    args.push("--trust");
  }
  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }
  if (options.workspace) {
    args.push("--workspace", options.workspace);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.mode && options.mode !== "agent") {
    args.push("--mode", options.mode);
  }

  return spawn("agent", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
  });
}

