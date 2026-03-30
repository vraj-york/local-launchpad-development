import { body, param } from "express-validator";

const RELEASE_STATUSES = ["draft", "active", "locked", "skip"];

export const createReleaseValidation = [
  body("projectId")
    .isInt({ min: 1 })
    .withMessage("projectId must be a positive integer"),
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Release name is required")
    .isLength({ max: 500 })
    .withMessage("Release name is too long"),
  body("description")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === undefined || value === null) return true;
      return typeof value === "string";
    })
    .withMessage("description must be a string"),
  body("roadmapItemId")
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage("roadmapItemId must be a positive integer"),
  body("isMvp")
    .optional()
    .isBoolean()
    .withMessage("isMvp must be a boolean"),
  body("releaseDate")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === undefined || value === null || value === "") return true;
      const t = Date.parse(value);
      return !Number.isNaN(t);
    })
    .withMessage("releaseDate must be a valid date"),
  body("startDate")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === undefined || value === null || value === "") return true;
      const t = Date.parse(value);
      return !Number.isNaN(t);
    })
    .withMessage("startDate must be a valid date"),
  body("clientReleaseNote")
    .optional({ nullable: true })
    .isString()
    .withMessage("clientReleaseNote must be a string"),
];

export const updateReleaseValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("Invalid release id"),
  body("name")
    .optional()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Release name must be between 1 and 500 characters"),
  body("description")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === undefined || value === null) return true;
      return typeof value === "string";
    })
    .withMessage("description must be a string"),
  body("isMvp")
    .optional()
    .isBoolean()
    .withMessage("isMvp must be a boolean"),
  body("releaseDate")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === undefined || value === null || value === "") return true;
      const t = Date.parse(value);
      return !Number.isNaN(t);
    })
    .withMessage("releaseDate must be a valid date"),
  body("startDate")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === undefined || value === null || value === "") return true;
      const t = Date.parse(value);
      return !Number.isNaN(t);
    })
    .withMessage("startDate must be a valid date"),
  body("reason")
    .optional({ nullable: true })
    .isString()
    .withMessage("reason must be a string"),
  body("clientReleaseNote")
    .optional({ nullable: true })
    .isString()
    .withMessage("clientReleaseNote must be a string"),
];

export const setReleaseStatusValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("Invalid release id"),
  body("status")
    .exists({ checkFalsy: false })
    .withMessage("status is required")
    .isIn(RELEASE_STATUSES)
    .withMessage(`status must be one of: ${RELEASE_STATUSES.join(", ")}`),
  body("reason")
    .optional({ nullable: true })
    .isString()
    .withMessage("reason must be a string"),
];

export const lockReleaseValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("Invalid release id"),
  body("locked")
    .exists()
    .isBoolean()
    .withMessage("locked must be a boolean"),
];

export const publicLockReleaseValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("Invalid release id"),
  body("lockedBy")
    .trim()
    .notEmpty()
    .withMessage("lockedBy email is required"),
];

export const releaseChangelogParamValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("Invalid release id"),
];
