const express = require('express');
const {
  listProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  addPaperToProject,
  removePaperFromProject,
  getProjectTimeline,
} = require('../controllers/projectController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', listProjects);
router.post('/', createProject);
router.get('/:id', getProject);
router.get('/:id/timeline', getProjectTimeline);
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);
router.post('/:id/papers', addPaperToProject);
router.delete('/:id/papers/:paperId', removePaperFromProject);

module.exports = router;
