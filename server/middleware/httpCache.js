// Response-level performance middleware (hand-written: the project policy is
// no extra runtime dependencies).
//
//  * gzip for JSON responses > 1 KB (timeline/search payloads are mostly
//    repetitive text and shrink ~5-10x)
//  * weak ETag + `If-None-Match` -> 304 for GET requests, so re-opening a chat
//    whose data did not change costs one tiny round trip
//  * `Cache-Control: private, no-cache` — the browser may store the response
//    but must revalidate, so it can never show stale research data

const zlib = require('zlib');
const crypto = require('crypto');

function jsonPerformance(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = (payload) => {
    if (res.headersSent) return res;
    let body;
    try {
      body = JSON.stringify(payload);
    } catch (err) {
      return next(err);
    }
    if (body === undefined) body = 'null';

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Vary', 'Accept-Encoding, Origin');

    const isGet = req.method === 'GET' && res.statusCode === 200;
    if (isGet) {
      const etag = `W/"${Buffer.byteLength(body)}-${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, no-cache');
      if (req.headers['if-none-match'] === etag) {
        res.statusCode = 304;
        res.end();
        return res;
      }
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    if (acceptsGzip && Buffer.byteLength(body) > 1024) {
      zlib.gzip(body, (err, compressed) => {
        if (err) {
          res.end(body);
          return;
        }
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Length', compressed.length);
        res.end(compressed);
      });
      return res;
    }

    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.end(body);
    return res;
  };

  // Keep a reference for code that really needs the stock behaviour.
  res.jsonRaw = originalJson;
  next();
}

module.exports = { jsonPerformance };
