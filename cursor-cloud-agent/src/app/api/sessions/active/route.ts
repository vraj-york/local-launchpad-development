import { getActiveSessionIds, killProcess } from "@/lib/process-registry";
import { deleteSessionSchema, parseBody } from "@/lib/validation";
import { badRequest, parseJsonBody } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ sessions: getActiveSessionIds() });
}

export async function DELETE(req: Request) {
  const raw = await parseJsonBody<{ sessionId?: string }>(req);
  if (raw instanceof Response) return raw;

  const parsed = parseBody(deleteSessionSchema, raw);
  if ("error" in parsed) return badRequest(parsed.error);

  const killed = killProcess(parsed.data.sessionId);
  return Response.json({ killed });
}
