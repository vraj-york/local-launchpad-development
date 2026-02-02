
import {
    createProjectService, listProjectsService, activateProjectVersionService,
    getProjectLiveUrlService,
    listProjectVersionsService, getProjectByIdService
} from "../services/project.service.js";
import ApiError from "../utils/apiError.js";

import { validateRoadmapTimelines, validateRoadmapItemsTimeline } from "../validators/roadmap.validator.js";

export const projectController = {
    list: async (req, res) => {
        const projects = await listProjectsService(req.user);
        res.json(projects);
    },

    // GET /api/projects/:projectId
    getById: async (req, res) => {
        const projectId = Number(req.params.projectId);

        const project = await getProjectByIdService(projectId, req.user);

        if (!project) {
            res.status(404);
            throw new ApiError(404, 'Project not found');
        }

        res.json(project);
    },

    create: async (req, res) => {
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
    },
    activateVersion: async (req, res) => {
        const projectId = Number(req.params.id);
        const versionId = Number(req.params.versionId);

        await activateProjectVersionService({
            projectId,
            versionId,
            user: req.user,
        });

        res.json({ message: "Version activated successfully" });
    },
    getLiveUrl: async (req, res) => {
        const data = await getProjectLiveUrlService({
            projectId: Number(req.params.id),
            user: req.user,
        });

        res.json({
            liveUrl: data.buildUrl,
            version: data.version,
        });
    },

    listVersions: async (req, res) => {
        const versions = await listProjectVersionsService({
            projectId: Number(req.params.id),
            user: req.user,
        });

        res.json(versions);
    }, info: async (req, res) => {
        const projectId = Number(req.params.id);
        const data = await getProjectInfoService(projectId);
        res.json(data);
    },
};
