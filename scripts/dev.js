// Starts the API server and the Vite client together in one terminal.
// Usage (from the project root):  npm run dev     (Ctrl+C stops both)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

for (const dir of ['server', 'client']) {
  if (!fs.existsSync(path.join(root, dir, 'node_modules'))) {
    console.error(`Dependencies are not installed yet. Run:  npm run setup`);
    process.exit(1);
  }
}
if (!fs.existsSync(path.join(root, 'server', '.env'))) {
  console.error('server/.env is missing. Run:  npm run setup   and then fill in server/.env');
  process.exit(1);
}

const children = [];
function run(label, color, dir, args) {
  const child = spawn('npm', args, { cwd: path.join(root, dir), shell: true, env: process.env });
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (d) =>
      d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => out.write(prefix + l + '\n'))
    );
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code || 0);
  });
  children.push(child);
}

let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  for (const c of children) {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { shell: true });
      else c.kill('SIGTERM');
    } catch {
      /* already stopped */
    }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('server', '36', 'server', ['run', 'start']);
run('client', '35', 'client', ['run', 'dev']);
setTimeout(() => console.log('\n  App:  http://localhost:5173\n'), 2500);
