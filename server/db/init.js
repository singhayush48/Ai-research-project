// Idempotent database initialization.
// The schema is additive and uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS,
// so it is safe to run on every startup without deleting data.
//
// With a shared (central) database several teammates may start their server
// at the same moment, so the schema is applied inside ONE transaction guarded
// by an advisory lock: the first server applies it, the others wait and then
// find nothing left to do. This also works behind Supabase's pooler.
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

const SCHEMA_LOCK_ID = 727301; // arbitrary constant shared by all copies of the app

async function initializeDatabase() {
  const schemaPath = path.resolve(__dirname, '../../database/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK_ID]);
    await client.query(schema);
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
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
