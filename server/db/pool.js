// PostgreSQL connection pool.
// Uses the 'pg' driver directly with parameterized queries everywhere.
//
// Two ways to configure the connection (see .env.example):
//   1. DATABASE_URL  -> a single connection string. Use this for a hosted
//                       database such as Supabase or Neon (recommended: every
//                       teammate shares the same central database).
//   2. PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD -> a local PostgreSQL.
// If DATABASE_URL is set it wins.

const { Pool } = require('pg');

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();

function isLocalUrl(url) {
  return /@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
}

// Hosted providers require TLS. Their certificate chains are not in Node's
// default trust store, so we enable TLS without chain verification (the
// connection is still encrypted). Set DB_SSL=off to disable TLS, or
// DB_SSL=strict to fully verify the certificate.
function sslOption(usingUrl, host) {
  const mode = (process.env.DB_SSL || '').toLowerCase();
  if (mode === 'off' || mode === 'false') return false;
  if (mode === 'strict') return { rejectUnauthorized: true };
  if (mode === 'on' || mode === 'true') return { rejectUnauthorized: false };
  // auto: TLS for remote hosts, none for a local PostgreSQL
  if (!usingUrl) return false;
  return isLocalUrl(host) ? false : { rejectUnauthorized: false };
}

function buildConfig() {
  if (DATABASE_URL) {
    // Remove "?sslmode=..." from the URL: newer pg versions would otherwise
    // override our ssl option with strict verification and fail on hosted DBs.
    const cleaned = DATABASE_URL.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');
    return {
      connectionString: cleaned,
      ssl: sslOption(true, DATABASE_URL),
      // Free hosted tiers allow only a limited number of connections shared
      // by everyone on the team, so keep each machine's pool small.
      max: Number(process.env.DB_POOL_MAX || 5),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    };
  }
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: sslOption(false, ''),
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
  };
}

const pool = new Pool(buildConfig());

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

module.exports = { pool, query, withTransaction, usingConnectionString: Boolean(DATABASE_URL) };
