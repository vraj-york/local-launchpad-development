import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";

const execAsync = promisify(exec);

/** Homebrew locations often missing from PATH when Node is launched from GUI / IDEs. */
const DARWIN_NGINX_CANDIDATES = [
  "/opt/homebrew/bin/nginx",
  "/usr/local/bin/nginx",
  "/opt/homebrew/opt/nginx/bin/nginx",
];

function pathWithHomebrew() {
  const base = process.env.PATH || "";
  if (os.platform() !== "darwin") return base;
  const prefix = "/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin:/usr/local/sbin";
  return base.includes("/opt/homebrew/bin") || base.includes("/usr/local/bin")
    ? base
    : `${prefix}:${base}`;
}

/**
 * Resolve nginx executable without the `which` command (often missing on Alpine Node images).
 * On macOS, prepends Homebrew paths so `command -v nginx` works when launched from Cursor/VS Code.
 * Returns null if no binary exists (e.g. local dev without nginx) — callers should skip reload, not exec a bogus path.
 */
export async function resolveNginxBinary() {
  const fromEnv = process.env.NGINX_BIN?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  try {
    const { stdout } = await execAsync("command -v nginx", {
      shell: true,
      maxBuffer: 64 * 1024,
      env: { ...process.env, PATH: pathWithHomebrew() },
    });
    const bin = String(stdout || "")
      .trim()
      .split(/\r?\n/)[0];
    if (bin && fs.existsSync(bin)) return bin;
  } catch {
    // nginx not on PATH or shell failed
  }
  if (os.platform() === "linux") {
    const p = "/usr/sbin/nginx";
    if (fs.existsSync(p)) return p;
  } else {
    for (const p of DARWIN_NGINX_CANDIDATES) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function processIsRoot() {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

function execErrorText(err) {
  const std = err?.stderr != null ? String(err.stderr) : "";
  const msg = err?.message != null ? String(err.message) : "";
  return `${std}\n${msg}`;
}

/** Homebrew/macOS: reload fails if nginx was never started (missing nginx.pid). */
function looksLikeNginxMasterNotRunning(err) {
  return /nginx\.pid|failed \(2: No such file or directory\)|invalid PID|No such process/i.test(
    execErrorText(err),
  );
}

/**
 * Send HUP/reload to nginx. Never uses interactive sudo (avoids password prompts during API uploads).
 * - Tries direct `nginx -s reload` first (Docker / root).
 * - If that fails and not root, tries `sudo -n` only (passwordless sudo); otherwise surfaces the original error.
 * - On macOS, missing PID file means nginx isn’t running — skip reload with a short log (local dev).
 */
export async function signalNginxReload() {
  const nginxBin = await resolveNginxBinary();
  if (!nginxBin) {
    console.warn(
      "[nginx] Skipping reload: nginx executable not found. Build output is already under projects/; set NGINX_BIN or install nginx if you proxy with nginx.",
    );
    return;
  }
  const opts = { maxBuffer: 64 * 1024 };

  try {
    await execAsync(`${nginxBin} -s reload`, opts);
    return;
  } catch (errDirect) {
    if (
      /No such file or directory/i.test(execErrorText(errDirect)) &&
      /nginx/i.test(execErrorText(errDirect))
    ) {
      console.warn(
        "[nginx] Skipping reload: nginx binary missing or not runnable. Output is already deployed under projects/.",
      );
      return;
    }
    if (os.platform() === "darwin" && looksLikeNginxMasterNotRunning(errDirect)) {
      console.warn(
        "[nginx] Skipping reload: nginx is not running (no PID file). Start with: brew services start nginx",
      );
      return;
    }
    if (processIsRoot()) throw errDirect;
    try {
      await execAsync(`sudo -n ${nginxBin} -s reload`, opts);
    } catch {
      throw errDirect;
    }
  }
}
