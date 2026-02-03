import { body, param } from "express-validator";

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

    body("roadmaps")
        .isArray({ min: 1 })
        .withMessage("At least one roadmap is required"),

    ...roadmapValidators("roadmaps.*"),
];
export const updateProjectValidation = [
    param("projectId")
        .isInt()
        .withMessage("Invalid project id"),

    body("roadmap")
        .notEmpty()
        .withMessage("Roadmap is required"),

    ...roadmapValidators("roadmap"),
];