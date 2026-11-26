const express = require('express');
const {
  searchPapers,
  getPaper,
  savePaper,
  removeSavedPaper,
  listSavedPapers,
} = require('../controllers/paperController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Search is useful even for exploring before signing in on some platforms,
// but this app requires auth throughout for simplicity and to match the
// 'protected application data' requirement.
router.use(requireAuth);

router.get('/search', searchPapers);
router.get('/saved', listSavedPapers);
router.get('/:id', getPaper);
router.post('/save', savePaper);
router.delete('/save/:id', removeSavedPaper);

module.exports = router;
