import validator from "validator";
import ApiError from "./apiError.js";
import { parseStoredEmailListToSet } from "./emailList.utils.js";

/** @typedef {'aiChat' | 'issueReporter' | 'releaseLock'} StakeholderGateContext */

/** Single copy used for every access denial in this module (empty list or email not allowed). */
const UNAUTHORIZED_PUBLIC_CLIENT_MESSAGE =
  "You are not authorized. Please contact your product manager to request access.";

const GATE_MESSAGES = {
  aiChat: {
    emailRequired:
      "Please enter your email to continue.",
    invalidEmail:
      "Please enter a valid email address.",
    unauthorized: UNAUTHORIZED_PUBLIC_CLIENT_MESSAGE,
  },
  issueReporter: {
    emailRequired:
      "Please enter your email to submit.",
    invalidEmail:
      "Please enter a valid email address.",
    unauthorized: UNAUTHORIZED_PUBLIC_CLIENT_MESSAGE,
  },
  releaseLock: {
    emailRequired:
      "Please enter your email to continue.",
    invalidEmail:
      "Please enter a valid email address.",
    unauthorized: UNAUTHORIZED_PUBLIC_CLIENT_MESSAGE,
  },
};

/**
 * Client-link gates: client email must be present and valid (400).
 * The project must have at least one stakeholder email, and the client email
 * must be in that list; otherwise 403 with {@link UNAUTHORIZED_PUBLIC_CLIENT_MESSAGE}.
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
    throw new ApiError(403, msgs.unauthorized);
  }
  if (!stakeholderSet.has(email)) {
    throw new ApiError(403, msgs.unauthorized);
  }
}
