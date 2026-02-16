
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
import { decryptId, encryptId } from "../utils/encryptionHelper.js";

export const projectController = {
    list: asyncHandler(async (req, res) => {
        const projects = await listProjectsService(req.user);
        res.json(projects);
    }),
    // GET /api/projects/:projectId
    getById: asyncHandler(async (req, res) => {
        const projectId = (req.params.projectId);
        const decreptId = decryptId(projectId)
        const project = await getProjectByIdService(Number(decreptId), req.user);

        if (!project) {
            res.status(404);
            throw new ApiError(404, 'Project not found');
        }

        res.json(project);
    }),
    getProjectPublicDetail: asyncHandler(async (req, res) => {
        const projectId = (req.params.projectId);
        const decreptId = decryptId(projectId)
        const project = await getProjectByIdService(Number(decreptId));

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
        const userId = (req.user.id);
        const project = await createProjectService({
            userId: userId,
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

        const decryptProjectId = decryptId(req.params.id);
        const decryptVersionId = decryptId(req.params.versionId);
        const projectId = Number(decryptProjectId);
        const versionId = Number(decryptVersionId);
        await activateProjectVersionService({
            projectId,
            versionId,
            user: req.user,
        });

        res.json({ message: "Version activated successfully" });
    }),
    getLiveUrl: asyncHandler(async (req, res) => {
        const decrypt = decryptId(req.params.id)
        const data = await getProjectLiveUrlService({
            projectId: Number(decrypt),
            user: req.user,
        });

        res.json({
            liveUrl: data.buildUrl,
            version: data.version,
        });
    }),

    listVersions: asyncHandler(async (req, res) => {
        const decrypt = decryptId(req.params.id)

        const versions = await listProjectVersionsService({
            projectId: Number(decrypt),
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
