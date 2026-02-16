import ApiError from "../utils/apiError.js";

export function validateProjectName(name) {
    if (!name || typeof name !== "string") {
        throw new Error("Invalid project name");
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
        throw new Error("Project name contains invalid characters");
    }

    if (name.length > 100) {
        throw new Error("Project name too long");
    }

    return name;
}
export const toDate = (value, fieldName) => {
    const date = new Date(value);
    if (isNaN(date)) {
        throw new ApiError(400, `Invalid date for ${fieldName}`);
    }
    return date;
};

export const assertStartBeforeEnd = (start, end, label) => {
    if (start >= end) {
        throw new ApiError(400, `${label} start must be before end`);
    }
};