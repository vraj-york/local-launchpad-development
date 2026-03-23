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

/** Dot-separated numeric segments (e.g. 1.0.0, 1.0.1, 1.02). */
const RELEASE_DOT_VERSION_RE = /^\d+(?:\.\d+)+$/;

/**
 * @param {string | undefined} name
 * @returns {number[] | null}
 */
export function parseReleaseNameToTuple(name) {
    const n = name?.trim();
    if (!n || !RELEASE_DOT_VERSION_RE.test(n)) return null;
    return n.split(".").map((p) => parseInt(p, 10));
}

function compareTuples(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x < y) return -1;
        if (x > y) return 1;
    }
    return 0;
}

/**
 * @param {{ name: string }[]} rows
 * @returns {number[] | null}
 */
function maxReleaseTupleFromRows(rows) {
    let maxTuple = null;
    for (const row of rows) {
        const t = parseReleaseNameToTuple(row?.name);
        if (!t) continue;
        if (!maxTuple || compareTuples(t, maxTuple) > 0) maxTuple = t;
    }
    return maxTuple;
}

/**
 * New release name must be strictly greater than the latest parsable name (allows patch, minor, or major bumps).
 * @param {number} projectId
 * @param {string} releaseNameTrimmed
 * @param {{ release: { findMany: Function } }} prismaClient
 */
export async function assertReleaseNameIsNextIncrement(
    projectId,
    releaseNameTrimmed,
    prismaClient,
) {
    const submitted = parseReleaseNameToTuple(releaseNameTrimmed);
    if (!submitted) {
        throw new ApiError(
            400,
            "Release name must be dot-separated numbers with at least two segments (e.g. 1.0.0, 1.0.1, 1.02).",
        );
    }
    const existing = await prismaClient.release.findMany({
        where: { projectId },
        select: { name: true },
    });
    const maxTuple = maxReleaseTupleFromRows(existing);
    if (!maxTuple) {
        return;
    }
    if (compareTuples(submitted, maxTuple) <= 0) {
        const latestStr = maxTuple.map(String).join(".");
        throw new ApiError(
            400,
            `Release name must be greater than the latest: ${latestStr} (e.g. higher patch, minor, or major).`,
        );
    }
}
