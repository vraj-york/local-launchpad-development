import { writeToTerminal } from "@/lib/terminal-registry";
import { badRequest, parseJsonBody } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await parseJsonBody<{ id?: string; data?: string }>(req);
  if (body instanceof Response) return body;

  if (!body.id) return badRequest("id is required");
  if (body.data === undefined) return badRequest("data is required");

  const ok = writeToTerminal(body.id, body.data);
  if (!ok) return badRequest("terminal not found or not running");
  return Response.json({ ok: true });
}
