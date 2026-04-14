import { scmGetBranchSha } from "../services/scmFacade.service.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cursor often reports FINISHED before remote refs show the new push. */
export const AGENT_BRANCH_TIP_INITIAL_DELAY_MS = 5500;
export const AGENT_BRANCH_TIP_POLL_MS = 2500;
export const AGENT_BRANCH_TIP_MAX_POLLS = 22;
/** After we see the tip move, keep polling this many times and use the last SHA (trailing pushes). */
export const AGENT_BRANCH_TIP_POST_MOVE_POLLS = 8;

/**
 * Wait, then poll until the branch tip SHA changes from the first read (or exhaust attempts).
 * When the tip moves, poll {@link AGENT_BRANCH_TIP_POST_MOVE_POLLS} more times and return the
 * **last** read so we do not persist an intermediate commit (common when the agent pushes twice,
 * or when it pauses on a first push before the final one). Two identical reads was not enough
 * because the tip can stay on an intermediate SHA for several polls before advancing.
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
      let lastPeek = latest;
      for (let j = 0; j < AGENT_BRANCH_TIP_POST_MOVE_POLLS; j++) {
        await delay(AGENT_BRANCH_TIP_POLL_MS);
        const peek =
          (await scmGetBranchSha(provider, owner, repo, branch, token))?.sha ?? null;
        if (peek) lastPeek = peek;
      }
      return lastPeek;
    }
  }
  return latest;
}

/**
 * Poll until the branch tip is no longer `staleSha` (case-insensitive), or attempts exhausted.
 * Used when the resolved tip still matches the previous chat turn’s applied commit — the remote
 * has not yet advertised the new work for this turn.
 *
 * @param {{ provider: 'github'|'bitbucket', owner: string, repo: string, branch: string, token: string }} p
 * @param {string} staleSha
 * @param {{ maxAttempts?: number }} [opts]
 * @returns {Promise<string|null>} Last observed tip when it advanced, else last read (may still equal stale)
 */
export async function pollBranchTipUntilAdvancesBeyond(p, staleSha, opts = {}) {
  const branch = String(p?.branch || "").trim();
  if (!branch) return null;
  const stale = typeof staleSha === "string" ? staleSha.trim().toLowerCase() : "";
  if (!stale) return null;

  const { provider, owner, repo, token } = p;
  const maxAttempts = Number.isInteger(opts.maxAttempts) && opts.maxAttempts > 0 ? opts.maxAttempts : 36;

  let last = null;
  for (let i = 0; i < maxAttempts; i++) {
    await delay(AGENT_BRANCH_TIP_POLL_MS);
    const peek = (await scmGetBranchSha(provider, owner, repo, branch, token))?.sha ?? null;
    if (!peek) continue;
    last = peek;
    if (peek.toLowerCase() !== stale) {
      return peek;
    }
  }
  return last;
}

/**
 * Poll a few more times and return the last tip (catch commits that land right after we matched).
 */
export async function pollBranchTipTail(p, polls) {
  const branch = String(p?.branch || "").trim();
  if (!branch) return null;
  const n = Number.isInteger(polls) && polls > 0 ? polls : 0;
  if (!n) return null;

  const { provider, owner, repo, token } = p;
  let last = null;
  for (let i = 0; i < n; i++) {
    await delay(AGENT_BRANCH_TIP_POLL_MS);
    const peek = (await scmGetBranchSha(provider, owner, repo, branch, token))?.sha ?? null;
    if (peek) last = peek;
  }
  return last;
}
