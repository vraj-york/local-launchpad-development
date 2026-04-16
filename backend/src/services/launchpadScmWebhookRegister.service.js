import { parseScmRepoPath } from "../utils/scmPath.js";
import { getApiPublicBaseUrl } from "../utils/apiPublicBaseUrl.js";
import { resolveScmCredentialsFromProject } from "./integrationCredential.service.js";
import { createOrUpdateLaunchpadGithubPushWebhook } from "./githubWebhooks.service.js";
import { createOrUpdateLaunchpadBitbucketPushWebhook } from "./bitbucket.service.js";

/**
 * After `gitRepoPath` is saved, register or refresh the provider push webhook (best-effort).
 * Does not throw; callers should not await for UX latency.
 * @param {import("@prisma/client").Project} project
 */
export async function ensureLaunchpadPushWebhooksForProject(project) {
  const pid = project?.id ?? "?";
  const publicBase = getApiPublicBaseUrl();
  if (!publicBase) {
    console.warn(
      `[launchpad webhook] project=${pid} skipped: no public base URL. Set VITE_FRONTEND_URL (typical from repo-root .env) or FRONTEND_URL to the public origin where /api is served, or NGROK_URL / run \`npm run dev:ngrok\`, or BASE_URL as last resort.`,
    );
    return;
  }

  const parsed = parseScmRepoPath(project?.gitRepoPath || "");
  if (!parsed) {
    return;
  }

  let creds;
  try {
    creds = await resolveScmCredentialsFromProject(project);
  } catch (e) {
    console.warn(
      `[launchpad webhook] project=${pid} skipped: SCM credentials unavailable (${e?.message || e}).`,
    );
    return;
  }
  if (creds.provider !== parsed.provider) {
    console.warn(
      `[launchpad webhook] project=${pid} skipped: token is ${creds.provider} but gitRepoPath is ${parsed.provider}.`,
    );
    return;
  }

  try {
    if (creds.provider === "github") {
      const result = await createOrUpdateLaunchpadGithubPushWebhook(
        parsed.owner,
        parsed.repo,
        creds.token,
      );
      if (result?.skipped) {
        console.warn(
          `[launchpad webhook] project=${pid} GitHub hook not created/updated: ${result.reason} (need GITHUB_PUSH_WEBHOOK_SECRET and a reachable callback URL).`,
        );
        return;
      }
      const act = result.created ? "created" : result.updated ? "updated" : "ok";
      console.info(
        `[launchpad webhook] project=${pid} GitHub ${parsed.owner}/${parsed.repo} hook ${act} id=${result.hookId ?? "?"} base=${publicBase}`,
      );
      return;
    }

    const result = await createOrUpdateLaunchpadBitbucketPushWebhook(
      parsed.owner,
      parsed.repo,
      creds.token,
    );
    if (result?.skipped) {
      console.warn(
        `[launchpad webhook] project=${pid} Bitbucket hook not created/updated: ${result.reason} (need BITBUCKET_PUSH_WEBHOOK_SECRET and a reachable callback URL).`,
      );
      return;
    }
    const act = result.created ? "created" : result.updated ? "updated" : "ok";
    console.info(
      `[launchpad webhook] project=${pid} Bitbucket ${parsed.owner}/${parsed.repo} hook ${act} base=${publicBase}`,
    );
  } catch (err) {
    console.warn(
      `[launchpad webhook] project=${pid} ensure failed for ${parsed.provider}: ${err?.message || err}`,
    );
  }
}
