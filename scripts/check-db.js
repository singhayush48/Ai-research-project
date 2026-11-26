// Diagnoses the database connection and explains common problems.
// Usage (from the project root):  npm run db:check
const path = require('path');
process.chdir(path.resolve(__dirname, '..', 'server'));

try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');
  else {
    const fs = require('fs');
    for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      const eq = t.indexOf('=');
      if (!t || t.startsWith('#') || eq < 1) continue;
      let v = t.slice(eq + 1).trim();
      if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
      if (process.env[t.slice(0, eq).trim()] === undefined) process.env[t.slice(0, eq).trim()] = v;
    }
  }
} catch {
  console.error('X  server/.env not found. Run "npm run setup" first.');
  process.exit(1);
}

const { pool, usingConnectionString } = require(path.resolve('db/pool.js'));

function hint(err) {
  const m = String(err.message || err);
  if (/password authentication failed/i.test(m)) return 'Wrong password in DATABASE_URL. Re-copy it from Supabase (or reset the database password there).';
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return 'Host name not found. Check DATABASE_URL for typos. If you used the "Direct connection" string, switch to the "Session pooler" string (it works on IPv4 networks).';
  if (/ETIMEDOUT|timeout|ECONNREFUSED/i.test(m)) return 'Could not reach the database. Check your internet/firewall, that the Supabase project is not paused, and that you used the Session pooler string.';
  if (/Tenant or user not found/i.test(m)) return 'The pooler could not find the project. The user must look like postgres.<project-ref>; copy the whole string from Supabase "Connect".';
  if (/self.signed|certificate/i.test(m)) return 'TLS certificate problem. Add DB_SSL=on to server/.env.';
  if (/does not support SSL|SSL/i.test(m)) return 'SSL mismatch. For a local PostgreSQL add DB_SSL=off; for a hosted one add DB_SSL=on.';
  if (/Invalid URL|invalid connection string/i.test(m)) return 'DATABASE_URL is malformed. If the password contains characters like @ : / # ? it must be URL-encoded - easiest fix: reset the DB password to letters and numbers only.';
  return null;
}

(async () => {
  console.log(usingConnectionString ? 'Using DATABASE_URL from server/.env' : 'DATABASE_URL not set - using local PG* settings');
  const t0 = Date.now();
  try {
    const v = await pool.query('SELECT version() AS v, current_database() AS db');
    console.log(`OK Connected in ${Date.now() - t0} ms -> database "${v.rows[0].db}"`);
    console.log(`   ${v.rows[0].v.split(',')[0]}`);
    const t = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
    console.log(
      t.rows[0].n > 0
        ? `OK ${t.rows[0].n} tables found in the public schema.`
        : 'i  Database is empty - the tables are created automatically the first time you run "npm run dev".'
    );
    process.exitCode = 0;
  } catch (err) {
    console.error(`X  Connection failed: ${err.message}`);
    const h = hint(err);
    if (h) console.error(`   -> ${h}`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
