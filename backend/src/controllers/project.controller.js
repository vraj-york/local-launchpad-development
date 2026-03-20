
import {
    createProjectService, listProjectsService, setReleaseStatusService,
    getProjectLiveUrlService,
    listProjectVersionsService, getProjectByIdService,
    getJiraTicketsService,
    activateProjectVersionService,
    updateProjectDetailsService,
    deleteProjectService,
    switchProjectVersion
} from "../services/project.service.js";
import ApiError from "../utils/apiError.js";
import asyncHandler from "../middleware/asyncHandler.middleware.js";

import { validateRoadmapTimelines, validateRoadmapItemsTimeline } from "../validators/roadmap.validator.js";

export const projectController = {
    list: asyncHandler(async (req, res) => {
        const projects = await listProjectsService(req.user);
        res.json(projects);
    }),
    deleteProject: asyncHandler(async (req, res) => {
        const { projectId } = req.params;
        const result = await deleteProjectService(projectId, req.user);
        if (typeof req.clearProjectLocksAfterDelete === "function" && result.projectName) {
            req.clearProjectLocksAfterDelete(result.projectName);
        }
        res.json({ message: result.message });
    }),
    // GET /api/projects/:projectId
    getById: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.projectId);
        const project = await getProjectByIdService(projectId, req.user);
        if (!project) {
            res.status(404);
            throw new ApiError(404, 'Project not found');
        }

        res.json(project);
    }),

    create: asyncHandler(async (req, res) => {
        //const { roadmaps } = req.body;
        // if (!Array.isArray(roadmaps) || roadmaps.length === 0) {
        //     throw new ApiError(400, "roadmap is required");
        // }
        /**
        //  * roadmap-level validations
        //  * (basic required/enums already handled by middleware)
        //  */
        // const validatedRoadmaps = validateRoadmapTimelines(roadmaps);

        // validatedRoadmaps.forEach((roadmap) => {
        //     validateRoadmapItemsTimeline(roadmap);
        // });

        const project = await createProjectService({
            userId: req.user.id,
            body: req.body,
        });

        res.status(201).json(project);
    }),
    update: asyncHandler(async (req, res) => {
        const project = await updateProjectDetailsService({
            projectId: Number(req.params.projectId),
            user: req.user,
            body: req.body,
        });

        res.json(project);
    }),
    activateVersion: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.id);
        const versionId = Number(req.params.versionId);

        const result = await activateProjectVersionService({
            projectId,
            versionId,
            user: req.user,
        });

        res.json(result);
    }),

    setReleaseStatus: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.id);
        const releaseId = Number(req.params.releaseId);
        await setReleaseStatusService({
            projectId,
            releaseId,
            user: req.user
        });

        res.json({ message: "Release activated successfully" });
    }),
    getLiveUrl: asyncHandler(async (req, res) => {
        const data = await getProjectLiveUrlService({
            projectId: Number(req.params.id),
            user: req.user,
        });

        res.json({
            liveUrl: data.buildUrl,
            version: data.version,
        });
    }),

    listVersions: asyncHandler(async (req, res) => {
        const versions = await listProjectVersionsService({
            projectId: Number(req.params.id),
            user: req.user,
        });

        res.json(versions);
    }),

    getJiraTickets: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.id);
        const tickets = await getJiraTicketsService(projectId, req.user);
        res.json(tickets);
    }),
    getProjectPublicDetail: asyncHandler(async (req, res) => {
        const projectId = (req.params.projectId);
        const project = await getProjectByIdService(Number(projectId));

        if (!project) {
            res.status(404);
            throw new ApiError(404, 'Project not found');
        }

        res.json(project);
    })
    ,
    switchVersion: asyncHandler(async (req, res) => {
        const { projectId } = req.params;
        const { versionId, isPermanent } = req.body;
        console.log('Switching project version', versionId, typeof versionId);
        // Default isPermanent to false if not provided
        const result = await switchProjectVersion(
            projectId,
            versionId,
            isPermanent || false
        );

        res.json(result);
    })
};