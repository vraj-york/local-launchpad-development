import { mkdir, readdir, readFile, rmdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { getWorkspace } from "@/lib/workspace";

/** Host `.cursor/mcp.json` may use `${env:VAR}`; resolved at copy time from server `process.env` (e.g. FIGMA_API_KEY from project `.env`). */
function interpolateMcpEnvPlaceholders(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{env:([^}]+)\}/g, (match, name: string) => {
      const key = name.trim();
      const v = process.env[key];
      if (v === undefined) {
        console.warn(`[cloud-agent] MCP env placeholder ${match} not set in process.env (${key})`);
        return "";
      }
      return v;
    });
  }
  if (Array.isArray(obj)) return obj.map(interpolateMcpEnvPlaceholders);
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = interpolateMcpEnvPlaceholders(v);
    }
    return out;
  }
  return obj;
}

/** Ephemeral MCP config copied from the host app into a cloud clone; removed before git commit. */
export async function applyTemporaryMcpFromHost(
  agentRepoCwd: string,
): Promise<{ cleanup: () => Promise<void> } | null> {
  const hostPath = join(getWorkspace(), ".cursor", "mcp.json");
  let hostContent: string;
  try {
    hostContent = await readFile(hostPath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(hostContent);
  } catch {
    return null;
  }

  const cursorDir = join(agentRepoCwd, ".cursor");
  const targetPath = join(cursorDir, "mcp.json");
  let previous: string | null = null;
  try {
    previous = await readFile(targetPath, "utf8");
  } catch {
    previous = null;
  }

  await mkdir(cursorDir, { recursive: true });
  const interpolated = interpolateMcpEnvPlaceholders(parsed);
  await writeFile(targetPath, `${JSON.stringify(interpolated, null, 2)}\n`, "utf8");

  return {
    cleanup: async () => {
      try {
        if (previous !== null) {
          await writeFile(targetPath, previous, "utf8");
        } else {
          await unlink(targetPath);
          try {
            const names = await readdir(cursorDir);
            if (names.length === 0) {
              await rmdir(cursorDir);
            }
          } catch {
            // ignore
          }
        }
      } catch (err) {
        console.warn("[cloud-agent] failed to restore/remove temporary .cursor/mcp.json:", err);
      }
    },
  };
}
