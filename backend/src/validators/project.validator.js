import ApiError from "../utils/apiError.js";
import { body } from "express-validator";




export const createProjectValidation = [
    body("name")
        .trim()
        .isLength({ min: 3, max: 100 })
        .withMessage("Name must be between 3 and 100 characters"),

    body("assignedManagerId")
        .isInt()
        .withMessage("Assigned manager ID must be an integer"),

    body("roadmaps")
        .isArray({ min: 1 }).withMessage("At least one roadmap is required"),

    body("roadmaps.*.title")
        .trim()
        .isLength({ min: 3, max: 100 }).withMessage("Roadmap title must be between 3 and 100 characters"),

    body("roadmaps.*.timelineStart")
        .isISO8601().withMessage("Roadmap timelineStart must be a valid date"),

    body("roadmaps.*.timelineEnd")
        .isISO8601().withMessage("Roadmap timelineEnd must be a valid date"),

    body("roadmaps.*.status")
        .optional()
        .isIn(["DRAFT", "ACTIVE", "COMPLETED"]),

    body("roadmaps.*.tshirtSize")
        .optional()
        .isIn(["XS", "S", "M", "L", "XL"]),

    body("roadmaps.*.items")
        .isArray({ min: 1 }).withMessage("At least one roadmap item is required"),

    body("roadmaps.*.items.*.title")
        .trim()
        .isLength({ min: 3 }).withMessage("Roadmap item title must be at least 3 characters"),

    body("roadmaps.*.items.*.startDate")
        .isISO8601().withMessage("Roadmap item startDate must be a valid date"),

    body("roadmaps.*.items.*.endDate")
        .isISO8601().withMessage("Roadmap item endDate must be a valid date"),

    body("roadmaps.*.items.*.type")
        .optional()
        .isIn(["FEATURE", "BUG", "TASK"]),

    body("roadmaps.*.items.*.status")
        .optional()
        .isIn(["PLANNED", "IN_PROGRESS", "DONE"]),

    body("roadmaps.*.items.*.priority")
        .optional()
        .isIn(["LOW", "MEDIUM", "HIGH"])
];

