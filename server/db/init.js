// Idempotent local database initialization.
// The schema is additive and uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS,
// so it is safe to run on every development startup without deleting data.
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function initializeDatabase() {
  const schemaPath = path.resolve(__dirname, '../../database/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('[db] Schema verified/initialized.');

  // Housekeeping (best-effort): drop expired sessions and stale AI cache rows.
  try {
    await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
  } catch (err) {
    console.warn('[db] session cleanup skipped:', err.message);
  }
  require('../services/aiService').pruneAiCache();
}

module.exports = { initializeDatabase };
