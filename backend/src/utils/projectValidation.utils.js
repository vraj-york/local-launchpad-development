import ApiError from "./apiError.js";

/**
 * Same rules as createProjectService: folder + GitHub repo name from display name
 * (lowercase, spaces → hyphens). Matches projects/<slug> on disk.
 */
export function projectRepoSlugFromDisplayName(name) {
  if (!name || typeof name !== "string") {
    throw new ApiError(400, "Invalid project name: must be a non-empty string");
  }
  const trimmed = name.trim();
  if (!trimmed) {
    throw new ApiError(400, "Invalid project name: must be a non-empty string");
  }
  const slug = trimmed.toLowerCase().replace(/\s+/g, "-");
  if (slug.length > 100) {
    throw new ApiError(400, "Project name too long. Maximum 100 characters allowed.");
  }
  return slug;
}

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
