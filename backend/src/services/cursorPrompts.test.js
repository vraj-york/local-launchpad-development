import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLaunchpadFrontendAlignmentBlock,
  buildMigrateFrontendPrompt,
} from "./cursorPrompts.js";

test("buildLaunchpadFrontendAlignmentBlock mentions submodule and Frontend", () => {
  const b = buildLaunchpadFrontendAlignmentBlock();
  assert.match(b, /launchpad-frontend\//);
  assert.match(b, /Frontend\//);
});

test("buildMigrateFrontendPrompt describes flexible UI root and constraints", () => {
  const p = buildMigrateFrontendPrompt();
  assert.match(p, /integration UI/i);
  assert.match(p, /integration UI root/i);
  assert.match(p, /Do all substantive work under the integration UI directory you identified/i);
});
