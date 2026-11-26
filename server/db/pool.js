// PostgreSQL connection pool.
// Uses the 'pg' driver directly with parameterized queries everywhere.
// Connection settings come from environment variables (see .env.example).

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  // Unexpected errors on idle clients should not crash the whole server.
  console.error('[db] Unexpected PostgreSQL pool error:', err.message);
});

// Small helper so controllers/services can just do: const { rows } = await query(sql, params)
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  if (process.env.NODE_ENV !== 'production') {
    const duration = Date.now() - start;
    console.log(`[db] ${duration}ms | ${text.split('\n')[0].slice(0, 80)}`);
  }
  return result;
}

// Runs `fn(client)` inside BEGIN/COMMIT (ROLLBACK on error) on one connection,
// so multi-statement writes (e.g. "upsert 20 papers + link them + log the
// search") are atomic and cost a single pool checkout.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn((text, params) => client.query(text, params));
    await client.query('COMMIT');
    return result;
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
}

module.exports = { pool, query, withTransaction };
