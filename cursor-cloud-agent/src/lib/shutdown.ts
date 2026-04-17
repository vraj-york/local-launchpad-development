import { killAllProcesses } from "@/lib/process-registry";
import { killAllTerminals } from "@/lib/terminal-registry";

let registered = false;

export function registerShutdownHandler(): void {
  if (registered) return;
  registered = true;

  const handler = () => {
    killAllProcesses();
    killAllTerminals();
    process.exit(0);
  };

  process.on("SIGTERM", handler);
  process.on("SIGINT", handler);
}
