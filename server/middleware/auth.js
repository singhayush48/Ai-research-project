const { verify, hashToken } = require('../utils/token');
const { query } = require('../db/pool');
const { TTLCache } = require('../utils/cache');

// Every API request used to hit PostgreSQL (sessions JOIN users) just to
// re-confirm the session. A short-lived in-memory cache removes that query
// from almost every request. TTL is deliberately short (30 s) and logout
// explicitly evicts, so revocation is still effectively immediate.
const sessionCache = new TTLCache({ name: 'sessions', max: 1000, ttlMs: 30_000 });

function invalidateSession(tokenHash) {
  if (tokenHash) sessionCache.delete(tokenHash);
}

// Reads the session token from an httpOnly cookie (preferred) or the
// Authorization: Bearer header, verifies its signature, and confirms the
// session still exists (i.e. wasn't logged out / revoked) in PostgreSQL.
async function requireAuth(req, res, next) {
  try {
    const cookieToken = req.cookies && req.cookies.session_token;
    const header = req.headers.authorization;
    const headerToken = header && header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = cookieToken || headerToken;

    if (!token) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const decoded = verify(token);
    if (!decoded || !decoded.sub) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }

    const tokenHash = hashToken(token);
    let session = sessionCache.get(tokenHash);

    if (!session || session.expiresAt <= Date.now()) {
      const { rows } = await query(
        `SELECT s.id, s.user_id, s.expires_at, u.name, u.email
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
        [tokenHash]
      );
      if (rows.length === 0) {
        sessionCache.delete(tokenHash);
        return res.status(401).json({ error: 'Session not found or expired.' });
      }
      session = {
        sessionId: rows[0].id,
        user: { id: rows[0].user_id, name: rows[0].name, email: rows[0].email },
        expiresAt: new Date(rows[0].expires_at).getTime(),
      };
      sessionCache.set(tokenHash, session);
    }

    req.user = { ...session.user };
    req.sessionId = session.sessionId;
    req.sessionTokenHash = tokenHash;
    next();
  } catch (err) {
    console.error('[auth middleware] error:', err.message);
    res.status(500).json({ error: 'Authentication check failed.' });
  }
}

module.exports = { requireAuth, invalidateSession, sessionCache };
