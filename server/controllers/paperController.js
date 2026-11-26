const { query, withTransaction } = require('../db/pool');
const openalex = require('../services/openalex');
const { isPositiveInt } = require('../utils/validate');
const { advanceStage } = require('../utils/stage');
const { paperCache } = require('../utils/paperCache');

// GET /api/papers/search?q=...&page=...&projectId=...
//
// projectId is optional. When present (and owned by the requesting user),
// this is a "search literature inside this research chat" call, not a
// standalone Discover search:
//   1. Every OpenAlex result is upserted into the local `papers` table (so
//      it has a stable local id even before the user selects it).
//   2. Each is linked into `project_papers` for this project (NOT selected
//      for analysis yet). Already-linked papers are left exactly as they
//      are (ON CONFLICT DO NOTHING), so a repeat search never un-selects
//      something the user already chose.
//   3. The search itself is logged to `project_searches` so it reappears in
//      the chat timeline on refresh/return.
// Pass 10: steps 1-3 are now ONE transaction with 4 statements total
// (previously ~2 queries per paper, i.e. ~45 round trips for 20 results).
async function searchPapers(req, res, next) {
  try {
    const q = (req.query.q || '').toString().trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.perPage, 10) || 20));
    const projectId = req.query.projectId;

    if (!q) return res.status(400).json({ error: 'Search query parameter "q" is required.' });

    // Verify project ownership BEFORE spending an OpenAlex call.
    let ownsProject = false;
    if (projectId !== undefined && projectId !== '') {
      if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'Invalid projectId.' });
      const projectCheck = await query('SELECT id FROM research_projects WHERE id = $1 AND user_id = $2', [
        projectId,
        req.user.id,
      ]);
      if (projectCheck.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });
      ownsProject = true;
    }

    const result = await openalex.searchWorks({ query: q, page, perPage });

    if (result.results.length === 0) {
      return res.json({ ...result, message: 'No results found for this query.' });
    }

    if (ownsProject) {
      await linkSearchResultsToProject({ projectId: Number(projectId), userId: req.user.id, q, result });
      const stage = await advanceStage(Number(projectId), 'discover');
      return res.json({ ...result, stage });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}

const clip = (value, n) => (typeof value === 'string' ? value.slice(0, n) : value ?? null);

// Batch upsert of OpenAlex papers. One statement, any number of rows.
// Returns Map<openalexId, localId>. Papers without an OpenAlex id can't be
// de-duplicated safely and are skipped by callers via the returned map.
async function upsertManyPapers(run, papers) {
  const unique = new Map();
  for (const p of papers) {
    if (p && p.openalexId && !unique.has(p.openalexId)) unique.set(p.openalexId, p);
  }
  if (unique.size === 0) return new Map();
  const list = [...unique.values()];

  const { rows } = await run(
    `INSERT INTO papers (openalex_id, title, authors, abstract, publication_year, source_name, doi, paper_url, cited_by_count, raw_metadata)
     SELECT a, b, c, d, e, f, g, h, i, j::jsonb
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[], $6::text[], $7::text[], $8::text[], $9::int[], $10::text[])
          AS t(a, b, c, d, e, f, g, h, i, j)
     ON CONFLICT (openalex_id) DO UPDATE SET
       title = EXCLUDED.title,
       authors = EXCLUDED.authors,
       abstract = COALESCE(EXCLUDED.abstract, papers.abstract),
       publication_year = EXCLUDED.publication_year,
       source_name = EXCLUDED.source_name,
       doi = EXCLUDED.doi,
       paper_url = EXCLUDED.paper_url,
       cited_by_count = EXCLUDED.cited_by_count
     RETURNING id, openalex_id`,
    [
      list.map((p) => clip(p.openalexId, 255)),
      list.map((p) => p.title || 'Untitled'),
      list.map((p) => JSON.stringify(p.authors || [])),
      list.map((p) => p.abstract ?? null),
      list.map((p) => (Number.isInteger(p.publicationYear) ? p.publicationYear : null)),
      list.map((p) => clip(p.sourceName, 500)),
      list.map((p) => clip(p.doi, 255)),
      list.map((p) => p.paperUrl ?? null),
      list.map((p) => (Number.isInteger(p.citedByCount) ? p.citedByCount : null)),
      list.map((p) => JSON.stringify(p)),
    ]
  );
  const map = new Map(rows.map((r) => [r.openalex_id, r.id]));
  rows.forEach((r) => paperCache.delete(r.id));
  return map;
}

// Shared by searchPapers (HTTP route) and the conversational intent router.
// Annotates each result with its local id + current selectedForAnalysis flag
// and logs the search so it reappears in the chat timeline on reload.
// Mutates `result.results` in place (dropping any result that couldn't be
// stored) and returns `result`.
async function linkSearchResultsToProject({ projectId, userId, q, result }) {
  await withTransaction(async (run) => {
    const idMap = await upsertManyPapers(run, result.results);
    result.results = result.results.filter((p) => idMap.has(p.openalexId));
    result.results.forEach((p) => {
      p.id = idMap.get(p.openalexId);
    });
    // De-dupe in case OpenAlex returned the same work twice on one page.
    const seen = new Set();
    result.results = result.results.filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
    const linkedIds = result.results.map((p) => p.id);
    if (linkedIds.length === 0) return;

    await run(
      `INSERT INTO project_papers (project_id, paper_id, selected_for_analysis)
       SELECT $1::int, x, FALSE FROM unnest($2::int[]) WITH ORDINALITY AS u(x, ord) ORDER BY ord
       ON CONFLICT (project_id, paper_id) DO NOTHING`,
      [projectId, linkedIds]
    );

    const currentSelection = await run(
      'SELECT paper_id, selected_for_analysis FROM project_papers WHERE project_id = $1 AND paper_id = ANY($2::int[])',
      [projectId, linkedIds]
    );
    const selectedMap = new Map(currentSelection.rows.map((r) => [r.paper_id, r.selected_for_analysis]));
    result.results.forEach((paper) => {
      paper.selectedForAnalysis = Boolean(selectedMap.get(paper.id));
    });

    await run(`INSERT INTO project_searches (project_id, user_id, query, paper_ids) VALUES ($1, $2, $3, $4)`, [
      projectId,
      userId,
      q,
      linkedIds,
    ]);
  });
  return result;
}

// Runs an OpenAlex search and links the results into a project in one call.
async function performProjectSearch({ projectId, userId, q, page = 1, perPage = 20 }) {
  const result = await openalex.searchWorks({ query: q, page, perPage });
  if (result.results.length === 0) return result;
  return linkSearchResultsToProject({ projectId, userId, q, result });
}

// Ensures a single paper (identified by OpenAlex id) exists in our local DB.
// Returns the local papers.id row.
async function upsertPaperFromOpenAlex(openalexPaper) {
  const { rows } = await query(
    `INSERT INTO papers (openalex_id, title, authors, abstract, publication_year, source_name, doi, paper_url, cited_by_count, raw_metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (openalex_id) DO UPDATE SET
       title = EXCLUDED.title,
       authors = EXCLUDED.authors,
       abstract = COALESCE(EXCLUDED.abstract, papers.abstract),
       publication_year = EXCLUDED.publication_year,
       source_name = EXCLUDED.source_name,
       doi = EXCLUDED.doi,
       paper_url = EXCLUDED.paper_url,
       cited_by_count = EXCLUDED.cited_by_count
     RETURNING *`,
    [
      clip(openalexPaper.openalexId, 255),
      openalexPaper.title || 'Untitled',
      JSON.stringify(openalexPaper.authors || []),
      openalexPaper.abstract ?? null,
      openalexPaper.publicationYear ?? null,
      clip(openalexPaper.sourceName, 500),
      clip(openalexPaper.doi, 255),
      openalexPaper.paperUrl ?? null,
      openalexPaper.citedByCount ?? null,
      JSON.stringify(openalexPaper),
    ]
  );
  paperCache.delete(rows[0].id);
  return rows[0];
}

// GET /api/papers/:id  — id can be a local numeric ID, or an OpenAlex ID
// (e.g. W2741809807) which will be fetched fresh from OpenAlex if not yet stored.
async function getPaper(req, res, next) {
  try {
    const { id } = req.params;

    if (isPositiveInt(id)) {
      const { rows } = await query('SELECT * FROM papers WHERE id = $1', [id]);
      if (rows.length > 0) return res.json({ paper: rows[0] });
    }

    // Fall back to treating :id as an OpenAlex identifier. Stored ids are the
    // full URL form (https://openalex.org/W123); accept the short form too.
    const shortId = id.startsWith('http') ? id.split('/').pop() : id;
    const existing = await query('SELECT * FROM papers WHERE openalex_id = $1 OR openalex_id = $2', [
      id,
      `https://openalex.org/${shortId}`,
    ]);
    if (existing.rows.length > 0) return res.json({ paper: existing.rows[0] });

    const fromApi = await openalex.getWorkById(id);
    const saved = await upsertPaperFromOpenAlex(fromApi);
    res.json({ paper: saved });
  } catch (err) {
    next(err);
  }
}

async function savePaper(req, res, next) {
  try {
    const { openalexPaper, paperId } = req.body || {};
    let localPaperId = paperId;

    if (!localPaperId && openalexPaper) {
      const saved = await upsertPaperFromOpenAlex(openalexPaper);
      localPaperId = saved.id;
    }

    if (!isPositiveInt(localPaperId)) {
      return res.status(400).json({ error: 'A valid paperId or openalexPaper object is required.' });
    }

    await query(
      `INSERT INTO saved_papers (user_id, paper_id) VALUES ($1, $2)
       ON CONFLICT (user_id, paper_id) DO NOTHING`,
      [req.user.id, localPaperId]
    );

    res.status(201).json({ message: 'Paper saved.', paperId: localPaperId });
  } catch (err) {
    next(err);
  }
}

async function removeSavedPaper(req, res, next) {
  try {
    const { id } = req.params;
    if (!isPositiveInt(id)) return res.status(400).json({ error: 'Invalid paper ID.' });

    await query('DELETE FROM saved_papers WHERE user_id = $1 AND paper_id = $2', [req.user.id, id]);
    res.json({ message: 'Paper removed from saved list.' });
  } catch (err) {
    next(err);
  }
}

async function listSavedPapers(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT p.* FROM papers p
       JOIN saved_papers sp ON sp.paper_id = p.id
       WHERE sp.user_id = $1
       ORDER BY sp.created_at DESC`,
      [req.user.id]
    );
    res.json({ papers: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  searchPapers,
  getPaper,
  savePaper,
  removeSavedPaper,
  listSavedPapers,
  upsertPaperFromOpenAlex,
  linkSearchResultsToProject,
  performProjectSearch,
};
