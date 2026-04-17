import { getAgentFollowupContext } from "@/lib/agent-store";
import { CloudApiKeyCryptoError, fingerprintApiKey } from "@/lib/cloud-api-key-crypto";
import { getIncomingCloudApiKey } from "@/lib/cloud-auth";
import { followupAgentInBackground } from "@/lib/cloud-agent-launcher";
import { getRequiredNormalizedEmailFromUrl } from "@/lib/user-email";
import {
  enqueueFollowup,
  FollowupQueueFullError,
  getFollowupQueueDepth,
  withFollowupQueueLock,
} from "@/lib/followup-queue";
import { isCloudAgentRunning, markCloudAgentRunning } from "@/lib/cloud-agent-registry";
import type { CloudFollowupPostResponse, CloudFollowupRequest } from "@/lib/cloud-agents-types";
import { badRequest, parseJsonBody } from "@/lib/errors";
import { requireGithubPatForEmailOrResponse } from "@/lib/github-pat-required";
import { followupAgentSchema, parseBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id?.trim()) {
    return Response.json({ error: "Missing agent id" }, { status: 400 });
  }

  const raw = await parseJsonBody<CloudFollowupRequest>(req);
  if (raw instanceof Response) return raw;

  const parsed = parseBody(followupAgentSchema, raw);
  if ("error" in parsed) return badRequest(parsed.error);

  const authKey = getIncomingCloudApiKey(req.headers.get("authorization"));
  if (!authKey) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userEmailNormalized = getRequiredNormalizedEmailFromUrl(req);
  if (!userEmailNormalized) {
    return Response.json({ error: "Query parameter email is required" }, { status: 400 });
  }

  const patRequired = await requireGithubPatForEmailOrResponse(userEmailNormalized);
  if (patRequired) return patRequired;

  let apiKeyFingerprint: string;
  try {
    apiKeyFingerprint = fingerprintApiKey(authKey);
  } catch (e) {
    const msg = e instanceof CloudApiKeyCryptoError ? e.message : "Server configuration error";
    return Response.json({ error: msg }, { status: 500 });
  }

  const ctx = await getAgentFollowupContext(id, apiKeyFingerprint, userEmailNormalized);
  if (!ctx) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = await withFollowupQueueLock(id, async (): Promise<CloudFollowupPostResponse> => {
      const hasSession = Boolean(ctx.cursorSessionId?.trim());
      const busy =
        isCloudAgentRunning(id) || (await getFollowupQueueDepth(id)) > 0;
      // No session yet: cannot run inline — queue until the initial launch finishes and drain runs.
      // Busy (running or queue non-empty): queue for FIFO processing after the current work completes.
      if (!hasSession || busy) {
        const { queuePosition } = await enqueueFollowup(
          id,
          apiKeyFingerprint,
          userEmailNormalized,
          parsed.data.prompt,
        );
        return { id, queued: true, queuePosition };
      }
      markCloudAgentRunning(id);
      void followupAgentInBackground({
        id,
        apiKeyFingerprint,
        userEmailNormalized,
        prompt: parsed.data.prompt,
      });
      return { id, queued: false };
    });
    return Response.json(body);
  } catch (e) {
    if (e instanceof FollowupQueueFullError) {
      return Response.json({ error: e.message }, { status: 429 });
    }
    throw e;
  }
}
