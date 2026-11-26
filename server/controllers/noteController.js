const { query } = require('../db/pool');
const { validateNote, isPositiveInt } = require('../utils/validate');

async function listNotes(req, res, next) {
  try {
    const { projectId } = req.query;
    let sql = 'SELECT * FROM notes WHERE user_id = $1';
    const params = [req.user.id];

    if (projectId) {
      if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'Invalid projectId.' });
      sql += ' AND project_id = $2';
      params.push(projectId);
    }
    sql += ' ORDER BY updated_at DESC';

    const { rows } = await query(sql, params);
    res.json({ notes: rows });
  } catch (err) {
    next(err);
  }
}

async function createNote(req, res, next) {
  try {
    const { title, content, projectId, paperId } = req.body || {};
    const validationError = validateNote({ content });
    if (validationError) return res.status(400).json({ error: validationError });

    // A note may only be attached to a project the caller owns.
    if (projectId) {
      if (!isPositiveInt(projectId)) return res.status(400).json({ error: 'Invalid projectId.' });
      const owned = await query('SELECT id FROM research_projects WHERE id = $1 AND user_id = $2', [projectId, req.user.id]);
      if (owned.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });
    }
    if (paperId && !isPositiveInt(paperId)) return res.status(400).json({ error: 'Invalid paperId.' });

    const { rows } = await query(
      `INSERT INTO notes (user_id, project_id, paper_id, title, content)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, projectId || null, paperId || null, title || null, content.trim()]
    );
    res.status(201).json({ note: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateNote(req, res, next) {
  try {
    const { id } = req.params;
    if (!isPositiveInt(id)) return res.status(400).json({ error: 'Invalid note ID.' });

    const { title, content } = req.body || {};
    const validationError = validateNote({ content });
    if (validationError) return res.status(400).json({ error: validationError });

    // Only touch the title when the client actually sent one — editing just
    // the body used to silently erase the note's title.
    const { rows } = await query(
      `UPDATE notes SET title = CASE WHEN $5::boolean THEN $1 ELSE title END, content = $2, updated_at = NOW()
       WHERE id = $3 AND user_id = $4 RETURNING *`,
      [title || null, content.trim(), id, req.user.id, title !== undefined]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Note not found.' });

    res.json({ note: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function deleteNote(req, res, next) {
  try {
    const { id } = req.params;
    if (!isPositiveInt(id)) return res.status(400).json({ error: 'Invalid note ID.' });

    const { rows } = await query('DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id', [
      id,
      req.user.id,
    ]);
    if (rows.length === 0) return res.status(404).json({ error: 'Note not found.' });

    res.json({ message: 'Note deleted.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { listNotes, createNote, updateNote, deleteNote };
