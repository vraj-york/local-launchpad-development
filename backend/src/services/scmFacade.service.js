import {
  compareRefs,
  getBranchSha,
  getCommitInfo,
  getRepositoryMetadata,
  putRepositoryContents,
} from "./github.service.js";
import {
  compareBitbucketRefs,
  getBitbucketBranchTipSha,
  getBitbucketCommitInfo,
  getBitbucketRepositoryMetadata,
  putBitbucketRepositoryContents,
} from "./bitbucket.service.js";

/**
 * @param {'github'|'bitbucket'} provider
 */
export async function scmCompareRefs(provider, owner, repo, baseRef, headRef, token) {
  if (provider === "bitbucket") {
    return compareBitbucketRefs(owner, repo, baseRef, headRef, token);
  }
  return compareRefs(owner, repo, baseRef, headRef, token);
}

/** @param {'github'|'bitbucket'} provider */
export async function scmGetBranchSha(provider, owner, repo, branch, token) {
  if (provider === "bitbucket") {
    return getBitbucketBranchTipSha(owner, repo, branch, token);
  }
  return getBranchSha(owner, repo, branch, token);
}

/** @param {'github'|'bitbucket'} provider */
export async function scmGetRepositoryMetadata(provider, owner, repo, token) {
  if (provider === "bitbucket") {
    const m = await getBitbucketRepositoryMetadata(owner, repo, token);
    if (!m.ok) {
      return { ok: false, status: m.status, message: m.message };
    }
    return { ok: true, defaultBranch: m.defaultBranch };
  }
  return getRepositoryMetadata(owner, repo, token);
}

/** @param {'github'|'bitbucket'} provider */
export async function scmPutRepositoryContents(provider, owner, repo, filePath, opts) {
  if (provider === "bitbucket") {
    return putBitbucketRepositoryContents(owner, repo, filePath, opts);
  }
  return putRepositoryContents(owner, repo, filePath, opts);
}

/** @param {'github'|'bitbucket'} provider */
export async function scmGetCommitInfo(provider, owner, repo, ref, token) {
  if (provider === "bitbucket") {
    return getBitbucketCommitInfo(owner, repo, ref, token);
  }
  return getCommitInfo(owner, repo, ref, token);
}
