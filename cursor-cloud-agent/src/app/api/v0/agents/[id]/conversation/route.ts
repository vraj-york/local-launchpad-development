import { getAgentConversationForApiKey } from "@/lib/agent-store";
import { CloudApiKeyCryptoError, fingerprintApiKey } from "@/lib/cloud-api-key-crypto";
import { getIncomingCloudApiKey } from "@/lib/cloud-auth";
import { getRequiredNormalizedEmailFromUrl } from "@/lib/user-email";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, context: RouteContext) {
  const { id } = await context.params;
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

  const messages = await getAgentConversationForApiKey(id, apiKeyFingerprint, userEmailNormalized);
  if (messages === null) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ id, messages });
}
