// One-off CLI helper: prints an INSERT statement for a demo user with a
// securely hashed password ("Demo@1234"). Run with:
//   node server/utils/generateDemoHash.js
// Paste the printed SQL into database/seed.sql (or run it directly).

const { hashPassword } = require('./hash');

const DEMO_PASSWORD = 'Demo@1234';
const { hash, salt } = hashPassword(DEMO_PASSWORD);

console.log('-- Demo user (email: demo@example.com, password: Demo@1234)');
console.log(
  `INSERT INTO users (name, email, password_hash, password_salt) VALUES ` +
    `('[DEMO] Demo User', 'demo@example.com', '${hash}', '${salt}') ` +
    `ON CONFLICT (email) DO NOTHING;`
);
