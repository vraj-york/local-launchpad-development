import { scmGetBranchSha } from "../services/scmFacade.service.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cursor often reports FINISHED before remote refs show the new push. */
export const AGENT_BRANCH_TIP_INITIAL_DELAY_MS = 5500;
export const AGENT_BRANCH_TIP_POLL_MS = 2500;
export const AGENT_BRANCH_TIP_MAX_POLLS = 22;

/**
 * Wait, then poll until the branch tip SHA changes from the first read (or exhaust attempts).
 * Matches client-link behavior so merge/deploy sees the same tip as the agent.
 *
 * @param {{ provider: 'github'|'bitbucket', owner: string, repo: string, branch: string, token: string }} p
 * @returns {Promise<string|null>}
 */
export async function waitForAgentBranchTipSha(p) {
  const branch = String(p?.branch || "").trim();
  if (!branch) return null;

  const { provider, owner, repo, token } = p;

  await delay(AGENT_BRANCH_TIP_INITIAL_DELAY_MS);
  let baseline = (await scmGetBranchSha(provider, owner, repo, branch, token))?.sha ?? null;
  let latest = baseline;

  for (let i = 0; i < AGENT_BRANCH_TIP_MAX_POLLS; i++) {
    await delay(AGENT_BRANCH_TIP_POLL_MS);
    const next = (await scmGetBranchSha(provider, owner, repo, branch, token))?.sha ?? null;
    if (next) latest = next;
    if (baseline != null && latest != null && latest !== baseline) {
      await delay(AGENT_BRANCH_TIP_POLL_MS);
      const confirmed =
        (await scmGetBranchSha(provider, owner, repo, branch, token))?.sha ?? latest;
      return confirmed;
    }
  }
  return latest;
}
