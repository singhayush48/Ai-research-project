// Loads .env using Node's built-in loader (Node 20.6+), so we don't need
// the 'dotenv' package. Falls back gracefully if the file is missing.
try {
  process.loadEnvFile('.env');
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
    console.error('[db] Check PostgreSQL is running and PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD are correct.');
    process.exit(1);
  }
}

start();
