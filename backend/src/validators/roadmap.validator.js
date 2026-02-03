import ApiError from "../utils/apiError.js";
import { toDate, assertStartBeforeEnd } from "../utils/projectValidation.utils.js";


/**
 * Validate and normalize roadmaps
 */
export const validateRoadmaps = (roadmaps = []) => {
    if (!Array.isArray(roadmaps)) {
        throw new ApiError(400, "Roadmaps must be an array");
    }

    const normalized = roadmaps.map((rm) => {
        if (!rm.title || !rm.timelineStart || !rm.timelineEnd) {
            throw new ApiError(400, "Roadmap requires title, timelineStart, timelineEnd");
        }

        const start = toDate(rm.timelineStart, "timelineStart");
        const end = toDate(rm.timelineEnd, "timelineEnd");
        assertStartBeforeEnd(start, end, `Roadmap '${rm.title}'`);

        return { ...rm, start, end };
    });

    // Sort chronologically
    normalized.sort((a, b) => a.start - b.start);

    // Validate non-overlap
    for (let i = 1; i < normalized.length; i++) {
        if (normalized[i].start <= normalized[i - 1].end) {
            throw new ApiError(
                400,
                `Roadmap '${normalized[i].title}' overlaps with '${normalized[i - 1].title}'`
            );
        }
    }

    return normalized;
};

/**
 * Validate roadmap items inside roadmap timeline
 */
export const validateRoadmapItems = (roadmap, items = []) => {
    if (!Array.isArray(items)) return [];

    return items.map((item) => {
        if (!item.title || !item.startDate || !item.endDate) {
            throw new ApiError(400, "Roadmap item requires title, startDate, endDate");
        }

        const start = toDate(item.startDate, "startDate");
        const end = toDate(item.endDate, "endDate");
        assertStartBeforeEnd(start, end, `Roadmap item '${item.title}'`);

        if (start < roadmap.start || end > roadmap.end) {
            throw new ApiError(
                400,
                `Roadmap item '${item.title}' must be within roadmap timeline`
            );
        }

        return { ...item, start, end };
    });
};



export const validateRoadmapTimelines = (roadmaps) => {
    const sorted = roadmaps
        .map(r => ({
            ...r,
            start: toDate(r.timelineStart),
            end: toDate(r.timelineEnd)
        }))
        .sort((a, b) => a.start - b.start);

    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].start >= sorted[i].end) {
            throw new ApiError(
                400,
                `Roadmap '${sorted[i].title}' start date must be before end date`
            );
        }

        if (i > 0 && sorted[i].start <= sorted[i - 1].end) {
            throw new ApiError(
                400,
                `Roadmap '${sorted[i].title}' overlaps with '${sorted[i - 1].title}'`
            );
        }
    }

    return sorted;
};

export const validateRoadmapItemsTimeline = (roadmap) => {
    const rs = new Date(roadmap.timelineStart);
    const re = new Date(roadmap.timelineEnd);

    roadmap.items.forEach(item => {
        const is = new Date(item.startDate);
        const ie = new Date(item.endDate);

        if (is >= ie) {
            throw new ApiError(
                400,
                `Item '${item.title}' start date must be before end date`
            );
        }

        if (is < rs || ie > re) {
            throw new ApiError(
                400,
                `Item '${item.title}' must be within roadmap timeline`
            );
        }
    });
};
