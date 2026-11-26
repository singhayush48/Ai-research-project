const { query } = require('../db/pool');
const { validateProject, isPositiveInt, isValidResearchType, isValidStage } = require('../utils/validate');
const { upsertPaperFromOpenAlex } = require('./paperController');
const { fetchPapersByIds, toSourceRefs } = require('./aiController');
const N = require('../services/normalizers');

async function listProjects(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM project_papers pp WHERE pp.project_id = p.id) AS paper_count
       FROM research_projects p
       WHERE p.user_id = $1
       ORDER BY p.updated_at DESC`,
      [req.user.id]
    );
    res.json({ projects: rows });
  } catch (err) {
    next(err);
  }
}

async function createProject(req, res, next) {
  try {
    const { title, researchQuestion, description, notes, researchObjective, researchType } =
      req.body || {};
    const validationError = validateProject({ title });
    if (validationError) return res.status(400).json({ error: validationError });
    if (!isValidResearchType(researchType)) {
      return res.status(400).json({ error: 'Invalid research type.' });
    }

    // Projects are normally created automatically at the end of the guided
    // "New Research" onboarding flow (see aiController's suggest-question
    // helper for the optional AI-assisted step before this). Manual
    // creation (e.g. from the Projects list) is still supported and simply
    // leaves the optional fields empty.
    const { rows } = await query(
      `INSERT INTO research_projects
         (user_id, title, research_question, description, notes, research_objective, research_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        req.user.id,
        title.trim(),
        researchQuestion || null,
        description || null,
        notes || null,
        researchObjective || null,
        researchType || null,
      ]
    );
    res.status(201).json({ project: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function getProject(req, res, next) {
  try {
    const { id } = req.params;
    if (!isPositiveInt(id)) return res.status(400).json({ error: 'Invalid project ID.' });

    const projectResult = await query(
      'SELECT * FROM research_projects WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    const papersResult = await query(
      `SELECT pap.*, pp.selected_for_analysis,
              EXISTS(SELECT 1 FROM analyses a WHERE a.paper_id = pap.id AND a.user_id = $2) AS analyzed
       FROM papers pap
       JOIN project_papers pp ON pp.paper_id = pap.id
       WHERE pp.project_id = $1
       ORDER BY pp.created_at ASC, pp.id ASC`,
      [id, req.user.id]
    );

    const notesResult = await query(
      'SELECT * FROM notes WHERE project_id = $1 ORDER BY updated_at DESC',
      [id]
    );

    res.json({ project: projectResult.rows[0], papers: papersResult.rows, notes: notesResult.rows });
  } catch (err) {
    next(err);
  }
}

async function updateProject(req, res, next) {
  try {
    const { id } = req.params;
    if (!isPositiveInt(id)) return res.status(400).json({ error: 'Invalid project ID.' });

    const { title, researchQuestion, description, notes, researchObjective, researchType, stage } =
      req.body || {};
    const validationError = validateProject({ title });
    if (validationError) return res.status(400).json({ error: validationError });
    if (!isValidResearchType(researchType)) {
      return res.status(400).json({ error: 'Invalid research type.' });
    }
    if (stage !== undefined && !isValidStage(stage)) {
      return res.status(400).json({ error: 'Invalid research stage.' });
    }

    const { rows } = await query(
      `UPDATE research_projects
       SET title = $1, research_question = $2, description = $3, notes = $4,
           research_objective = $5, research_type = $6,
           stage = COALESCE($7, stage), updated_at = NOW()
       WHERE id = $8 AND user_id = $9 RETURNING *`,
      [
        title.trim(),
        researchQuestion || null,
        description || null,
        notes || null,
        researchObjective || null,
        researchType || null,
        stage || null,
        id,
        req.user.id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found.' });

    res.json({ project: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function deleteProject(req, res, next) {
  try {
    const { id } = req.params;
    if (!isPositiveInt(id)) return res.status(400).json({ error: 'Invalid project ID.' });

    const { rows } = await query(
      'DELETE FROM research_projects WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found.' });

    res.json({ message: 'Project deleted.' });
  } catch (err) {
    next(err);
  }
}

// Links a paper to a project. Accepts either a local `paperId` (paper
// already saved/linked before, e.g. from Sources) or a raw `openalexPaper`
// object straight from a Discover search result (upserted into the local
// `papers` table first, same as savePaper does). `selected` controls the
// project_papers.selected_for_analysis flag (defaults to true — adding a
// paper from Discover is itself the "select" action); calling this again
// with a different `selected` value re-toggles it without duplicating rows.
async function addPaperToProject(req, res, next) {
  try {
    const { id } = req.params;
    if (!isPositiveInt(id)) return res.status(400).json({ error: 'Invalid project ID.' });

    const { paperId, openalexPaper, selected } = req.body || {};

    const projectCheck = await query(
      'SELECT id FROM research_projects WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (projectCheck.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });

    let localPaperId = paperId;
    if (!isPositiveInt(localPaperId) && openalexPaper) {
      const saved = await upsertPaperFromOpenAlex(openalexPaper);
      localPaperId = saved.id;
    }
    if (!isPositiveInt(localPaperId)) {
      return res.status(400).json({ error: 'A valid paperId or openalexPaper object is required.' });
    }

    const selectedForAnalysis = selected === undefined ? true : Boolean(selected);

    await query(
      `INSERT INTO project_papers (project_id, paper_id, selected_for_analysis)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, paper_id) DO UPDATE SET selected_for_analysis = EXCLUDED.selected_for_analysis`,
      [id, localPaperId, selectedForAnalysis]
    );
    res
      .status(201)
      .json({ message: 'Paper added to project.', paperId: localPaperId, selected: selectedForAnalysis });
  } catch (err) {
    next(err);
  }
}

async function removePaperFromProject(req, res, next) {
  try {
    const { id, paperId } = req.params;
    if (!isPositiveInt(id) || !isPositiveInt(paperId)) {
      return res.status(400).json({ error: 'Invalid project or paper ID.' });
    }

    const projectCheck = await query(
      'SELECT id FROM research_projects WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (projectCheck.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });

    await query('DELETE FROM project_papers WHERE project_id = $1 AND paper_id = $2', [id, paperId]);
    res.json({ message: 'Paper removed from project.' });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------
// Conversation timeline — the core of Pass 5. A research chat is not one
// table; it's several (copilot_messages, project_searches, comparisons,
// reports) that were each already the right place to persist their own
// kind of result (see schema.sql comments). This merges them into a single
// chronological feed so the frontend can render "one research chat = one
// persistent research workspace" without knowing about the underlying
// tables at all.
// ---------------------------------------------------------------------
async function getProjectTimeline(req, res, next) {
  try {
    const { id } = req.params;
    if (!isPositiveInt(id)) return res.status(400).json({ error: 'Invalid project ID.' });

    const projectCheck = await query(
      'SELECT id FROM research_projects WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (projectCheck.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });

    const [messagesResult, searchesResult, comparisonsResult, reportsResult, selectionResult] =
      await Promise.all([
        query(
          `SELECT id, role, content, created_at FROM copilot_messages
           WHERE project_id = $1 AND user_id = $2 ORDER BY created_at ASC, id ASC`,
          [id, req.user.id]
        ),
        query(
          `SELECT id, query, paper_ids, created_at FROM project_searches
           WHERE project_id = $1 AND user_id = $2 ORDER BY created_at ASC, id ASC`,
          [id, req.user.id]
        ),
        query(
          `SELECT id, kind, paper_ids, content, created_at FROM comparisons
           WHERE project_id = $1 AND user_id = $2 AND kind IN ('research_intelligence', 'research_gap', 'research_plan')
           ORDER BY created_at ASC, id ASC`,
          [id, req.user.id]
        ),
        query(
          `SELECT id, paper_ids, content, created_at FROM reports
           WHERE project_id = $1 AND user_id = $2 ORDER BY created_at ASC, id ASC`,
          [id, req.user.id]
        ),
        // Live selection state, so search-result cards reflect the CURRENT
        // selected state, not a snapshot from when the search ran.
        query('SELECT paper_id, selected_for_analysis FROM project_papers WHERE project_id = $1', [id]),
      ]);

    const selectionMap = new Map(selectionResult.rows.map((r) => [r.paper_id, r.selected_for_analysis]));

    // ONE paper lookup for the whole timeline (was one query per search /
    // analysis / draft event).
    const allIds = new Set();
    [searchesResult.rows, comparisonsResult.rows, reportsResult.rows].forEach((rows) =>
      rows.forEach((r) => (r.paper_ids || []).forEach((pid) => allIds.add(pid)))
    );
    const loaded = await fetchPapersByIds([...allIds]);
    const paperById = new Map(loaded.map((p) => [p.id, p]));
    const papersFor = (ids) => (ids || []).map((pid) => paperById.get(pid)).filter(Boolean).map((p) => ({ ...p, authors: [...p.authors] }));

    const events = [];

    for (const m of messagesResult.rows) {
      events.push({
        type: m.role === 'user' ? 'user_message' : 'assistant_message',
        id: `message-${m.id}`,
        createdAt: m.created_at,
        content: m.content,
      });
    }

    for (const sr of searchesResult.rows) {
      const papers = papersFor(sr.paper_ids);
      papers.forEach((p) => {
        p.selectedForAnalysis = Boolean(selectionMap.get(p.id));
      });
      events.push({ type: 'search', id: `search-${sr.id}`, createdAt: sr.created_at, query: sr.query, papers });
    }

    const kindToType = { research_intelligence: 'intelligence', research_gap: 'gaps', research_plan: 'plan' };
    for (const c of comparisonsResult.rows) {
      const papers = papersFor(c.paper_ids);
      events.push({
        type: kindToType[c.kind] || c.kind,
        id: `comparison-${c.id}`,
        createdAt: c.created_at,
        // Re-normalized on read: rows saved by older versions may be malformed.
        content: N.normalizeStoredResult(c.kind, c.content, papers.length),
        sources: toSourceRefs(papers),
      });
    }

    for (const r of reportsResult.rows) {
      const papers = papersFor(r.paper_ids);
      events.push({
        type: 'draft',
        id: `report-${r.id}`,
        createdAt: r.created_at,
        content: N.normalizeDraft(r.content, papers),
        sources: toSourceRefs(papers),
      });
    }

    // Stable sort: ties keep insertion order (messages first, then results).
    events.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    res.json({ events });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  addPaperToProject,
  removePaperFromProject,
  getProjectTimeline,
};
