import asyncHandler from "../middleware/asyncHandler.middleware.js";
import {
    createReleaseService,
    getReleaseByIdService,
    listReleasesService,
    lockReleaseService,

    getReleaseInfoService,
    publicLockReleaseService,
    uploadReleaseVersionService
} from "../services/release.service.js";

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
        const release = await getReleaseByIdService(releaseId);
        res.json(release);
    }),

    /**
     * Lock or unlock a release
     */
    lock: asyncHandler(async (req, res) => {
        const releaseId = parseInt(req.params.id, 10);
        const { locked } = req.body;

        if (typeof locked !== 'boolean') {
            return res.status(400).json({ error: "Invalid 'locked' parameter. Must be true or false." });
        }

        const release = await lockReleaseService(releaseId, locked, req.user);

        res.json({
            message: `Release ${locked ? 'locked' : 'unlocked'} successfully`,
            release
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

        const result = await uploadReleaseVersionService(releaseId, req.file, req.body.version, req.user);
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
     * Public lock (no auth, token based)
     */
    publicLock: asyncHandler(async (req, res) => {
        const releaseId = parseInt(req.params.id, 10);
        const { locked, token } = req.body;
        const result = await publicLockReleaseService(releaseId, locked, token);
        res.json(result);
    })
};
