const prisma = require('../prisma');

/**
 * CREATE Roadmap (only one)
 */
exports.createRoadmap = async (req, res) => {
    try {
        const { projectId, releaseId, name, description, status, tshirtSize, timelineStart, timelineEnd } = req.body; // Merged declaration

        if (!projectId || !name) {
            return res.status(400).json({ message: 'projectId and name are required' });
        }

        const roadmap = await prisma.roadmap.create({
            data: {
                projectId,
                releaseId,
                title: name, // Assuming 'name' from req.body maps to 'title' in the schema
                description,
                status,
                tshirtSize,
                timelineStart,
                timelineEnd,
                createdBy: req.user.id
            }
        });

        res.status(201).json(roadmap);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

/**
 * GET Roadmap by ID
 */
exports.getRoadmapById = async (req, res) => {
    try {
        const roadmap = await prisma.roadmap.findUnique({
            where: { id: Number(req.params.id) },
            include: { items: true }
        });

        if (!roadmap) {
            return res.status(404).json({ message: 'Roadmap not found' });
        }

        res.json(roadmap);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

/**
 * GET Roadmaps by Project
 */
exports.getRoadmapsByProject = async (req, res) => {
    try {
        const roadmaps = await prisma.roadmap.findMany({
            where: { projectId: Number(req.params.projectId) },
            include: { items: true },
            orderBy: { createdAt: 'desc' }
        });

        res.json(roadmaps);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

/**
 * UPDATE Roadmap
 */
exports.updateRoadmap = async (req, res) => {
    try {
        const { name, description, releaseId } = req.body;

        const roadmap = await prisma.roadmap.update({
            where: { id: Number(req.params.id) },
            data: { name, description, releaseId }
        });

        res.json(roadmap);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

/**
 * DELETE Roadmap
 */
exports.deleteRoadmap = async (req, res) => {
    try {
        await prisma.roadmap.delete({
            where: { id: Number(req.params.id) }
        });

        res.json({ message: 'Roadmap deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
