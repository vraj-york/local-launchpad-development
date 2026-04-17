import { resolve } from "path";

export function getWorkspace(): string {
  const fromEnv = process.env.CURSOR_WORKSPACE;
  if (fromEnv) return resolve(fromEnv);
  return process.cwd();
}
