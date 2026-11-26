// Centralized error handler. Logs full detail server-side for debugging,
// but only sends a safe message to the client: internals (stack traces,
// SQL, secrets) are never exposed. Errors explicitly marked `expose = true`
// (AI-provider / OpenAlex problems such as "rate-limited" or "bad API key",
// and validation-style failures) keep their human-readable message even when
// the status is 5xx — previously every 5xx became "Something went wrong on
// the server", which hid the one thing the user needed to act on.

function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[error]', req.method, req.originalUrl, '->', err.message);
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }
  if (res.headersSent) return next(err);

  // Malformed JSON bodies from body-parser carry err.type === 'entity.parse.failed'.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }

  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  const message =
    status < 500 || err.expose
      ? err.message || 'Request could not be processed.'
      : 'Something went wrong on the server. Please try again.';

  res.status(status).json({ error: message });
}

module.exports = { notFoundHandler, errorHandler };
