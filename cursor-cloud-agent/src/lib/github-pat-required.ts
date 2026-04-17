import { hasEffectiveGithubPat } from "@/lib/github-credentials-store";

/** Stable JSON body when POST launch/follow-up cannot run git without a PAT. */
export const GITHUB_PAT_NOT_CONFIGURED_CODE = "GITHUB_PAT_NOT_CONFIGURED" as const;

export async function requireGithubPatForEmailOrResponse(
  userEmailNormalized: string,
): Promise<Response | null> {
  if (await hasEffectiveGithubPat(userEmailNormalized)) return null;
  return Response.json(
    {
      error: "GitHub PAT not configured for this email; register via POST /api/v0/credentials/github?email=...",
      code: GITHUB_PAT_NOT_CONFIGURED_CODE,
    },
    { status: 400 },
  );
}
