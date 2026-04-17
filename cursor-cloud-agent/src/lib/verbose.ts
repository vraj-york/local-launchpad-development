const isServer = typeof window === "undefined";

function isVerbose(): boolean {
  if (isServer) return process.env.CLR_VERBOSE === "1";
  try {
    return localStorage.getItem("clr_verbose") === "1";
  } catch {
    return false;
  }
}

export function vlog(tag: string, ...args: unknown[]): void {
  if (!isVerbose()) return;
  console.warn(`[verbose][${tag}]`, ...args);
}
