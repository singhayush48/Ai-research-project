const express = require('express');
const { parseCookies } = require('./middleware/cookies');
const { jsonPerformance } = require('./middleware/httpCache');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const paperRoutes = require('./routes/papers');
const aiRoutes = require('./routes/ai');
const noteRoutes = require('./routes/notes');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
app.disable('x-powered-by');

// --- Core middleware ---
app.use(express.json({ limit: '2mb' }));
app.use(parseCookies);
app.use(jsonPerformance);

// --- Minimal hand-written CORS (no 'cors' package) ---
// CLIENT_ORIGIN may be a comma-separated list. In development any
// localhost / 127.0.0.1 origin is accepted too, so it no longer matters
// whether Vite landed on port 5173 or 5174, or whether you opened the app
// via localhost or 127.0.0.1 (a very common cause of "network error" /
// 401-after-login problems). Credentials are enabled so the httpOnly
// session cookie can be sent cross-origin. (With the default Vite proxy the
// browser talks to the API same-origin and none of this is even needed.)
function isAllowedOrigin(origin) {
  if (!origin) return false;
  const configured = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (configured.includes(origin)) return true;
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true;
  return false;
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,If-None-Match');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cache hit-rate diagnostics (development only).
app.get('/api/health/cache', (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found.' });
  res.json({ ...require('./services/aiService').cacheStats(), openalex: require('./services/openalex').cacheStats() });
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/papers', paperRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
