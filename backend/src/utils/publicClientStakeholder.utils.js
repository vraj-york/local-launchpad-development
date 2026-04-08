import validator from "validator";
import ApiError from "./apiError.js";
import { parseStoredEmailListToSet } from "./emailList.utils.js";

/** @typedef {'aiChat' | 'issueReporter' | 'releaseLock'} StakeholderGateContext */

const GATE_MESSAGES = {
  aiChat: {
    emailRequired:
      "Please enter your email to continue.",
    invalidEmail:
      "Please enter a valid email address.",
    unauthorized:
      "You are not authorized. Please contact your product manager to request access.",
  },
  issueReporter: {
    emailRequired:
      "Please enter your email to submit.",
    invalidEmail:
      "Please enter a valid email address.",
    unauthorized:
      "You are not authorized. Please contact your product manager to request access.",
  },
  releaseLock: {
    emailRequired:
      "Please enter your email to continue.",
    invalidEmail:
      "Please enter a valid email address.",
    unauthorized:
      "You are not authorized. Please contact your product manager to request access.",
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
