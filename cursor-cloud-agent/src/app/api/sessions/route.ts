import { listSessions, deleteSession, archiveSession, unarchiveSession, archiveAllSessions, getArchivedSessionIds } from "@/lib/session-store";
import { readCursorSessions } from "@/lib/transcript-reader";
import { getWorkspace } from "@/lib/workspace";
import { deleteSessionSchema, parseBody } from "@/lib/validation";
import { badRequest, parseJsonBody, serverError } from "@/lib/errors";
import { vlog } from "@/lib/verbose";
import type { StoredSession } from "@/lib/types";

export const dynamic = "force-dynamic";

function mergeSessions(ours: StoredSession[], cursor: StoredSession[]): StoredSession[] {
  const byId = new Map<string, StoredSession>();

  for (const s of cursor) {
    byId.set(s.id, s);
  }
  for (const s of ours) {
    const existing = byId.get(s.id);
    if (existing) {
      byId.set(s.id, {
        ...existing,
        updatedAt: Math.max(existing.updatedAt, s.updatedAt),
      });
    } else {
      byId.set(s.id, s);
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function GET(req: Request) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "true";
  const workspaceParam = url.searchParams.get("workspace");
  const archived = url.searchParams.get("archived") === "true";
  const workspace = workspaceParam || getWorkspace();

  vlog("sessions", "GET", { all, archived, workspace });

  if (all) {
    const ours = await listSessions(undefined, archived);
    vlog("sessions", "all mode", { count: ours.length, ms: Date.now() - t0 });
    return Response.json({ sessions: ours, workspace });
  }

  const cursorSessions = await readCursorSessions(workspace);
  const ourSessions = await listSessions(workspace, archived);
  vlog("sessions", "fetched", { cursorSessions: cursorSessions.length, ourSessions: ourSessions.length });

  if (archived) {
    const archivedIds = await getArchivedSessionIds();
    const archivedCursorSessions = cursorSessions.filter((s) => archivedIds.has(s.id));
    const merged = mergeSessions(ourSessions, archivedCursorSessions);
    vlog("sessions", "archived result", { merged: merged.length, ms: Date.now() - t0 });
    return Response.json({ sessions: merged, workspace });
  }

  const archivedIds = await getArchivedSessionIds();
  const activeCursorSessions = cursorSessions.filter((s) => !archivedIds.has(s.id));
  const merged = mergeSessions(ourSessions, activeCursorSessions);
  vlog("sessions", "result", { merged: merged.length, archivedIds: archivedIds.size, ms: Date.now() - t0 });

  return Response.json({ sessions: merged, workspace });
}

export async function DELETE(req: Request) {
  const raw = await parseJsonBody<{ sessionId?: string }>(req);
  if (raw instanceof Response) return raw;

  const parsed = parseBody(deleteSessionSchema, raw);
  if ("error" in parsed) return badRequest(parsed.error);

  await deleteSession(parsed.data.sessionId);
  return Response.json({ ok: true });
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { action: string; sessionId?: string; workspace?: string };
    const { action, sessionId, workspace } = body;

    switch (action) {
      case "archive": {
        if (!sessionId) return badRequest("sessionId required");
        const ws = workspace || getWorkspace();
        const cursorSessions = ws ? await readCursorSessions(ws) : [];
        const cursorSession = cursorSessions.find((s) => s.id === sessionId);
        await archiveSession(sessionId, cursorSession);
        break;
      }
      case "unarchive": {
        if (!sessionId) return badRequest("sessionId required");
        await unarchiveSession(sessionId);
        break;
      }
      case "archive_all": {
        const ws = workspace || getWorkspace();
        const cursorSessions = ws ? await readCursorSessions(ws) : [];
        await archiveAllSessions(workspace, cursorSessions);
        break;
      }
      default:
        return badRequest("Invalid action");
    }

    return Response.json({ ok: true });
  } catch {
    return serverError("Failed to update session");
  }
}
