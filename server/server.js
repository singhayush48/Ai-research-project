// Loads .env using Node's built-in loader (Node 20.6+). On older Node versions
// (18.x) a tiny fallback parser is used, so we still don't need 'dotenv'.
// Falls back gracefully if the file is missing.
const fs = require('fs');

function loadEnvFallback(file) {
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');
  else loadEnvFallback('.env');
} catch {
  console.warn('[server] No .env file found — relying on real environment variables.');
}

const app = require('./app');
const { initializeDatabase } = require('./db/init');

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`AI Research Assistant API listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[db] Database initialization failed:', err.message);
    if (process.env.DATABASE_URL) {
      console.error('[db] Check DATABASE_URL in server/.env (copy it exactly from Supabase; use the "Session pooler" string).');
    } else {
      console.error('[db] Set DATABASE_URL in server/.env (hosted DB), or make sure local PostgreSQL is running and PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD are correct.');
    }
    console.error('[db] Run "npm run db:check" from the project root for a detailed diagnosis.');
    process.exit(1);
  }
}

start();
