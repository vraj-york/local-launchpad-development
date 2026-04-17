
import {
    createProjectService,
    listProjectsService,
    setReleaseStatusService,
    getProjectLiveUrlService,
    listProjectVersionsService,
    getProjectByIdService,
    getJiraTicketsService,
    activateProjectVersionService,
    revertActiveReleaseToBaselineProjectVersionService,
    updateProjectDetailsService,
    deleteProjectService,
    switchProjectVersion,
    startScratchAgentFromProjectService,
    assertProjectAccess,
} from "../services/project.service.js";
import {
    listMergedCursorRulesCatalog,
    importAwesomeCursorrulesFolders,
    upsertCustomCursorRule,
    listAllCustomCursorRules,
} from "../services/awesomeCursorrules.service.js";
import { startMigrateFrontendForRelease } from "../services/migrateFrontend.service.js";
import { prisma } from "../lib/prisma.js";
import ApiError from "../utils/apiError.js";
import asyncHandler from "../middleware/asyncHandler.middleware.js";

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
        const project = await createProjectService({
            userId: req.user.id,
            body: req.body,
            user: req.user,
        });

        res.status(201).json(project);
    }),

    startScratchAgent: asyncHandler(async (req, res) => {
        const data = await startScratchAgentFromProjectService({
            projectId: req.params.projectId,
            user: req.user,
            body: req.body,
        });
        res.json(data);
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

    revertActiveReleaseToBaseline: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.id);
        const releaseId = Number(req.params.releaseId);
        const baselineProjectVersionId = Number(req.body?.baselineProjectVersionId);
        const { reason } = req.body || {};

        const result = await revertActiveReleaseToBaselineProjectVersionService({
            projectId,
            activeReleaseId: releaseId,
            baselineProjectVersionId,
            reason,
            user: req.user,
        });

        res.json(result);
    }),

    setReleaseStatus: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.id);
        const releaseId = Number(req.params.releaseId);
        const { reason } = req.body || {};
        await setReleaseStatusService({
            projectId,
            releaseId,
            user: req.user,
            reason,
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
        const project = await getProjectByIdService(null, null, {
            publicView: true,
            slug: req.params.slug,
        });
        if (!project) {
            res.status(404);
            throw new ApiError(404, 'Project not found');
        }
        res.json(project);
    }),
    switchVersion: asyncHandler(async (req, res) => {
        const { projectId } = req.params;
        const { versionId, isPermanent } = req.body;
        // Default isPermanent to false if not provided
        const result = await switchProjectVersion(
            projectId,
            versionId,
            isPermanent || false
        );

        res.json(result);
    }),

    /** GET /api/projects/:projectId/cursor-rules/catalog */
    cursorRulesCatalog: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.projectId);
        if (Number.isNaN(projectId)) {
            throw new ApiError(400, "Invalid project id");
        }
        await assertProjectAccess(projectId, req.user);
        const { folders } = await listMergedCursorRulesCatalog();
        res.json({ folders });
    }),

    /** GET /api/projects/:projectId/cursor-rules/custom — shared rules (same data for every project; projectId is for access control only). */
    listCustomCursorRules: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.projectId);
        if (Number.isNaN(projectId)) {
            throw new ApiError(400, "Invalid project id");
        }
        await assertProjectAccess(projectId, req.user);
        const data = await listAllCustomCursorRules();
        res.json(data);
    }),

    /** POST /api/projects/:projectId/cursor-rules/custom — upsert shared rule (projectId for access only). */
    createCustomCursorRule: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.projectId);
        if (Number.isNaN(projectId)) {
            throw new ApiError(400, "Invalid project id");
        }
        await assertProjectAccess(projectId, req.user);
        const found = await prisma.project.findUnique({
            where: { id: projectId },
            select: { id: true },
        });
        if (!found) {
            throw new ApiError(404, "Project not found");
        }
        const result = await upsertCustomCursorRule({
            folderName: req.body?.folderName,
            body: req.body?.body,
        });
        res.status(201).json(result);
    }),

    /** POST /api/projects/:projectId/cursor-rules/import */
    importCursorRules: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.projectId);
        if (Number.isNaN(projectId)) {
            throw new ApiError(400, "Invalid project id");
        }
        await assertProjectAccess(projectId, req.user);
        const project = await prisma.project.findUnique({
            where: { id: projectId },
        });
        if (!project) {
            throw new ApiError(404, "Project not found");
        }
        const result = await importAwesomeCursorrulesFolders(
            project,
            req.body?.folders,
        );
        res.json(result);
    }),

    /** POST /api/projects/:id/releases/:releaseId/migrate-frontend */
    migrateFrontendRelease: asyncHandler(async (req, res) => {
        const projectId = Number(req.params.id);
        const releaseId = Number(req.params.releaseId);
        const rawVid = req.body?.projectVersionId ?? req.body?.projectVersionID;
        const targetProjectVersionId =
            rawVid === undefined || rawVid === null || rawVid === ""
                ? null
                : Number(rawVid);
        const rawAck = req.body?.migrateFrontend;
        const migrateFrontend =
            rawAck === true || String(rawAck || "").toLowerCase() === "true";
        const result = await startMigrateFrontendForRelease({
            projectId,
            releaseId,
            user: req.user,
            targetProjectVersionId:
                Number.isInteger(targetProjectVersionId) && targetProjectVersionId > 0
                    ? targetProjectVersionId
                    : null,
            migrateFrontend,
        });
        res.status(201).json(result);
    }),
};