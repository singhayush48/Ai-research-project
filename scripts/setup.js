// One-time setup: installs server + client dependencies and creates
// server/.env from .env.example if it does not exist yet.
// Usage (from the project root):  npm run setup
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`Node.js 18 or newer is required (you have ${process.versions.node}). Download it from https://nodejs.org`);
  process.exit(1);
}

function install(dir) {
  console.log(`\n==> Installing dependencies in ${dir}/ ...`);
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: path.join(root, dir),
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) {
    console.error(`\nnpm install failed in ${dir}/`);
    process.exit(r.status || 1);
  }
}

install('server');
install('client');

const envPath = path.join(root, 'server', '.env');
if (fs.existsSync(envPath)) {
  console.log('\n==> server/.env already exists - leaving it untouched.');
} else {
  fs.copyFileSync(path.join(root, '.env.example'), envPath);
  console.log('\n==> Created server/.env from .env.example');
}

console.log(`
============================================================
 Setup finished. Two things left:

 1. Open server/.env and fill in:
      DATABASE_URL   (the shared database connection string)
      AI_API_KEY     (your OpenRouter / AI key)
      AUTH_TOKEN_SECRET (any long random text)
    (If the project owner sent you a ready-made .env file,
     just put it in the server/ folder instead.)

 2. Check the database connection, then start the app:
      npm run db:check
      npm run dev
    Then open http://localhost:5173
============================================================
`);
