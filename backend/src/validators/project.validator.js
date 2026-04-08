import { body, param } from "express-validator";
import { normalizeOptionalEmailListString } from "../utils/emailList.utils.js";
import { repositoryPlatformFromUrl } from "../utils/scmPath.js";

function optionalEmailList(field) {
    return body(field)
        .optional({ nullable: true })
        .custom((value) => {
            if (value === undefined || value === null) return true;
            if (value === "") return true;
            try {
                normalizeOptionalEmailListString(value);
                return true;
            } catch (e) {
                throw new Error(e.message || "Invalid email list");
            }
        });
}

/**
 * Shared enums
 */
const ROADMAP_STATUS = ["DRAFT", "ACTIVE", "COMPLETED"];
const TSHIRT_SIZES = ["XS", "S", "M", "L", "XL"];
const ITEM_TYPES = ["FEATURE", "BUG", "TASK"];
const ITEM_STATUS = ["PLANNED", "IN_PROGRESS", "DONE"];
const ITEM_PRIORITY = ["LOW", "MEDIUM", "HIGH"];

/**
 * Reusable roadmap item validators
 */
const roadmapItemValidators = (base) => [
    body(`${base}.items`)
        .isArray({ min: 1 })
        .withMessage("At least one roadmap item is required"),

    body(`${base}.items.*.title`)
        .trim()
        .isLength({ min: 3 })
        .withMessage("Roadmap item title must be at least 3 characters"),

    body(`${base}.items.*.startDate`)
        .isISO8601()
        .withMessage("Roadmap item startDate must be a valid ISO date"),

    body(`${base}.items.*.endDate`)
        .isISO8601()
        .withMessage("Roadmap item endDate must be a valid ISO date"),

    body(`${base}.items.*.type`)
        .optional()
        .isIn(ITEM_TYPES),

    body(`${base}.items.*.status`)
        .optional()
        .isIn(ITEM_STATUS),

    body(`${base}.items.*.priority`)
        .optional()
        .isIn(ITEM_PRIORITY),
];

/**
 * Reusable roadmap validators
 */
const roadmapValidators = (base) => [
    body(`${base}.title`)
        .trim()
        .isLength({ min: 3, max: 100 })
        .withMessage("Roadmap title must be between 3 and 100 characters"),

    body(`${base}.timelineStart`)
        .isISO8601()
        .withMessage("timelineStart must be a valid ISO date"),

    body(`${base}.timelineEnd`)
        .isISO8601()
        .withMessage("timelineEnd must be a valid ISO date"),

    body(`${base}.status`)
        .optional()
        .isIn(ROADMAP_STATUS),

    body(`${base}.tshirtSize`)
        .optional()
        .isIn(TSHIRT_SIZES),

    ...roadmapItemValidators(base),
];


export const createProjectValidation = [
    body("name")
        .trim()
        .isLength({ min: 3, max: 100 })
        .withMessage("Name must be between 3 and 100 characters"),

    body("assignedManagerId")
        .isInt()
        .withMessage("Assigned manager ID must be an integer"),

    body("jiraUsername")
        .optional({ checkFalsy: true })
        .trim()
        .isEmail()
        .withMessage("Jira account email must be valid when provided"),

    body("jiraBaseUrl")
        .optional({ checkFalsy: true })
        .trim()
        .isURL()
        .withMessage("Jira Base URL must be a valid URL (e.g., https://company.atlassian.net)"),

    body("jiraProjectKey")
        .trim()
        .notEmpty()
        .withMessage("Jira Project Key is required (e.g., PROJ)"),

    body("jiraApiToken")
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ min: 1, max: 2048 })
        .withMessage("Jira API token is invalid"),

    body("githubUsername")
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ min: 1, max: 200 })
        .withMessage("GitHub username must be 1–200 characters when provided"),

    body("githubToken")
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ min: 1, max: 2048 })
        .withMessage("GitHub token must be 1–2048 characters when provided"),

    body("githubConnectionId")
        .optional({ nullable: true })
        .isInt()
        .withMessage("githubConnectionId must be an integer"),

    body("bitbucketConnectionId")
        .optional({ nullable: true })
        .isInt()
        .withMessage("bitbucketConnectionId must be an integer"),

    body("jiraConnectionId")
        .optional({ nullable: true })
        .isInt()
        .withMessage("jiraConnectionId must be an integer"),

    body("gitRepoPath")
        .optional({ checkFalsy: true })
        .trim()
        .matches(/^(https?:\/\/)?(github\.com|bitbucket\.org)\/[^/\s]+\/[^/\s]+(?:\.git)?$/i)
        .withMessage("gitRepoPath must be a valid GitHub or Bitbucket repository path"),

    body("developmentRepoUrl")
        .trim()
        .notEmpty()
        .withMessage("Developer repository path (developmentRepoUrl) is required")
        .matches(/^(https?:\/\/)?(github\.com|bitbucket\.org)\/[^/\s]+\/[^/\s]+(?:\.git)?$/i)
        .withMessage("developmentRepoUrl must be a valid GitHub or Bitbucket repository path"),

    body().custom((value, { req }) => {
        const b = req.body || {};
        const g = b.gitRepoPath != null && String(b.gitRepoPath).trim();
        const d = b.developmentRepoUrl != null && String(b.developmentRepoUrl).trim();
        if (!g || !d) return true;
        const pg = repositoryPlatformFromUrl(g);
        const pd = repositoryPlatformFromUrl(d);
        if (pg && pd && pg !== pd) {
            throw new Error(
                "Source repository  and development repository  must be on the same platform (GitHub or Bitbucket).",
            );
        }
        return true;
    }),

    optionalEmailList("assignedUserEmails"),
    optionalEmailList("stakeholderEmails"),

    body("isScratch").optional(),
    body("prompt").optional(),
    body().custom((value, { req }) => {
        const b = req.body || {};
        if (b.isScratch === undefined || b.isScratch === null || b.isScratch === "") {
            return true;
        }
        const scratch =
            b.isScratch === true ||
            b.isScratch === "true" ||
            String(b.isScratch).toLowerCase() === "true";
        const notScratch =
            b.isScratch === false ||
            b.isScratch === "false" ||
            String(b.isScratch).toLowerCase() === "false";
        if (!scratch && !notScratch) {
            throw new Error("isScratch must be a boolean");
        }
        if (scratch) {
            const p = typeof b.prompt === "string" ? b.prompt.trim() : "";
            if (!p) {
                throw new Error("prompt is required when isScratch is true");
            }
            if (p.length > 100000) {
                throw new Error("prompt must be at most 100000 characters");
            }
        }
        return true;
    }),

    body().custom((value, { req }) => {
        const b = req.body || {};
        const ghOAuth =
            b.githubConnectionId != null &&
            String(b.githubConnectionId).trim() !== "" &&
            !Number.isNaN(Number(b.githubConnectionId));
        const bbOAuth =
            b.bitbucketConnectionId != null &&
            String(b.bitbucketConnectionId).trim() !== "" &&
            !Number.isNaN(Number(b.bitbucketConnectionId));
        const ghLegacy =
            typeof b.githubUsername === "string" &&
            b.githubUsername.trim() &&
            typeof b.githubToken === "string" &&
            b.githubToken.trim();
        const bbLegacy =
            typeof b.bitbucketUsername === "string" &&
            b.bitbucketUsername.trim() &&
            typeof b.bitbucketToken === "string" &&
            b.bitbucketToken.trim();
        if (ghOAuth && bbOAuth) {
            throw new Error("Provide either githubConnectionId or bitbucketConnectionId, not both");
        }
        if (!ghOAuth && !ghLegacy && !bbOAuth && !bbLegacy) {
            throw new Error(
                "Connect GitHub or Bitbucket (OAuth), or provide legacy username/token for one host",
            );
        }
        const jiOAuth =
            b.jiraConnectionId != null &&
            String(b.jiraConnectionId).trim() !== "" &&
            !Number.isNaN(Number(b.jiraConnectionId));
        const jiLegacy =
            typeof b.jiraUsername === "string" &&
            b.jiraUsername.trim() &&
            typeof b.jiraApiToken === "string" &&
            b.jiraApiToken.trim() &&
            typeof b.jiraBaseUrl === "string" &&
            b.jiraBaseUrl.trim();
        if (!jiOAuth && !jiLegacy) {
            throw new Error(
                "Connect Jira (OAuth) or provide jiraConnectionId, or jiraBaseUrl with jiraUsername and jiraApiToken",
            );
        }
        return true;
    }),
];
/** Partial update: only send fields to change. Empty string clears optional text fields. */
export const updateProjectValidation = [
    param("projectId")
        .isInt()
        .withMessage("Invalid project id"),

    body("description")
        .optional()
        .custom((value) => {
            if (value === undefined) return true;
            if (value === null) return true;
            return typeof value === "string" && value.length <= 10000;
        })
        .withMessage("Description must be a string (max 10000 characters) or null"),

    body("jiraUsername")
        .optional({ checkFalsy: true })
        .trim()
        .isEmail()
        .withMessage("Jira username must be a valid email"),

    body("jiraBaseUrl")
        .optional({ checkFalsy: true })
        .trim()
        .isURL({ require_protocol: true })
        .withMessage("Jira base URL must be a valid URL (e.g. https://company.atlassian.net)"),

    body("jiraProjectKey")
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ min: 1, max: 32 })
        .withMessage("Jira project key must be 1–32 characters"),

    body("jiraApiToken")
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ min: 1, max: 2048 })
        .withMessage("Jira API token is invalid"),

    body("githubUsername")
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ min: 1, max: 200 })
        .withMessage("GitHub username must be 1–200 characters"),

    body("githubToken")
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ min: 1, max: 2048 })
        .withMessage("GitHub token must be 1–2048 characters"),

    body("githubConnectionId")
        .optional({ nullable: true })
        .isInt()
        .withMessage("githubConnectionId must be an integer"),

    body("jiraConnectionId")
        .optional({ nullable: true })
        .isInt()
        .withMessage("jiraConnectionId must be an integer"),

    body("bitbucketConnectionId")
        .optional({ nullable: true })
        .isInt()
        .withMessage("bitbucketConnectionId must be an integer"),

    body("gitRepoPath")
        .optional()
        .trim()
        .matches(/^(https?:\/\/)?(github\.com|bitbucket\.org)\/[^/\s]+\/[^/\s]+(?:\.git)?$/i)
        .withMessage("gitRepoPath must be a valid GitHub or Bitbucket repository path"),

    body("developmentRepoUrl")
        .optional({ nullable: true })
        .custom((value) => {
            if (value === undefined) return true;
            if (value === null || value === "") return true;
            const s = String(value).trim();
            return /^(https?:\/\/)?(github\.com|bitbucket\.org)\/[^/\s]+\/[^/\s]+(?:\.git)?$/i.test(
                s,
            );
        })
        .withMessage("developmentRepoUrl must be a valid GitHub or Bitbucket repository path"),

    body().custom((value, { req }) => {
        const b = req.body || {};
        if (b.gitRepoPath === undefined || b.developmentRepoUrl === undefined) return true;
        if (b.gitRepoPath === null || b.gitRepoPath === "") return true;
        if (b.developmentRepoUrl === null || b.developmentRepoUrl === "") return true;
        const g = String(b.gitRepoPath).trim();
        const d = String(b.developmentRepoUrl).trim();
        if (!g || !d) return true;
        const pg = repositoryPlatformFromUrl(g);
        const pd = repositoryPlatformFromUrl(d);
        if (pg && pd && pg !== pd) {
            throw new Error(
                "Source repository and development repository must be on the same platform (GitHub or Bitbucket).",
            );
        }
        return true;
    }),

    body("slug")
        .optional({ nullable: true })
        .custom((value) => {
            if (value === undefined) return true;
            if (value === null || value === "") return true;
            return typeof value === "string" && value.length <= 100;
        })
        .withMessage("slug must be a string (max 100) or null"),

    optionalEmailList("assignedUserEmails"),
    optionalEmailList("stakeholderEmails"),
];
export const updateRoadmapsArrayValidation = [
    param("projectId")
        .isInt()
        .withMessage("Invalid project id"),

    body("roadmaps")
        .isArray({ min: 1 })
        .withMessage("At least one roadmap is required"),

    ...roadmapValidators("roadmaps.*"),
];