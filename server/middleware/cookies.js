// Minimal hand-written cookie parser, so we don't need the 'cookie-parser'
// package. Populates req.cookies as a plain object, same shape that
// cookie-parser would produce for our purposes.

function parseCookies(req, res, next) {
  const header = req.headers.cookie;
  req.cookies = {};
  if (header) {
    header.split(';').forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx === -1) return;
      const key = pair.slice(0, idx).trim();
      const value = decodeURIComponent(pair.slice(idx + 1).trim());
      req.cookies[key] = value;
    });
  }
  next();
}

// Small helper to set an httpOnly session cookie consistently.
function setSessionCookie(res, token, expiresAt) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `session_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Expires=${expiresAt.toUTCString()}`,
    'SameSite=Lax',
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    'session_token=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  );
}

module.exports = { parseCookies, setSessionCookie, clearSessionCookie };
