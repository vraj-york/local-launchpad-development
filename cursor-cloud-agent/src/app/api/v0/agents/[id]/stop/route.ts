import { getAgentFollowupContext, getCloudAgentById } from "@/lib/agent-store";
import { killRegisteredCloudAgentChild } from "@/lib/cloud-agent-child-registry";
import { finalizeAgentStoppedByApi } from "@/lib/cloud-agent-launcher";
import { isCloudAgentRunning } from "@/lib/cloud-agent-registry";
import {
  clearCloudAgentStopRequest,
  isCloudAgentStopRequested,
  requestCloudAgentStop,
} from "@/lib/cloud-agent-stop-request";
import { CloudApiKeyCryptoError, fingerprintApiKey } from "@/lib/cloud-api-key-crypto";
import { getIncomingCloudApiKey } from "@/lib/cloud-auth";
import { getRequiredNormalizedEmailFromUrl } from "@/lib/user-email";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /v0/agents/{id}/stop?email=
 * Pauses the agent (SIGTERM on CLI child); agent row remains. Response: `{ "id" }`.
 */
export async function POST(req: Request, context: RouteContext) {
  const { id: rawId } = await context.params;
  const id = rawId?.trim() ?? "";
  if (!id) {
    return Response.json({ error: "Missing agent id" }, { status: 400 });
  }

  const authKey = getIncomingCloudApiKey(req.headers.get("authorization"));
  if (!authKey) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userEmailNormalized = getRequiredNormalizedEmailFromUrl(req);
  if (!userEmailNormalized) {
    return Response.json({ error: "Query parameter email is required" }, { status: 400 });
  }

  let apiKeyFingerprint: string;
  try {
    apiKeyFingerprint = fingerprintApiKey(authKey);
  } catch (e) {
    const msg = e instanceof CloudApiKeyCryptoError ? e.message : "Server configuration error";
    return Response.json({ error: msg }, { status: 500 });
  }

  const origin = new URL(req.url).origin;
  const agent = await getCloudAgentById(id, origin, apiKeyFingerprint, userEmailNormalized);
  if (!agent) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  requestCloudAgentStop(id);
  const wasBusy = isCloudAgentRunning(id);
  const killed = killRegisteredCloudAgentChild(id);

  if (!killed && !wasBusy && isCloudAgentStopRequested(id)) {
    const st = String(agent.status || "").toUpperCase();
    if (st === "RUNNING" || st === "CREATING") {
      const ctx = await getAgentFollowupContext(id, apiKeyFingerprint, userEmailNormalized);
      await finalizeAgentStoppedByApi(id, ctx?.webhookUrl, ctx?.webhookSecret);
    } else {
      clearCloudAgentStopRequest(id);
    }
  }

  return Response.json({ id });
}
