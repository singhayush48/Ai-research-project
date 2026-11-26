// Research-journey stage handling, done on the SERVER so the client no longer
// needs an extra PUT /projects/:id round trip (with a full copy of every
// project field) after each research step.
const { query } = require('../db/pool');
const { RESEARCH_STAGES } = require('./validate');

// Moves a project forward to `stage` — never backwards. Returns the
// project's stage after the call (the new one if it advanced, otherwise the
// existing one), or null if the project doesn't exist.
async function advanceStage(projectId, stage) {
  if (!RESEARCH_STAGES.includes(stage)) return null;
  const { rows } = await query(
    `UPDATE research_projects
        SET stage = $2, updated_at = NOW()
      WHERE id = $1
        AND array_position($3::text[], stage::text) < array_position($3::text[], $2::text)
      RETURNING stage`,
    [projectId, stage, RESEARCH_STAGES]
  );
  if (rows.length) return rows[0].stage;
  const current = await query('SELECT stage FROM research_projects WHERE id = $1', [projectId]);
  return current.rows.length ? current.rows[0].stage : null;
}

module.exports = { advanceStage };
