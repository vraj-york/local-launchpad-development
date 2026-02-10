
import {
    createProjectService, listProjectsService, activateProjectVersionService,
    getProjectLiveUrlService,
    listProjectVersionsService, getProjectByIdService, getProjectInfoService,
    updateProjectService,
    getJiraTicketsService
} from "../services/project.service.js";
import ApiError from "../utils/apiError.js";
import asyncHandler from "../middleware/asyncHandler.middleware.js";

import { validateRoadmapTimelines, validateRoadmapItemsTimeline } from "../validators/roadmap.validator.js";

export const projectController = {
    list: asyncHandler(async (req, res) => {
        const projects = await listProjectsService(req.user);
        res.json(projects);
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
        const { roadmaps } = req.body;
        if (!Array.isArray(roadmaps) || roadmaps.length === 0) {
            throw new ApiError(400, "roadmap is required");
        }
        /**
         * roadmap-level validations
         * (basic required/enums already handled by middleware)
         */
        const validatedRoadmaps = validateRoadmapTimelines(roadmaps);

        validatedRoadmaps.forEach((roadmap) => {
            validateRoadmapItemsTimeline(roadmap);
        });

        const project = await createProjectService({
            userId: req.user.id,
            body: req.body,
        });

        res.status(201).json(project);
    }),
    update: async (req, res) => {
        const { roadmap } = req.body;

        // advanced validations
        const validatedRoadmap = validateRoadmapTimelines([roadmap])[0];
        validateRoadmapItemsTimeline(validatedRoadmap);

        const project = await updateProjectService({
            projectId: Number(req.params.projectId),
            user: req.user,
            roadmap: validatedRoadmap,
        });

        res.json(project);
    }
    ,
    activateVersion: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.id);
        const versionId = Number(req.params.versionId);

        await activateProjectVersionService({
            projectId,
            versionId,
            user: req.user,
        });

        res.json({ message: "Version activated successfully" });
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

    info: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.id);
        const data = await getProjectInfoService(projectId);
        res.json(data);
    }),

    getJiraTickets: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.id);
        const tickets = await getJiraTicketsService(projectId, req.user);
        res.json(tickets);
    }),
};
