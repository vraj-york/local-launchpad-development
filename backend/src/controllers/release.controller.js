import asyncHandler from "../middleware/asyncHandler.middleware.js";
import {
    createReleaseService,
    getReleaseByIdService,
    getReleaseChangelogService,
    listReleasesService,
    lockReleaseService,
    setReleaseStatusService,
    updateReleaseService,
    getReleaseInfoService,
    publicLockReleaseService,
    uploadReleaseVersionService,
} from "../services/release.service.js";
import { regenerateClientReviewSummaryNow } from "../services/releaseReviewSummary.service.js";

export const releaseController = {
    /**
     * Create a new release
     */
    create: asyncHandler(async (req, res) => {
        const release = await createReleaseService(req.body, req.user);
        res.status(201).json(release);
    }),

    /**
     * List all releases for a project
     */
    list: asyncHandler(async (req, res) => {
        const projectId = parseInt(req.params.projectId, 10);
        const releases = await listReleasesService(projectId, req.user);
        res.json(releases);
    }),

    /**
     * Get a release by ID
     */
    getById: asyncHandler(async (req, res) => {
        const releaseId = parseInt(req.params.id, 10);
        const release = await getReleaseByIdService(releaseId, req.user);
        res.json(release);
    }),

    /**
     * Lock a release (one-way; unlock is not supported)
     */
    lock: asyncHandler(async (req, res) => {
        const releaseId = parseInt(req.params.id, 10);
        const { locked } = req.body;

        if (typeof locked !== 'boolean') {
            return res.status(400).json({ error: "Invalid 'locked' parameter. Must be true or false." });
        }

        const release = await lockReleaseService(releaseId, locked, req.user);

        res.json({
            message: "Release locked successfully",
            release
        });
    }),

    /**
     * Partially update a release (name, description, isMvp, releaseDate, startDate; reason if changes)
     */
    update: asyncHandler(async (req, res) => {
        const releaseId = parseInt(req.params.id, 10);
        const release = await updateReleaseService(releaseId, req.body, req.user);
        res.json(release);
    }),

    /**
     * Set release status: draft | active | locked | skip
     */
    setStatus: asyncHandler(async (req, res) => {
        const releaseId = parseInt(req.params.id, 10);
        const { status } = req.body;
        const release = await setReleaseStatusService(releaseId, status, req.user, {
            reason: req.body?.reason,
        });
        res.json({
            message: `Release status set to ${release.status}`,
            release,
        });
    }),

    // /**
    //  * Upload a ZIP file to a release
    //  */
    upload: asyncHandler(async (req, res) => {
        const releaseId = parseInt(req.params.releaseId, 10);

        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        let roadmapItemIds = [];
        if (req.body.roadmapItemIds) {
            // Handle comma-separated string from FormData
            const rawIds = typeof req.body.roadmapItemIds === 'string'
                ? req.body.roadmapItemIds.split(',')
                : (Array.isArray(req.body.roadmapItemIds) ? req.body.roadmapItemIds : []);

            roadmapItemIds = rawIds
                .map(id => parseInt(id, 10))
                .filter(id => !isNaN(id));
        }

        const result = await uploadReleaseVersionService(releaseId, req.file, roadmapItemIds, req.user);

        res.json(result);
    }),

    /**
     * Get release info (public/header)
     */
    info: asyncHandler(async (req, res) => {
        const releaseId = parseInt(req.params.id, 10);
        const data = await getReleaseInfoService(releaseId);
        res.json(data);
    }),

    /**
     * Public lock (no auth). Body: { lockedBy: email }
     */
    publicLock: asyncHandler(async (req, res) => {
        const releaseId = parseInt(req.params.id, 10);
        const { lockedBy } = req.body || {};
        const result = await publicLockReleaseService(releaseId, lockedBy);
        res.json(result);
    }),

    changelog: asyncHandler(async (req, res) => {
        const releaseId = parseInt(req.params.id, 10);
        const entries = await getReleaseChangelogService(releaseId, req.user);
        res.json(entries);
    }),

    /**
     * Regenerate OpenAI client review summary (forces refresh; requires OPENAI_API_KEY).
     */
    regenerateReviewSummary: asyncHandler(async (req, res) => {
        const releaseId = parseInt(req.params.id, 10);
        await getReleaseByIdService(releaseId, req.user);
        let generationContextOverride;
        if (
            req.body != null &&
            Object.prototype.hasOwnProperty.call(
                req.body,
                "clientReviewAiGenerationContext",
            )
        ) {
            const raw = req.body.clientReviewAiGenerationContext;
            generationContextOverride =
                typeof raw === "string" ? raw.trim() || null : null;
        }
        const result = await regenerateClientReviewSummaryNow(releaseId, {
            force: true,
            generationContextOverride,
        });
        const release = await getReleaseByIdService(releaseId, req.user);
        res.json({ ...result, release });
    }),

};