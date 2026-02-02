const express = require('express');
const router = express.Router();
const controller = require('../controllers/roadmap.controller');

// CRUD
router.post('/', controller.createRoadmap);
router.get('/project/:projectId', controller.getRoadmapsByProject);
router.get('/:id', controller.getRoadmapById);
router.put('/:id', controller.updateRoadmap);
router.delete('/:id', controller.deleteRoadmap);

module.exports = router;
