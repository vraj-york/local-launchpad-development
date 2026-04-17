/**
 * Shared copy for agents working in the developer integration repo
 * (submodule launchpad-frontend/ vs integration tree Frontend/).
 */

export function buildLaunchpadFrontendAlignmentBlock() {
  return (
    "You are working in the developer integration repository, which includes the Launchpad platform UI as a git submodule at launchpad-frontend/.\n\n" +
    "Use launchpad-frontend/ as the reference for Launchpad patterns and behavior. Compare launchpad-frontend/ with Frontend/ in this repository (for example using git diff or an equivalent approach) and apply the necessary changes under the Frontend/ folder so it aligns with or correctly reflects patterns from the submodule.\n\n"
  );
}

/**
 * Intro for Migrate Frontend agent: repo layout varies (frontend vs Frontend vs client, etc.).
 */
export function buildMigrateFrontendAlignmentIntro() {
  return (
    "You are working in the customer development repository that integrates with Launchpad.\n\n" +
    "Repositories differ: the integration UI may live under `frontend/`, `Frontend/`, `client/`, `web/`, `app/`, or another conventional folder. " +
    "Inspect the tree (README, package.json paths, existing source layout) and decide which directory is the **integration UI root** for this project.\n\n" +
    "Git submodules in this repo are **not** checked out or copied by the automated Migrate Frontend step; only files under the resolved integration UI directory matter for that sync. " +
    "You may still read any checked-in reference material (including submodule paths if they exist as normal files in your branch) for patterns, but do not assume submodule trees are populated.\n\n"
  );
}

/**
 * Cursor Cloud agent prompt: discover integration UI directory, align with reference submodule if present; no backend plan file.
 */
export function buildMigrateFrontendPrompt() {
  return (
    buildMigrateFrontendAlignmentIntro() +
    "Task: Migrate and align the customer integration UI for Launchpad.\n\n" +
    "Constraints:\n" +
    "- Do all substantive work under the integration UI directory you identified. Do not copy or refactor unrelated backend/server packages unless a minimal change is strictly required for the UI to install or build.\n" +
    "- Do not rely on git submodule checkouts for the post-agent copy: the platform sync **merges** files from inside that integration UI directory into the existing platform tree (default: same folder as `MIGRATE_FRONTEND_PLATFORM_SUBDIR` or repo root; see server env `MIGRATE_FRONTEND_DEST_REL` / `MIGRATE_FRONTEND_MIRROR_SOURCE_FOLDER`). No other dev-repo folders are copied.\n" +
    "- Keep package manager, scripts, lint, and build configuration consistent with the repository.\n" +
    "- When finished, commit your changes with a concise message describing the UI updates.\n"
  );
}
