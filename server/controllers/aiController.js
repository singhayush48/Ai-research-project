const { query } = require('../db/pool');
const { callAI, callAIJson } = require('../services/aiService');
const {
  buildAnalyzePrompt,
  buildComparePrompt,
  buildResearchGapPrompt,
  buildDraftPrompt,
  buildResearchQuestionPrompt,
  buildResearchIntelligencePrompt,
  buildResearchGapAnalysisPrompt,
  buildResearchPlanPrompt,
  buildCopilotPrompt,
} = require('../services/prompts');
const N = require('../services/normalizers');
const openalex = require('../services/openalex');
const { isPositiveInt, isValidResearchType } = require('../utils/validate');
const { classifyIntent } = require('../services/intentRouter');
const { linkSearchResultsToProject } = require('./paperController');
const { paperCache } = require('../utils/paperCache');
const { advanceStage } = require('../utils/stage');

// Most sources one AI call will take. Beyond this, small/free models start
// returning empty or truncated JSON.
const MAX_SOURCES_PER_ANALYSIS = 30;

// An error whose message is safe and useful to show the user as-is.
function userError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

// ---------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------
function rowToPaperDto(p) {
  let authors = [];
  if (Array.isArray(p.authors)) authors = p.authors;
  else if (typeof p.authors === 'string' && p.authors) {
    try {
      const parsed = JSON.parse(p.authors);
      if (Array.isArray(parsed)) authors = parsed;
    } catch {
      authors = [];
    }
  }
  return {
    id: p.id,
    openalexId: p.openalex_id,
    title: p.title,
    authors,
    publicationYear: p.publication_year,
    sourceName: p.source_name,
    doi: p.doi,
    abstract: p.abstract,
    paperUrl: p.paper_url,
    citedByCount: p.cited_by_count,
  };
}

// Loads papers by local id, preserving the caller's order. Uses a shared
// in-memory cache (evicted whenever a paper is re-upserted) and fetches all
// cache misses in a single query. Always returns COPIES, because callers
// annotate the objects (selectedForAnalysis, ...).
async function fetchPapersByIds(paperIds) {
  const ids = Array.isArray(paperIds) ? paperIds.filter((id) => Number.isInteger(id)) : [];
  if (ids.length === 0) return [];

  const misses = [...new Set(ids.filter((id) => paperCache.get(id) === undefined))];
  if (misses.length > 0) {
    const { rows } = await query('SELECT * FROM papers WHERE id = ANY($1::int[])', [misses]);
    rows.forEach((row) => paperCache.set(row.id, rowToPaperDto(row)));
  }
  return ids
    .map((id) => paperCache.get(id))
    .filter(Boolean)
    .map((p) => ({ ...p, authors: [...p.authors] }));
}

// Selected sources for a project, in the order they were first discovered.
async function fetchSelectedProjectPapers(projectId) {
  const { rows } = await query(
    `SELECT paper_id FROM project_papers
     WHERE project_id = $1 AND selected_for_analysis = TRUE
     ORDER BY created_at ASC, id ASC`,
    [projectId]
  );
  return fetchPapersByIds(rows.map((r) => r.paper_id));
}

// Every paper ever linked to this project (not just selected ones), ordered
// by when it was first discovered — the same ordering the UI numbers by, so
// "paper 3" always means the paper the user was just shown. Each carries its
// current selection flag.
async function fetchOrderedProjectPapers(projectId) {
  const { rows } = await query(
    `SELECT paper_id, selected_for_analysis FROM project_papers
     WHERE project_id = $1 ORDER BY created_at ASC, id ASC`,
    [projectId]
  );
  const papers = await fetchPapersByIds(rows.map((r) => r.paper_id));
  const flags = new Map(rows.map((r) => [r.paper_id, r.selected_for_analysis]));
  return papers.map((p) => ({ ...p, selectedForAnalysis: Boolean(flags.get(p.id)) }));
}

// Source references shown next to every AI result. Includes the abstract so
// clicking a [n] chip opens a preview that actually has the abstract.
function toSourceRefs(papers) {
  return papers.map((p, i) => ({
    index: i + 1,
    id: p.id,
    openalexId: p.openalexId,
    title: p.title,
    authors: p.authors,
    publicationYear: p.publicationYear,
    sourceName: p.sourceName,
    doi: p.doi,
    abstract: p.abstract,
    paperUrl: p.paperUrl,
    citedByCount: p.citedByCount,
  }));
}

// ---------------------------------------------------------------------
// Projects / stored results
// ---------------------------------------------------------------------
async function loadOwnedProject(projectId, userId) {
  const { rows } = await query('SELECT * FROM research_projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
  return rows[0] || null;
}

async function requireOwnedProject(projectId, userId) {
  const project = await loadOwnedProject(projectId, userId);
  if (!project) throw userError('Project not found.', 404);
  return project;
}

async function getLatestResult(projectId, userId, kind) {
  const { rows } = await query(
    `SELECT * FROM comparisons WHERE project_id = $1 AND user_id = $2 AND kind = $3
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [projectId, userId, kind]
  );
  return rows[0] || null;
}

// Latest row of each requested kind in ONE query.
async function getLatestResults(projectId, userId, kinds) {
  const { rows } = await query(
    `SELECT DISTINCT ON (kind) * FROM comparisons
     WHERE project_id = $1 AND user_id = $2 AND kind = ANY($3::text[])
     ORDER BY kind, created_at DESC, id DESC`,
    [projectId, userId, kinds]
  );
  return new Map(rows.map((r) => [r.kind, r]));
}

async function saveComparison({ userId, projectId, paperIds, kind, content }) {
  const { rows } = await query(
    `INSERT INTO comparisons (user_id, project_id, paper_ids, kind, content)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
    [userId, projectId, paperIds, kind, JSON.stringify(content)]
  );
  return rows[0];
}

async function saveReport({ userId, projectId, paperIds, content }) {
  const { rows } = await query(
    `INSERT INTO reports (user_id, project_id, paper_ids, content) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
    [userId, projectId, paperIds, JSON.stringify(content)]
  );
  return rows[0];
}

function toMessageDto(row) {
  return { id: row.id, role: row.role, content: row.content, createdAt: row.created_at, created_at: row.created_at };
}

async function insertMessage(projectId, userId, role, content) {
  const { rows } = await query(
    `INSERT INTO copilot_messages (project_id, user_id, role, content) VALUES ($1, $2, $3, $4)
     RETURNING id, role, content, created_at`,
    [projectId, userId, role, content]
  );
  return toMessageDto(rows[0]);
}

async function deleteMessage(id) {
  try {
    await query('DELETE FROM copilot_messages WHERE id = $1', [id]);
  } catch {
    /* best effort */
  }
}

// Runs `fn` after inserting an assistant "lead-in" message, so on reload the
// lead-in appears BEFORE the card it introduces (the timeline sorts by
// created_at). If `fn` fails the lead-in is removed again so no orphan
// "Analyzing..." line is left behind.
async function withLeadMessage(projectId, userId, text, fn) {
  const message = await insertMessage(projectId, userId, 'assistant', text);
  try {
    const result = await fn();
    return { message, result };
  } catch (err) {
    await deleteMessage(message.id);
    throw err;
  }
}

// ---------------------------------------------------------------------
// Preconditions + AI generation (shared by the button endpoints AND the
// natural-language router, so behaviour is identical either way)
// ---------------------------------------------------------------------
async function requireAnalyzableSources(projectId) {
  const papers = await fetchSelectedProjectPapers(projectId);
  if (papers.length === 0) {
    throw userError('No sources are selected yet. Select papers from a search (or ask me to find some), then try again.');
  }
  if (papers.length > MAX_SOURCES_PER_ANALYSIS) {
    throw userError(
      `You have ${papers.length} sources selected — analysis supports up to ${MAX_SOURCES_PER_ANALYSIS} at a time. Deselect some and try again.`
    );
  }
  if (!papers.some((p) => p.abstract && p.abstract.trim().length > 0)) {
    throw userError('None of the selected sources have abstracts available, so there is not enough source material to analyze yet.');
  }
  return papers;
}

function requireContent(check, label) {
  return (value) => {
    if (!check(value)) throw new Error(`${label} came back empty.`);
  };
}

async function generateIntelligence(project, papers, force) {
  const { system, prompt } = buildResearchIntelligencePrompt({
    projectTitle: project.title,
    researchQuestion: project.research_question,
    researchObjective: project.research_objective,
    papers,
  });
  // Keep each provider request bounded. Small/free models frequently exhaust
  // their context or output budget when 20-30 abstracts are sent together.
  const batchSize = 6;
  if (papers.length <= batchSize) {
    return callAIJson({
      system, prompt,
      maxTokens: Math.min(5000, 2500 + papers.length * 250),
      bypassCache: force,
      normalize: (raw) => N.normalizeIntelligence(raw, papers.length),
      validate: requireContent(N.intelligenceHasContent, 'Analysis'),
    });
  }

  const batches = [];
  for (let offset = 0; offset < papers.length; offset += batchSize) {
    const batch = papers.slice(offset, offset + batchSize);
    const built = buildResearchIntelligencePrompt({
      projectTitle: project.title,
      researchQuestion: project.research_question,
      researchObjective: project.research_objective,
      papers: batch,
    });
    const result = await callAIJson({
      system: built.system,
      prompt: built.prompt,
      maxTokens: 4000,
      bypassCache: force,
      normalize: (raw) => N.normalizeIntelligence(raw, batch.length),
      validate: requireContent(N.intelligenceHasContent, 'Source batch analysis'),
    });
    batches.push({ result, offset });
  }

  const remapCitationText = (value, offset) =>
    typeof value === 'string' ? value.replace(/\[(\d+)\]/g, (match, number) => `[${Number(number) + offset}]`) : value;
  const merged = {
    executiveSummary: {
      text: batches.map(({ result, offset }) => remapCitationText(result.executiveSummary.text, offset)).filter(Boolean).join(' '),
      type: 'ai_interpretation',
      sources: [],
    },
    keyThemes: [], mainFindings: [], methodologies: [], similarities: [],
    differences: [], contradictions: [], limitations: [], futureDirections: [],
    disclaimer: 'This analysis is AI-generated from the abstracts and metadata of the selected sources only. It may be incomplete and does not replace reading the original papers.',
  };
  const collectionKeys = ['keyThemes','mainFindings','methodologies','similarities','differences','contradictions','limitations','futureDirections'];
  for (const { result, offset } of batches) {
    for (const key of collectionKeys) {
      for (const item of result[key] || []) {
        const mapped = Object.fromEntries(Object.entries(item).map(([field, value]) => [
          field,
          typeof value === 'string' ? remapCitationText(value, offset) : value,
        ]));
        mapped.sources = (item.sources || []).map((n) => n + offset);
        const identity = key === 'keyThemes' ? `${mapped.theme}|${mapped.description}` : String(mapped.finding || mapped.method || mapped.point || mapped.suggestion || '');
        if (!merged[key].some((existing) => (key === 'keyThemes'
          ? `${existing.theme}|${existing.description}` === identity
          : String(existing.finding || existing.method || existing.point || existing.suggestion || '') === identity))) {
          merged[key].push(mapped);
        }
      }
    }
  }
  if (!N.intelligenceHasContent(merged)) throw new Error('Combined source analysis returned no usable findings.');
  return merged;
}

async function generateGaps(project, papers, priorIntelligence, force) {
  const { system, prompt } = buildResearchGapAnalysisPrompt({
    projectTitle: project.title,
    researchQuestion: project.research_question,
    researchObjective: project.research_objective,
    papers,
    priorIntelligence,
  });
  return callAIJson({
    system,
    prompt,
    maxTokens: 3000,
    bypassCache: force,
    normalize: (raw) => N.normalizeGaps(raw, papers.length),
    validate: requireContent(N.gapsHaveContent, 'Gap analysis'),
  });
}

async function generatePlan(project, papers, gaps, force) {
  const { system, prompt } = buildResearchPlanPrompt({
    projectTitle: project.title,
    researchQuestion: project.research_question,
    researchObjective: project.research_objective,
    researchType: project.research_type,
    papers,
    gaps,
  });
  return callAIJson({
    system,
    prompt,
    maxTokens: 2500,
    bypassCache: force,
    normalize: (raw) => N.normalizePlan(raw, papers.length),
    validate: requireContent(N.planHasContent, 'Research plan'),
  });
}

async function generateDraftContent(project, papers, force) {
  const { system, prompt } = buildDraftPrompt({
    projectTitle: project.title,
    researchQuestion: project.research_question,
    papers,
  });
  return callAIJson({
    system,
    prompt,
    maxTokens: 4000,
    bypassCache: force,
    normalize: (raw) => N.normalizeDraft(raw, papers),
    validate: requireContent(N.draftHasContent, 'Draft'),
  });
}

async function generateComparison(papers, maxTokens, force) {
  const { system, prompt } = buildComparePrompt(papers);
  return callAIJson({
    system,
    prompt,
    maxTokens,
    bypassCache: force,
    normalize: (raw) => N.normalizeComparison(raw, papers.length),
    validate: requireContent(N.comparisonHasContent, 'Comparison'),
  });
}

async function requirePlannableGaps(projectId, userId) {
  const gapsRow = await getLatestResult(projectId, userId, 'research_gap');
  if (!gapsRow) {
    throw userError('Identify research gaps for this project first — the research plan builds directly on them. (Try "what are the research gaps?")');
  }
  const papers = await fetchPapersByIds(gapsRow.paper_ids);
  return { gapsRow, papers, gaps: N.normalizeGaps(gapsRow.content, papers.length) };
}

// ---------------------------------------------------------------------
// Standalone (non-project) endpoints: Paper Detail + Compare pages
// ---------------------------------------------------------------------
async function analyzePaper(req, res, next) {
  try {
    const { paperId, regenerate } = req.body || {};
    if (!isPositiveInt(paperId)) return res.status(400).json({ error: 'A valid paperId is required.' });

    const papers = await fetchPapersByIds([Number(paperId)]);
    if (papers.length === 0) return res.status(404).json({ error: 'Paper not found.' });

    const { system, prompt } = buildAnalyzePrompt(papers[0]);
    const analysis = await callAIJson({
      system,
      prompt,
      maxTokens: 1800,
      bypassCache: Boolean(regenerate),
      normalize: N.normalizePaperAnalysis,
    });

    const { rows } = await query(
      `INSERT INTO analyses (user_id, paper_id, content) VALUES ($1, $2, $3) RETURNING id, created_at`,
      [req.user.id, paperId, JSON.stringify(analysis)]
    );

    res.json({ analysisId: rows[0].id, createdAt: rows[0].created_at, analysis });
  } catch (err) {
    next(err);
  }
}

async function comparePapers(req, res, next) {
  try {
    const { paperIds, regenerate } = req.body || {};
    if (!Array.isArray(paperIds) || paperIds.length < 2 || !paperIds.every(isPositiveInt)) {
      return res.status(400).json({ error: 'At least 2 valid paperIds are required for comparison.' });
    }
    if (paperIds.length > MAX_SOURCES_PER_ANALYSIS) {
      return res.status(400).json({ error: `Compare up to ${MAX_SOURCES_PER_ANALYSIS} papers at a time.` });
    }

    const papers = await fetchPapersByIds(paperIds.map(Number));
    if (papers.length < 2) return res.status(404).json({ error: 'One or more papers could not be found.' });

    const comparison = await generateComparison(papers, 2500, Boolean(regenerate));

    const { rows } = await query(
      `INSERT INTO comparisons (user_id, paper_ids, content) VALUES ($1, $2, $3) RETURNING id, created_at`,
      [req.user.id, papers.map((p) => p.id), JSON.stringify(comparison)]
    );

    res.json({ comparisonId: rows[0].id, createdAt: rows[0].created_at, comparison });
  } catch (err) {
    next(err);
  }
}

async function researchGap(req, res, next) {
  try {
    const { paperIds, regenerate } = req.body || {};
    if (!Array.isArray(paperIds) || paperIds.length < 2 || !paperIds.every(isPositiveInt)) {
      return res.status(400).json({ error: 'At least 2 valid paperIds are required for gap analysis.' });
    }
    if (paperIds.length > MAX_SOURCES_PER_ANALYSIS) {
      return res.status(400).json({ error: `Analyze up to ${MAX_SOURCES_PER_ANALYSIS} papers at a time.` });
    }

    const papers = await fetchPapersByIds(paperIds.map(Number));
    if (papers.length < 2) return res.status(404).json({ error: 'One or more papers could not be found.' });

    const { system, prompt } = buildResearchGapPrompt(papers);
    const gapAnalysis = await callAIJson({
      system,
      prompt,
      maxTokens: 2000,
      bypassCache: Boolean(regenerate),
      normalize: N.normalizeLegacyGaps,
      validate: requireContent(N.legacyGapsHaveContent, 'Gap analysis'),
    });

    res.json({ gapAnalysis });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------
// Project-scoped research actions (button endpoints)
// ---------------------------------------------------------------------
async function generateDraft(req, res, next) {
  try {
    const { projectId, paperIds, regenerate } = req.body || {};
    if (!isPositiveInt(projectId) || !Array.isArray(paperIds) || paperIds.length === 0 || !paperIds.every(isPositiveInt)) {
      return res.status(400).json({ error: 'A valid projectId and at least 1 paperId are required.' });
    }
    const project = await requireOwnedProject(projectId, req.user.id);

    const uniqueIds = [...new Set(paperIds.map(Number))];
    if (uniqueIds.length > MAX_SOURCES_PER_ANALYSIS) {
      return res.status(400).json({ error: `Drafting supports up to ${MAX_SOURCES_PER_ANALYSIS} sources at a time. Deselect some and try again.` });
    }
    const papers = await fetchPapersByIds(uniqueIds);
    if (papers.length === 0) return res.status(404).json({ error: 'No matching papers found.' });

    const draft = await generateDraftContent(project, papers, Boolean(regenerate));
    const row = await saveReport({ userId: req.user.id, projectId: project.id, paperIds: papers.map((p) => p.id), content: draft });
    const stage = await advanceStage(project.id, 'create');

    res.json({ reportId: row.id, createdAt: row.created_at, draft, sources: toSourceRefs(papers), stage });
  } catch (err) {
    next(err);
  }
}

// GET /api/ai/draft/:projectId — most recent saved draft/report for a project.
async function getProjectDraft(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'Invalid project ID.' });
    await requireOwnedProject(projectId, req.user.id);

    const { rows } = await query(
      `SELECT * FROM reports WHERE project_id = $1 AND user_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [projectId, req.user.id]
    );
    if (rows.length === 0) return res.json({ draft: null });

    const row = rows[0];
    const papers = await fetchPapersByIds(row.paper_ids);
    res.json({ reportId: row.id, createdAt: row.created_at, draft: N.normalizeDraft(row.content, papers), sources: toSourceRefs(papers) });
  } catch (err) {
    next(err);
  }
}

// Optional AI action: given a rough topic, suggest candidate research questions.
async function suggestResearchQuestion(req, res, next) {
  try {
    const { topic, objective, researchType } = req.body || {};
    if (!topic || typeof topic !== 'string' || topic.trim().length < 3) {
      return res.status(400).json({ error: 'A research topic (at least 3 characters) is required.' });
    }
    const { system, prompt } = buildResearchQuestionPrompt({ topic: topic.trim().slice(0, 2000), objective, researchType });
    const suggestion = await callAIJson({
      system,
      prompt,
      maxTokens: 700,
      normalize: N.normalizeSuggestion,
      validate: (v) => {
        if (v.questions.length === 0) throw new Error('No usable questions.');
      },
    });
    res.json({ suggestion });
  } catch (err) {
    next(err);
  }
}

// POST /api/ai/analyze-sources
async function analyzeProjectSources(req, res, next) {
  try {
    const { projectId, regenerate } = req.body || {};
    if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'A valid projectId is required.' });
    const project = await requireOwnedProject(projectId, req.user.id);

    const papers = await requireAnalyzableSources(project.id);
    const intelligence = await generateIntelligence(project, papers, Boolean(regenerate));
    const row = await saveComparison({
      userId: req.user.id,
      projectId: project.id,
      paperIds: papers.map((p) => p.id),
      kind: 'research_intelligence',
      content: intelligence,
    });
    const stage = await advanceStage(project.id, 'analyze');

    res.json({ intelligenceId: row.id, createdAt: row.created_at, intelligence, sources: toSourceRefs(papers), stage });
  } catch (err) {
    next(err);
  }
}

async function getProjectIntelligence(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'Invalid project ID.' });
    await requireOwnedProject(projectId, req.user.id);

    const row = await getLatestResult(projectId, req.user.id, 'research_intelligence');
    if (!row) return res.json({ intelligence: null });

    const papers = await fetchPapersByIds(row.paper_ids);
    res.json({
      intelligenceId: row.id,
      createdAt: row.created_at,
      intelligence: N.normalizeIntelligence(row.content, papers.length),
      sources: toSourceRefs(papers),
    });
  } catch (err) {
    next(err);
  }
}

async function identifyResearchGaps(req, res, next) {
  try {
    const { projectId, regenerate } = req.body || {};
    if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'A valid projectId is required.' });
    const project = await requireOwnedProject(projectId, req.user.id);

    const papers = await requireAnalyzableSources(project.id);
    const priorRow = await getLatestResult(project.id, req.user.id, 'research_intelligence');
    const prior = priorRow ? N.normalizeIntelligence(priorRow.content, priorRow.paper_ids.length) : null;

    const gaps = await generateGaps(project, papers, prior, Boolean(regenerate));
    const row = await saveComparison({
      userId: req.user.id,
      projectId: project.id,
      paperIds: papers.map((p) => p.id),
      kind: 'research_gap',
      content: gaps,
    });
    const stage = await advanceStage(project.id, 'gaps');

    res.json({ gapsId: row.id, createdAt: row.created_at, gaps, sources: toSourceRefs(papers), stage });
  } catch (err) {
    next(err);
  }
}

async function getProjectGaps(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'Invalid project ID.' });
    await requireOwnedProject(projectId, req.user.id);

    const row = await getLatestResult(projectId, req.user.id, 'research_gap');
    if (!row) return res.json({ gaps: null });

    const papers = await fetchPapersByIds(row.paper_ids);
    res.json({ gapsId: row.id, createdAt: row.created_at, gaps: N.normalizeGaps(row.content, papers.length), sources: toSourceRefs(papers) });
  } catch (err) {
    next(err);
  }
}

async function buildProjectResearchPlan(req, res, next) {
  try {
    const { projectId, regenerate } = req.body || {};
    if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'A valid projectId is required.' });
    const project = await requireOwnedProject(projectId, req.user.id);

    const { gapsRow, papers, gaps } = await requirePlannableGaps(project.id, req.user.id);
    const plan = await generatePlan(project, papers, gaps, Boolean(regenerate));
    const row = await saveComparison({
      userId: req.user.id,
      projectId: project.id,
      paperIds: gapsRow.paper_ids,
      kind: 'research_plan',
      content: plan,
    });
    const stage = await advanceStage(project.id, 'plan');

    res.json({ planId: row.id, createdAt: row.created_at, plan, sources: toSourceRefs(papers), stage });
  } catch (err) {
    next(err);
  }
}

async function getProjectPlan(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'Invalid project ID.' });
    await requireOwnedProject(projectId, req.user.id);

    const row = await getLatestResult(projectId, req.user.id, 'research_plan');
    if (!row) return res.json({ plan: null });

    const papers = await fetchPapersByIds(row.paper_ids);
    res.json({ planId: row.id, createdAt: row.created_at, plan: N.normalizePlan(row.content, papers.length), sources: toSourceRefs(papers) });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------
// Research Copilot (free-form project chat)
// ---------------------------------------------------------------------
const COPILOT_HISTORY_LIMIT = 12; // messages of context sent to the AI

// Everything the copilot prompt needs, fetched in parallel (4 queries).
async function loadCopilotContext(project, userId, historyLimit) {
  const [papers, results, notesResult, historyResult] = await Promise.all([
    fetchSelectedProjectPapers(project.id),
    getLatestResults(project.id, userId, ['research_intelligence', 'research_gap', 'research_plan']),
    query('SELECT title, content FROM notes WHERE project_id = $1 ORDER BY updated_at DESC LIMIT 20', [project.id]),
    query(
      `SELECT role, content FROM (
         SELECT role, content, created_at, id FROM copilot_messages
         WHERE project_id = $1 AND user_id = $2
         ORDER BY created_at DESC, id DESC LIMIT $3
       ) recent ORDER BY created_at ASC, id ASC`,
      [project.id, userId, historyLimit]
    ),
  ]);
  const intel = results.get('research_intelligence');
  const gaps = results.get('research_gap');
  const plan = results.get('research_plan');
  return {
    papers,
    intelligence: intel ? N.normalizeIntelligence(intel.content, intel.paper_ids.length) : null,
    gaps: gaps ? N.normalizeGaps(gaps.content, gaps.paper_ids.length) : null,
    plan: plan ? N.normalizePlan(plan.content, plan.paper_ids.length) : null,
    notes: notesResult.rows,
    history: historyResult.rows,
  };
}

async function copilotMessage(req, res, next) {
  try {
    const { projectId, message } = req.body || {};
    if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'A valid projectId is required.' });
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'A message is required.' });
    }
    const trimmedMessage = message.trim().slice(0, 4000);
    const project = await requireOwnedProject(projectId, req.user.id);

    const ctx = await loadCopilotContext(project, req.user.id, COPILOT_HISTORY_LIMIT);
    const { system, prompt } = buildCopilotPrompt({
      project,
      papers: ctx.papers,
      intelligence: ctx.intelligence,
      gaps: ctx.gaps,
      plan: ctx.plan,
      notes: ctx.notes,
      history: [...ctx.history, { role: 'user', content: trimmedMessage }],
    });

    // Persist the user's message before calling the AI, so it's never lost.
    await insertMessage(project.id, req.user.id, 'user', trimmedMessage);
    const replyText = (await callAI({ system, prompt, maxTokens: 1200 })).trim();
    const reply = await insertMessage(project.id, req.user.id, 'assistant', replyText);

    res.json({ reply });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------
// Research chat kickoff ("What's on your research agenda?")
// ---------------------------------------------------------------------
function deriveChatTitle(topic) {
  const clean = (topic || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'New Research';
  if (clean.length <= 70) return clean;
  return `${clean.slice(0, 67).trim()}...`;
}

function formatSuggestionAsMessage(suggestion) {
  const lines = [
    "That's an interesting direction. Here are a few ways to focus it into an answerable research question:",
    '',
    ...suggestion.questions.map((q, i) => `${i + 1}. ${q}`),
  ];
  if (suggestion.tip) lines.push('', suggestion.tip);
  lines.push('', 'Pick one, tweak it, or tell me your own — then we can search the literature.');
  return lines.join('\n');
}

async function kickoffProject(req, res, next) {
  try {
    const { topic, researchType } = req.body || {};
    if (!topic || typeof topic !== 'string' || topic.trim().length < 3) {
      return res.status(400).json({ error: 'A research topic (at least 3 characters) is required.' });
    }
    if (!isValidResearchType(researchType)) {
      return res.status(400).json({ error: 'Invalid research type.' });
    }
    const trimmedTopic = topic.trim().slice(0, 4000);

    const { rows: projectRows } = await query(
      `INSERT INTO research_projects (user_id, title, description, research_type, stage)
       VALUES ($1, $2, $3, $4, 'define') RETURNING *`,
      [req.user.id, deriveChatTitle(trimmedTopic), trimmedTopic, researchType || null]
    );
    const project = projectRows[0];
    const userMsg = await insertMessage(project.id, req.user.id, 'user', trimmedTopic);

    // The chat already exists at this point. If the AI is unavailable (rate
    // limit, timeout, bad key...) we still open the chat with a helpful
    // message instead of failing the whole request — which previously left an
    // orphaned empty project behind and made every retry create another one.
    let suggestion = null;
    let assistantText;
    let warning = null;
    try {
      const { system, prompt } = buildResearchQuestionPrompt({ topic: trimmedTopic, researchType });
      suggestion = await callAIJson({
        system,
        prompt,
        maxTokens: 700,
        normalize: N.normalizeSuggestion,
        validate: (v) => {
          if (v.questions.length === 0) throw new Error('No usable questions.');
        },
      });
      assistantText = formatSuggestionAsMessage(suggestion);
    } catch (aiErr) {
      console.warn('[kickoff] AI suggestion failed:', aiErr.message);
      warning = aiErr.expose ? aiErr.message : 'The AI could not suggest research questions right now.';
      assistantText =
        "I've started this research chat, but couldn't generate suggested questions just now" +
        `${aiErr.expose ? ` (${aiErr.message.replace(/\.$/, '')})` : ''}. ` +
        'You can tell me your research question directly, or ask me to search the literature, e.g. "find papers about ' +
        `${trimmedTopic.slice(0, 60).replace(/["\n]/g, ' ')}".`;
    }

    const assistantMsg = await insertMessage(project.id, req.user.id, 'assistant', assistantText);
    res.status(201).json({ project, suggestion, warning, messages: [userMsg, assistantMsg] });
  } catch (err) {
    next(err);
  }
}

async function getCopilotHistory(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'Invalid project ID.' });
    await requireOwnedProject(projectId, req.user.id);

    const { rows } = await query(
      `SELECT id, role, content, created_at FROM copilot_messages
       WHERE project_id = $1 AND user_id = $2 ORDER BY created_at ASC, id ASC`,
      [projectId, req.user.id]
    );
    res.json({ messages: rows });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------
// Natural-language intent router — POST /api/ai/chat.
// Every composer message goes through here: classify it (see
// services/intentRouter.js), then perform the matching research action or
// fall back to a normal Research Copilot reply. The user's message is always
// persisted first so nothing is lost if the action fails.
// ---------------------------------------------------------------------
const CHAT_HISTORY_LIMIT = 12;

function resolveIndexes(orderedPapers, indexes) {
  const found = [];
  const invalid = [];
  const seen = new Set();
  for (const n of indexes) {
    if (seen.has(n)) continue;
    seen.add(n);
    const paper = orderedPapers[n - 1];
    if (paper) found.push(paper);
    else invalid.push(n);
  }
  return { found, invalid };
}

function titleList(papers) {
  return papers.map((p) => `"${p.title}"`).join(', ');
}

const plural = (n, one, many) => (n === 1 ? one : many);

async function routeChatMessage(req, res, next) {
  try {
    const { projectId, message, retry } = req.body || {};
    if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'A valid projectId is required.' });
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'A message is required.' });
    }
    const trimmedMessage = message.trim().slice(0, 4000);
    const project = await requireOwnedProject(projectId, req.user.id);
    const userId = req.user.id;

    // Persist the user's turn immediately — never lost even if the action
    // fails. A client "Retry" of a failed turn re-sends the same text with
    // retry=true; reuse the already-saved message instead of duplicating it.
    let userMessage = null;
    if (retry) {
      const { rows } = await query(
        `SELECT id, role, content, created_at FROM copilot_messages
         WHERE project_id = $1 AND user_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1`,
        [project.id, userId]
      );
      if (rows.length && rows[0].role === 'user' && rows[0].content === trimmedMessage) userMessage = toMessageDto(rows[0]);
    }
    if (!userMessage) userMessage = await insertMessage(project.id, userId, 'user', trimmedMessage);

    const classification = classifyIntent(trimmedMessage);
    const send = (intent, assistantMessage, extra = {}) =>
      res.json({ intent, userMessage, assistantMessage, event: null, ...extra });
    const say = async (intent, text, extra) => send(intent, await insertMessage(project.id, userId, 'assistant', text), extra);

    try {
      switch (classification.intent) {
        // -------------------------------------------------------------
        case 'search':
        case 'find_similar': {
          let q;
          let lead;
          if (classification.intent === 'find_similar') {
            const ordered = await fetchOrderedProjectPapers(project.id);
            const { found } = resolveIndexes(ordered, classification.sourceNumbers);
            if (found.length === 0) {
              return await say('find_similar', `I couldn't find source [${classification.sourceNumbers[0]}] in this chat yet — search for some papers first.`);
            }
            q = found[0].title;
            lead = `Looking for papers similar to [${classification.sourceNumbers[0]}] "${found[0].title}"...`;
          } else {
            q = classification.query;
            if (classification.isLikelyRefinement) {
              const { rows: lastSearch } = await query(
                `SELECT query FROM project_searches WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
                [project.id]
              );
              if (lastSearch.length) q = `${lastSearch[0].query} ${q}`.trim();
            }
            lead = `Searching academic literature for "${q}"...`;
          }

          const result = await openalex.searchWorks({ query: q });
          const count = result.results.length;
          const summary =
            count === 0
              ? `${lead}\nI couldn't find any papers for that. Try a different phrasing or a broader topic.`
              : classification.intent === 'find_similar'
              ? `${lead}\nI found ${count} related ${plural(count, 'paper', 'papers')}.`
              : `${lead}\nI found ${count} potentially relevant ${plural(count, 'paper', 'papers')}.`;

          const { message: assistantMessage, result: linked } = await withLeadMessage(project.id, userId, summary, () =>
            count === 0 ? result : linkSearchResultsToProject({ projectId: project.id, userId, q, result })
          );
          const papers = linked.results || [];
          const stage = count === 0 ? project.stage : await advanceStage(project.id, 'discover');
          return send('search', assistantMessage, {
            event: { type: 'search', id: `search-live-${Date.now()}`, createdAt: new Date().toISOString(), query: q, papers },
            stage,
          });
        }

        // -------------------------------------------------------------
        case 'top_n': {
          const ordered = await fetchOrderedProjectPapers(project.id);
          if (ordered.length === 0) {
            return await say('top_n', "You haven't discovered any papers in this chat yet — search for a topic first.");
          }
          const ranked = [...ordered].sort((a, b) => (b.citedByCount || 0) - (a.citedByCount || 0)).slice(0, classification.count);
          const assistantMessage = await insertMessage(
            project.id, userId, 'assistant',
            `Here are the ${ranked.length} most-cited papers discovered in this chat so far.`
          );
          return send('top_n', assistantMessage, {
            event: { type: 'search', id: `search-live-${Date.now()}`, createdAt: new Date().toISOString(), query: `Top ${ranked.length} most-cited papers`, papers: ranked },
          });
        }

        // -------------------------------------------------------------
        case 'show_selected': {
          const selected = await fetchSelectedProjectPapers(project.id);
          if (selected.length === 0) {
            return await say('show_selected', 'No sources are selected yet. Select papers from a search, or ask me to find some.');
          }
          const assistantMessage = await insertMessage(
            project.id, userId, 'assistant',
            `You have ${selected.length} selected ${plural(selected.length, 'source', 'sources')}.`
          );
          return send('show_selected', assistantMessage, {
            event: {
              type: 'search', id: `search-live-${Date.now()}`, createdAt: new Date().toISOString(),
              query: 'Your selected sources', papers: selected.map((p) => ({ ...p, selectedForAnalysis: true })),
            },
          });
        }

        // -------------------------------------------------------------
        case 'select':
        case 'deselect': {
          const ordered = await fetchOrderedProjectPapers(project.id);
          const { found, invalid } = resolveIndexes(ordered, classification.sourceNumbers);
          if (found.length === 0) {
            return await say(
              classification.intent,
              `I couldn't find ${invalid.length > 1 ? 'those source numbers' : 'that source number'} (${invalid.join(', ')}) in this chat. Source numbers refer to papers already shown here.`
            );
          }
          const willSelect = classification.intent === 'select';
          const foundIds = found.map((p) => p.id);
          let selectionUpdates;

          if (willSelect && classification.exclusive) {
            // "Use only papers 1, 4 and 7" — deselect everything else in one statement.
            await query(
              `UPDATE project_papers SET selected_for_analysis = (paper_id = ANY($2::int[])) WHERE project_id = $1`,
              [project.id, foundIds]
            );
            selectionUpdates = ordered.map((p) => ({ paperId: p.id, selected: foundIds.includes(p.id) }));
          } else {
            await query(
              `UPDATE project_papers SET selected_for_analysis = $3 WHERE project_id = $1 AND paper_id = ANY($2::int[])`,
              [project.id, foundIds, willSelect]
            );
            selectionUpdates = foundIds.map((paperId) => ({ paperId, selected: willSelect }));
          }

          const verb = willSelect ? 'Selected' : 'Removed from selection:';
          const summary =
            invalid.length > 0
              ? `${verb} ${titleList(found)}. Couldn't find source number${invalid.length > 1 ? 's' : ''} ${invalid.join(', ')}.`
              : `${verb} ${titleList(found)}.`;
          return await say(classification.intent, summary, { selectionUpdates });
        }

        // -------------------------------------------------------------
        case 'compare': {
          const ordered = await fetchOrderedProjectPapers(project.id);
          const { found, invalid } = resolveIndexes(ordered, classification.sourceNumbers);
          if (found.length < 2) {
            return await say(
              'compare',
              `I need two valid source numbers to compare. ${invalid.length ? `Couldn't find source ${invalid.join(', ')}.` : 'Try, for example, "compare papers 1 and 2".'}`
            );
          }
          const comparison = await generateComparison(found, 2000, false);
          const bullets = (items) => items.map((s) => `- ${s}`);
          const lines = [
            `Comparing [${classification.sourceNumbers[0]}] "${found[0].title}" and [${classification.sourceNumbers[1]}] "${found[1].title}":`,
            '', '**Similarities**', ...bullets(comparison.similarities),
            '', '**Differences**', ...bullets(comparison.differences),
          ];
          if (comparison.contradictions.length) lines.push('', '**Contradictions**', ...bullets(comparison.contradictions));
          return await say('compare', lines.join('\n'));
        }

        // -------------------------------------------------------------
        case 'analyze': {
          const papers = await requireAnalyzableSources(project.id);
          const intelligence = await generateIntelligence(project, papers, false);
          const { message: assistantMessage, result: row } = await withLeadMessage(
            project.id, userId,
            `Analyzing ${papers.length} selected ${plural(papers.length, 'paper', 'papers')}...\nHere's what I found.`,
            () => saveComparison({ userId, projectId: project.id, paperIds: papers.map((p) => p.id), kind: 'research_intelligence', content: intelligence })
          );
          const stage = await advanceStage(project.id, 'analyze');
          return send('analyze', assistantMessage, {
            event: { type: 'intelligence', id: `intel-${row.id}`, createdAt: row.created_at, content: intelligence, sources: toSourceRefs(papers) },
            stage,
          });
        }

        // -------------------------------------------------------------
        case 'gaps': {
          const papers = await requireAnalyzableSources(project.id);
          const priorRow = await getLatestResult(project.id, userId, 'research_intelligence');
          const prior = priorRow ? N.normalizeIntelligence(priorRow.content, priorRow.paper_ids.length) : null;
          const gaps = await generateGaps(project, papers, prior, false);
          const { message: assistantMessage, result: row } = await withLeadMessage(
            project.id, userId,
            `Looking for research gaps across ${papers.length} selected ${plural(papers.length, 'source', 'sources')}...`,
            () => saveComparison({ userId, projectId: project.id, paperIds: papers.map((p) => p.id), kind: 'research_gap', content: gaps })
          );
          const stage = await advanceStage(project.id, 'gaps');
          return send('gaps', assistantMessage, {
            event: { type: 'gaps', id: `gaps-${row.id}`, createdAt: row.created_at, content: gaps, sources: toSourceRefs(papers) },
            stage,
          });
        }

        // -------------------------------------------------------------
        case 'plan': {
          const { gapsRow, papers, gaps } = await requirePlannableGaps(project.id, userId);
          const plan = await generatePlan(project, papers, gaps, false);
          const { message: assistantMessage, result: row } = await withLeadMessage(
            project.id, userId, 'Building a research plan from your identified gaps...',
            () => saveComparison({ userId, projectId: project.id, paperIds: gapsRow.paper_ids, kind: 'research_plan', content: plan })
          );
          const stage = await advanceStage(project.id, 'plan');
          return send('plan', assistantMessage, {
            event: { type: 'plan', id: `plan-${row.id}`, createdAt: row.created_at, content: plan, sources: toSourceRefs(papers) },
            stage,
          });
        }

        // -------------------------------------------------------------
        case 'draft': {
          let papers;
          if (classification.sourceNumbers && classification.sourceNumbers.length) {
            const ordered = await fetchOrderedProjectPapers(project.id);
            papers = resolveIndexes(ordered, classification.sourceNumbers).found;
          } else {
            papers = await fetchSelectedProjectPapers(project.id);
          }
          if (papers.length === 0) {
            return await say('draft', 'I need at least one source to write from. Select some papers, or tell me which source numbers to use.');
          }
          if (papers.length > MAX_SOURCES_PER_ANALYSIS) {
            return await say('draft', `That's ${papers.length} sources — drafting supports up to ${MAX_SOURCES_PER_ANALYSIS} at a time. Deselect some and try again.`);
          }
          const draft = await generateDraftContent(project, papers, false);
          const { message: assistantMessage, result: row } = await withLeadMessage(
            project.id, userId,
            `Drafting from ${papers.length} ${plural(papers.length, 'source', 'sources')}...`,
            () => saveReport({ userId, projectId: project.id, paperIds: papers.map((p) => p.id), content: draft })
          );
          const stage = await advanceStage(project.id, 'create');
          return send('draft', assistantMessage, {
            event: { type: 'draft', id: `report-${row.id}`, createdAt: row.created_at, content: draft, sources: toSourceRefs(papers) },
            stage,
          });
        }

        // -------------------------------------------------------------
        case 'chat':
        default: {
          const ctx = await loadCopilotContext(project, userId, CHAT_HISTORY_LIMIT + 1);
          const { system, prompt } = buildCopilotPrompt({
            project,
            papers: ctx.papers,
            intelligence: ctx.intelligence,
            gaps: ctx.gaps,
            plan: ctx.plan,
            notes: ctx.notes,
            history: ctx.history,
          });
          const replyText = (await callAI({ system, prompt, maxTokens: 1200 })).trim();
          return await say('chat', replyText);
        }
      }
    } catch (actionErr) {
      // Expected "you can't do that yet" problems (no sources selected, too
      // many sources, ...) are part of the conversation, not HTTP failures.
      if (actionErr.expose && actionErr.status === 400) {
        return await say(classification.intent, actionErr.message);
      }
      throw actionErr;
    }
  } catch (err) {
    next(err);
  }
}

module.exports = {
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
  // Exported for projectController's conversation timeline.
  fetchPapersByIds,
  toSourceRefs,
};
