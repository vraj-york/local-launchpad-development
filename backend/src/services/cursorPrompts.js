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
    "The checked-out branch is the repository default (or the ref the platform passed); do **not** assume it is named `main`.\n\n" +
    "There is **no** required folder name such as `frontend/` or `Frontend/`. Layouts vary (e.g. `apps/web`, `packages/client`, a single-package repo root, or other conventions). " +
    "Inspect the tree (README, package.json locations, existing source layout) and decide which directory is the **integration UI root** for this project.\n\n" +
    "Apply your changes only where they belong for that layout. The automated platform sync copies from the same tree the server detects after your push; " +
    "you do not need to rename folders for Launchpad—the platform merges into its own repo layout.\n\n" +
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
    "- When finished, commit your changes with a concise message describing the UI updates.\n" +
    "- The Launchpad pipeline copies your integration UI from this branch into the **platform** repository and pushes to the **launchpad** branch there (not the platform default branch); ensure your work is committed and pushed to the remote branch the agent used.\n"
  );
}
