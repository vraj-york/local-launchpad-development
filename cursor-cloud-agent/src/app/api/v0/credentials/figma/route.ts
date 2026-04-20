import { CloudApiKeyCryptoError } from "@/lib/cloud-api-key-crypto";
import { getIncomingCloudApiKey } from "@/lib/cloud-auth";
import { hasFigmaAccessToken, upsertFigmaAccessToken } from "@/lib/figma-credentials-store";
import { badRequest, parseJsonBody } from "@/lib/errors";
import { getRequiredNormalizedEmailFromUrl } from "@/lib/user-email";
import { z } from "zod";

export const dynamic = "force-dynamic";

const postBodySchema = z.object({
  figmaAccessToken: z.string().min(1, "figmaAccessToken is required"),
});

export async function GET(req: Request) {
  const authKey = getIncomingCloudApiKey(req.headers.get("authorization"));
  if (!authKey) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const email = getRequiredNormalizedEmailFromUrl(req);
  if (!email) return Response.json({ error: "Query parameter email is required" }, { status: 400 });

  try {
    const configured = await hasFigmaAccessToken(email);
    return Response.json({ configured });
  } catch (e) {
    const msg = e instanceof CloudApiKeyCryptoError ? e.message : "Server configuration error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

async function putOrPostFigmaCredentials(req: Request): Promise<Response> {
  const authKey = getIncomingCloudApiKey(req.headers.get("authorization"));
  if (!authKey) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const email = getRequiredNormalizedEmailFromUrl(req);
  if (!email) return Response.json({ error: "Query parameter email is required" }, { status: 400 });

  const raw = await parseJsonBody<unknown>(req);
  if (raw instanceof Response) return raw;

  const parsed = postBodySchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return badRequest(first?.message ?? "Validation failed");
  }

  try {
    await upsertFigmaAccessToken(email, parsed.data.figmaAccessToken);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof CloudApiKeyCryptoError ? e.message : e instanceof Error ? e.message : "Server error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return putOrPostFigmaCredentials(req);
}

export async function PUT(req: Request) {
  return putOrPostFigmaCredentials(req);
}
