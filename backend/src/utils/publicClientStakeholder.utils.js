import validator from "validator";
import ApiError from "./apiError.js";
import { parseStoredEmailListToSet } from "./emailList.utils.js";

/** @typedef {'aiChat' | 'issueReporter' | 'releaseLock'} StakeholderGateContext */

const GATE_MESSAGES = {
  aiChat: {
    emailRequired:
      "Enter your email address to use AI chat.",
    invalidEmail:
      "That email address is not valid. Correct it to continue with AI chat.",
    noStakeholdersOnProject:
      "AI chat is not available: no stakeholder emails are set up for this project yet. Ask the product manager to add stakeholder emails in project settings.",
    emailNotOnStakeholderList:
      "Your email is not listed under this project's stakeholder emails. Ask the product manager to add your address to stakeholder emails in project settings, then try AI chat again.",
  },
  issueReporter: {
    emailRequired:
      "Enter your email address on the issue form to submit.",
    invalidEmail:
      "That email address is not valid. Fix it in the issue form and try again.",
    noStakeholdersOnProject:
      "Issue reporting is not available: no stakeholder emails are set up for this project yet. Ask the product manager to add stakeholder emails in project settings.",
    emailNotOnStakeholderList:
      "Your email is not listed under this project's stakeholder emails. Ask the product manager to add your address to stakeholder emails in project settings, then submit the issue again.",
  },
  releaseLock: {
    emailRequired:
      "Enter your email address to lock this release.",
    invalidEmail:
      "That email address is not valid. Enter a valid email to lock this release.",
    noStakeholdersOnProject:
      "Release lock is not available: no stakeholder emails are set up for this project yet. Ask the product manager to add stakeholder emails in project settings.",
    emailNotOnStakeholderList:
      "Your email is not listed under this project's stakeholder emails. Ask the product manager to add your address to stakeholder emails in project settings before locking a release.",
  },
};

/** HTTP status when the project has no stakeholder emails configured */
const EMPTY_STAKEHOLDER_STATUS = {
  aiChat: 400,
  issueReporter: 400,
  releaseLock: 403,
};

/**
 * Same rules for client-link surfaces: stakeholders must be configured; client
 * email must be present, valid, and in the list. Messages identify the feature
 * and what is missing.
 *
 * @param {string|null|undefined} stakeholderCsv
 * @param {unknown} clientEmailRaw
 * @param {{
 *   context?: StakeholderGateContext;
 *   messageOverrides?: Partial<typeof GATE_MESSAGES.aiChat>;
 * }} [options]
 */
export function assertPublicClientStakeholderEmail(
  stakeholderCsv,
  clientEmailRaw,
  options = {},
) {
  const context = options.context ?? "aiChat";
  const template = GATE_MESSAGES[context] ?? GATE_MESSAGES.aiChat;
  const msgs = { ...template, ...options.messageOverrides };

  const email =
    typeof clientEmailRaw === "string"
      ? clientEmailRaw.trim().toLowerCase()
      : "";
  if (!email) {
    throw new ApiError(400, msgs.emailRequired);
  }
  if (!validator.isEmail(email)) {
    throw new ApiError(400, msgs.invalidEmail);
  }

  const stakeholderSet = parseStoredEmailListToSet(stakeholderCsv);
  if (stakeholderSet.size === 0) {
    const status = EMPTY_STAKEHOLDER_STATUS[context] ?? 400;
    throw new ApiError(status, msgs.noStakeholdersOnProject);
  }
  if (!stakeholderSet.has(email)) {
    throw new ApiError(403, msgs.emailNotOnStakeholderList);
  }
}
