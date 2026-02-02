const prisma = require('../prisma');

/**
 * CREATE Roadmap Item
 */
exports.createItem = async (req, res) => {
    try {
        const {
            roadmapId,
            title,
            description,
            status,
            priority,
            targetVersion,
            releaseId,
            startDate,
            targetDate
        } = req.body;

        const item = await prisma.roadmapItem.create({
            data: {
                roadmapId,
                title,
                description,
                type,
                status,
                priority,
                // targetVersion, // Not in schema Step 5
                releaseId,
                startDate: itemStart,
                endDate: itemEnd
            }
        });

        res.status(201).json(item);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

/**
 * UPDATE single Roadmap Item
 */
exports.updateItem = async (req, res) => {
    try {
        const item = await prisma.roadmapItem.update({
            where: { id: Number(req.params.id) },
            data: req.body
        });

        res.json(item);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

/**
 * DELETE Roadmap Item
 */
exports.deleteItem = async (req, res) => {
    try {
        await prisma.roadmapItem.delete({
            where: { id: Number(req.params.id) }
        });

        res.json({ message: 'Item deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
