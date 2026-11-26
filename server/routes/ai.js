const express = require('express');
const {
  analyzePaper,
  comparePapers,
  researchGap,
  generateDraft,
  getProjectDraft,
  suggestResearchQuestion,
  kickoffProject,
  analyzeProjectSources,
  getProjectIntelligence,
  identifyResearchGaps,
  getProjectGaps,
  buildProjectResearchPlan,
  getProjectPlan,
  copilotMessage,
  getCopilotHistory,
  routeChatMessage,
} = require('../controllers/aiController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/analyze-paper', analyzePaper);
router.post('/compare-papers', comparePapers);
router.post('/research-gap', researchGap);
router.post('/generate-draft', generateDraft);
router.get('/draft/:projectId', getProjectDraft);
router.post('/suggest-question', suggestResearchQuestion);
router.post('/kickoff', kickoffProject);
router.post('/analyze-sources', analyzeProjectSources);
router.get('/analyze-sources/:projectId', getProjectIntelligence);
router.post('/research-gaps', identifyResearchGaps);
router.get('/research-gaps/:projectId', getProjectGaps);
router.post('/research-plan', buildProjectResearchPlan);
router.get('/research-plan/:projectId', getProjectPlan);
router.post('/copilot', copilotMessage);
router.get('/copilot/:projectId', getCopilotHistory);
// Natural-language intent router (Pass 6) — the composer's primary entry
// point. Classifies the message and either performs a research action
// (search/analyze/gaps/plan/draft/select/compare/...) or falls back to a
// normal Research Copilot reply. See aiController.routeChatMessage.
router.post('/chat', routeChatMessage);

module.exports = router;
