import { getTerminal, onTerminalOutput, getTerminalOutput } from "@/lib/terminal-registry";
import { badRequest, notFound } from "@/lib/errors";
import { SSE_KEEPALIVE_MS } from "@/lib/constants";

export const dynamic = "force-dynamic";

function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return badRequest("id is required");

  const term = getTerminal(id);
  if (!term) return notFound("terminal not found");

  let cancelled = false;
  let unsub: (() => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let lastSentLength = 0;

  const stream = new ReadableStream({
    start(controller) {
      const output = getTerminalOutput(id);
      lastSentLength = output.length;
      controller.enqueue(sseMessage("connected", {
        output,
        running: term.running,
        exitCode: term.exitCode,
      }));

      unsub = onTerminalOutput(id, () => {
        if (cancelled) return;
        const current = getTerminalOutput(id);
        const newData = current.slice(lastSentLength);
        lastSentLength = current.length;

        const t = getTerminal(id);
        try {
          controller.enqueue(sseMessage("output", {
            data: newData,
            running: t?.running ?? false,
            exitCode: t?.exitCode ?? null,
          }));
        } catch {
          cleanup();
        }
      });

      keepaliveTimer = setInterval(() => {
        if (cancelled) return;
        try {
          controller.enqueue(sseMessage("ping", { ts: Date.now() }));
        } catch {
          cleanup();
        }
      }, SSE_KEEPALIVE_MS);
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    cancelled = true;
    if (unsub) { unsub(); unsub = null; }
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
