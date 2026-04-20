import { randomUUID } from "crypto";
import {
  applyLaunchDefaults,
  createAgentLaunch,
  listAgents,
} from "@/lib/agent-store";
import { CloudApiKeyCryptoError, encryptApiKey, fingerprintApiKey } from "@/lib/cloud-api-key-crypto";
import { getIncomingCloudApiKey } from "@/lib/cloud-auth";
import { cloudAgentRepoWorkspace, launchAgentInBackground } from "@/lib/cloud-agent-launcher";
import {
  cloudAgentApiResponse,
  type CloudAgentListItem,
  type CloudLaunchRequest,
} from "@/lib/cloud-agents-types";
import { badRequest, parseJsonBody } from "@/lib/errors";
import { getRequiredNormalizedEmailFromUrl } from "@/lib/user-email";
import { requireGithubPatForEmailOrResponse } from "@/lib/github-pat-required";
import { launchAgentSchema, parseBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

// Used when pre-flight `prepareCloudAgentWorkspace` is enabled (clone/fetch before CREATING).
// function workspacePrepErrorMessage(err: unknown): string {
//   if (err instanceof Error) {
//     const e = err as Error & { stderr?: Buffer | string };
//     const stderr =
//       typeof e.stderr === "string"
//         ? e.stderr.trim()
//         : Buffer.isBuffer(e.stderr)
//           ? e.stderr.toString("utf-8").trim()
//           : "";
//     if (stderr) return stderr.slice(0, 4000);
//     return e.message || "Workspace preparation failed";
//   }
//   return String(err);
// }

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || "agent";
}

function parseRepoFromPrUrl(prUrl?: string): string | undefined {
  if (!prUrl) return undefined;
  try {
    const u = new URL(prUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 4 || parts[2] !== "pull") return undefined;
    return `https://github.com/${parts[0]}/${parts[1]}.git`;
  } catch {
    return undefined;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  let limit: number | undefined;
  if (limitParam !== null) {
    const n = parseInt(limitParam, 10);
    if (!Number.isFinite(n)) {
      return Response.json({ error: "Invalid limit" }, { status: 400 });
    }
    limit = n;
  }

  const cursor = url.searchParams.get("cursor");
  const prUrl = url.searchParams.get("prUrl");

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
  const result = await listAgents(
    {
      limit,
      cursor: cursor || undefined,
      prUrl: prUrl || undefined,
      apiKeyFingerprint,
      userEmailNormalized,
    },
    origin,
  );

  if (result.nextCursor !== undefined) {
    return Response.json({ agents: result.agents, nextCursor: result.nextCursor });
  }
  return Response.json({ agents: result.agents });
}

export async function POST(req: Request) {
  const raw = await parseJsonBody<CloudLaunchRequest>(req);
  if (raw instanceof Response) return raw;

  const parsed = parseBody(launchAgentSchema, raw);
  if ("error" in parsed) return badRequest(parsed.error);
  const body = parsed.data;

  const defaults = applyLaunchDefaults(body);
  const agentId = `bc_${randomUUID()}`;
  const nowIso = new Date().toISOString();
  const origin = new URL(req.url).origin;
  const promptText = body.prompt.text.trim();
  const name = promptText.slice(0, 120) || "Cloud agent task";
  const branchName = defaults.target.branchName || `cursor/${slugify(name)}-${agentId.slice(-6)}`;
  const sourceRepository = body.source.repository || parseRepoFromPrUrl(body.source.prUrl);
  const sourceRef = defaults.sourceRef;
  const sourcePrUrl = body.source.prUrl?.trim() || undefined;
  const repoWorkspace = cloudAgentRepoWorkspace(agentId);
  const authKey = getIncomingCloudApiKey(req.headers.get("authorization"));
  if (!authKey) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userEmailNormalized = getRequiredNormalizedEmailFromUrl(req);
  if (!userEmailNormalized) {
    return Response.json({ error: "Query parameter email is required" }, { status: 400 });
  }

  const patRequired = await requireGithubPatForEmailOrResponse(userEmailNormalized);
  if (patRequired) return patRequired;

  let apiKeyEncrypted: string;
  let apiKeyFingerprint: string;
  try {
    apiKeyEncrypted = encryptApiKey(authKey);
    apiKeyFingerprint = fingerprintApiKey(authKey);
  } catch (e) {
    const msg = e instanceof CloudApiKeyCryptoError ? e.message : "Server configuration error";
    return Response.json({ error: msg }, { status: 500 });
  }

  // Pre-flight: clone/fetch repo to ensure it is accessible before returning CREATING.
  // Commented out — workspace is prepared inside `launchAgentInBackground` instead.
  // try {
  //   await prepareCloudAgentWorkspace(
  //     {
  //       id: agentId,
  //       request: body,
  //       workspace: repoWorkspace,
  //       branchName,
  //       sourceRef,
  //       model: defaults.model,
  //     },
  //     authKey,
  //   );
  // } catch (e) {
  //   const msg = workspacePrepErrorMessage(e);
  //   return Response.json({ error: msg }, { status: 400 });
  // }

  await createAgentLaunch({
    id: agentId,
    workspace: repoWorkspace,
    name,
    model: defaults.model,
    sourceRepository: sourceRepository || null,
    sourceRef,
    sourcePrUrl: sourcePrUrl || null,
    targetBranchName: branchName,
    autoCreatePr: defaults.target.autoCreatePr,
    openAsCursorGithubApp: defaults.target.openAsCursorGithubApp,
    skipReviewerRequest: defaults.target.skipReviewerRequest,
    autoBranch: defaults.target.autoBranch,
    webhookUrl: body.webhook?.url || null,
    webhookSecret: body.webhook?.secret || null,
    apiKeyEncrypted,
    apiKeyFingerprint,
    userEmail: userEmailNormalized,
  });

  void launchAgentInBackground({
    id: agentId,
    request: body,
    workspace: repoWorkspace,
    branchName,
    sourceRef,
    model: defaults.model,
  });

  const response: CloudAgentListItem = {
    id: agentId,
    name,
    status: "CREATING",
    source: {
      repository: sourceRepository || repoWorkspace,
      ref: sourceRef || "(repo-default)",
      ...(sourcePrUrl ? { prUrl: sourcePrUrl } : {}),
    },
    target: {
      branchName,
      url: `${origin}/#session=${encodeURIComponent(agentId)}`,
      autoCreatePr: defaults.target.autoCreatePr,
      openAsCursorGithubApp: defaults.target.openAsCursorGithubApp,
      skipReviewerRequest: defaults.target.skipReviewerRequest,
      autoBranch: defaults.target.autoBranch,
    },
    createdAt: nowIso,
  };

  return Response.json(cloudAgentApiResponse(response));
}
