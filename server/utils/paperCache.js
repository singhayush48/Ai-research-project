const { TTLCache } = require('./cache');

// Shared in-memory cache of paper DTOs by local id (see aiController
// .fetchPapersByIds). Papers only change when they are re-upserted from
// OpenAlex, and every upsert path evicts the id, so a 5 minute TTL is just a
// safety net.
const paperCache = new TTLCache({ name: 'papers', max: 3000, ttlMs: 5 * 60 * 1000 });

module.exports = { paperCache };
