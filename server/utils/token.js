// Signed session tokens implemented with Node's built-in crypto (HMAC-SHA256).
// Conceptually equivalent to a JWT (header.payload.signature, base64url
// encoded) but hand-written so no 'jsonwebtoken' dependency is required.
//
// The token itself is stateless-verifiable (signature proves it wasn't
// tampered with), but we ALSO store a hash of every issued token in the
// 'sessions' table so logout / revocation is possible server-side.

const crypto = require('crypto');

const SECRET = process.env.AUTH_TOKEN_SECRET;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadObj) {
  if (!SECRET) throw new Error('AUTH_TOKEN_SECRET is not set');
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'SESSION' }));
  const payload = base64url(JSON.stringify(payloadObj));
  const data = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function verify(token) {
  if (!SECRET) throw new Error('AUTH_TOKEN_SECRET is not set');
  if (typeof token !== 'string' || token.split('.').length !== 3) return null;
  const [header, payload, signature] = token.split('.');
  const data = `${header}.${payload}`;
  const expectedSignature = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decoded.exp && Date.now() > decoded.exp) return null; // expired
    return decoded;
  } catch {
    return null;
  }
}

// Store only a hash of the token server-side (never the raw token),
// so a leaked database dump can't be used to forge sessions.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSessionToken(userId) {
  const expiryHours = Number(process.env.AUTH_TOKEN_EXPIRY_HOURS || 168);
  const now = Date.now();
  const exp = now + expiryHours * 60 * 60 * 1000;
  const token = sign({ sub: userId, iat: now, exp });
  return { token, expiresAt: new Date(exp) };
}

module.exports = { sign, verify, hashToken, createSessionToken };
