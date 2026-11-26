const { query } = require('../db/pool');
const { hashPassword, verifyPassword } = require('../utils/hash');
const { createSessionToken, hashToken } = require('../utils/token');
const { validateRegister, validateLogin } = require('../utils/validate');
const { setSessionCookie, clearSessionCookie } = require('../middleware/cookies');
const { invalidateSession } = require('../middleware/auth');

async function register(req, res, next) {
  try {
    const { name, email, password } = req.body || {};
    const validationError = validateRegister({ name, email, password });
    if (validationError) return res.status(400).json({ error: validationError });

    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const { hash, salt } = hashPassword(password);
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, password_salt)
       VALUES ($1, $2, $3, $4) RETURNING id, name, email, created_at`,
      [name.trim(), email.toLowerCase(), hash, salt]
    );
    const user = rows[0];

    const { token, expiresAt } = createSessionToken(user.id);
    await query(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, hashToken(token), expiresAt]
    );
    setSessionCookie(res, token, expiresAt);

    res.status(201).json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    const validationError = validateLogin({ email, password });
    if (validationError) return res.status(400).json({ error: validationError });

    const { rows } = await query(
      'SELECT id, name, email, password_hash, password_salt FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    // Use a generic message for both "no such user" and "wrong password"
    // so we don't leak which emails are registered.
    if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash, rows[0].password_salt)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = rows[0];
    const { token, expiresAt } = createSessionToken(user.id);
    await query(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, hashToken(token), expiresAt]
    );
    setSessionCookie(res, token, expiresAt);

    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    invalidateSession(req.sessionTokenHash);
    if (req.sessionId) {
      await query('DELETE FROM sessions WHERE id = $1', [req.sessionId]);
    }
    clearSessionCookie(res);
    res.json({ message: 'Logged out.' });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { register, login, logout, me };
