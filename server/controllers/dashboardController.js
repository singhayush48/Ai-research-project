const { query } = require('../db/pool');

async function getDashboard(req, res, next) {
  try {
    const userId = req.user.id;

    const [projectsCount, savedCount, analyzedCount, recentProjects, recentNotes, recentAnalyses] =
      await Promise.all([
        query('SELECT COUNT(*) FROM research_projects WHERE user_id = $1', [userId]),
        query('SELECT COUNT(*) FROM saved_papers WHERE user_id = $1', [userId]),
        query('SELECT COUNT(DISTINCT paper_id) FROM analyses WHERE user_id = $1', [userId]),
        query(
          'SELECT id, title, updated_at FROM research_projects WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 5',
          [userId]
        ),
        query(
          'SELECT id, title, updated_at FROM notes WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 5',
          [userId]
        ),
        query(
          `SELECT a.id, a.created_at, p.title AS paper_title
           FROM analyses a JOIN papers p ON p.id = a.paper_id
           WHERE a.user_id = $1 ORDER BY a.created_at DESC LIMIT 5`,
          [userId]
        ),
      ]);

    res.json({
      stats: {
        totalProjects: Number(projectsCount.rows[0].count),
        savedPapers: Number(savedCount.rows[0].count),
        analyzedPapers: Number(analyzedCount.rows[0].count),
      },
      recentProjects: recentProjects.rows,
      recentActivity: [
        ...recentNotes.rows.map((n) => ({ type: 'note', ...n })),
        ...recentAnalyses.rows.map((a) => ({ type: 'analysis', ...a })),
      ]
        .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
        .slice(0, 8),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboard };
