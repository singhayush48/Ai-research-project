// Academic paper search via the OpenAlex API, using native fetch only
// (no SDK). OpenAlex is free/keyless; we send a contact email so requests
// use the "polite pool" (higher, more reliable rate limits).
//
// Pass 10: results are cached (10 min for searches, 1 h for single works),
// identical concurrent searches share ONE upstream request, transient
// failures are retried once, and if OpenAlex is down/rate-limiting we serve
// the last good (stale) answer instead of failing the user's research step.

const { TTLCache } = require('../utils/cache');

const BASE_URL = () => process.env.OPENALEX_BASE_URL || 'https://api.openalex.org';
const CONTACT_EMAIL = () => process.env.OPENALEX_CONTACT_EMAIL;
const TIMEOUT_MS = 15_000;

const searchCache = new TTLCache({ name: 'openalex-search', max: 300, ttlMs: 10 * 60 * 1000 });
const workCache = new TTLCache({ name: 'openalex-work', max: 500, ttlMs: 60 * 60 * 1000 });

// Only the fields we use — OpenAlex work objects are huge (hundreds of KB per
// page otherwise). If OpenAlex ever rejects the select list we transparently
// fall back to the full payload and stop sending it.
const SELECT_FIELDS =
  'id,title,display_name,publication_year,authorships,abstract_inverted_index,primary_location,doi,cited_by_count,relevance_score';
let selectUnsupported = false;

function politeParam() {
  const email = CONTACT_EMAIL();
  return email && !/your_email@example\.com/i.test(email) ? `&mailto=${encodeURIComponent(email)}` : '';
}

function upstreamError(message, status = 502) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      if (attempt === 0) {
        await sleep(500);
        continue;
      }
      throw upstreamError('Could not reach OpenAlex (network error or timeout). Check your internet connection and try again.');
    }
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      await response.arrayBuffer().catch(() => {});
      await sleep(response.status === 429 ? 1200 : 600);
      continue;
    }
    break;
  }
  return response;
}

// OpenAlex stores abstracts as an "inverted index" (word -> positions) to
// save space. Reconstruct the actual abstract text from it.
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return null;
  const positions = [];
  for (const [word, idxs] of Object.entries(invertedIndex)) {
    if (!Array.isArray(idxs)) continue;
    for (const i of idxs) positions[i] = word;
  }
  const text = positions.filter(Boolean).join(' ').trim();
  return text.length > 0 ? text : null;
}

function normalizeWork(work) {
  const authors = Array.isArray(work.authorships)
    ? work.authorships.map((a) => a && a.author && a.author.display_name).filter(Boolean)
    : [];

  return {
    openalexId: work.id || null,
    title: work.title || work.display_name || 'Untitled',
    authors,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    publicationYear: work.publication_year || null,
    sourceName:
      (work.primary_location && work.primary_location.source && work.primary_location.source.display_name) || null,
    doi: work.doi || null,
    paperUrl: (work.primary_location && work.primary_location.landing_page_url) || work.id || null,
    citedByCount: typeof work.cited_by_count === 'number' ? work.cited_by_count : null,
    // OpenAlex includes this only when results are sorted by relevance_score
    // (which is what searchWorks() does below). Surfaced as-is, never invented.
    relevanceScore: typeof work.relevance_score === 'number' ? work.relevance_score : null,
  };
}

// Search papers by keyword/topic, with pagination.
// page is 1-indexed; perPage capped by OpenAlex at 200 (we default to 20).
async function searchWorks({ query, page = 1, perPage = 20, bypassCache = false }) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    const err = new Error('Search query is required.');
    err.status = 400;
    throw err;
  }
  const q = query.trim().replace(/\s+/g, ' ');
  const key = `${q.toLowerCase()}|${page}|${perPage}`;

  const result = await searchCache.wrap(
    key,
    async () => {
      const build = (withSelect) =>
        `${BASE_URL()}/works?search=${encodeURIComponent(q)}` +
        `&page=${page}&per_page=${perPage}&sort=relevance_score:desc` +
        `${withSelect ? `&select=${SELECT_FIELDS}` : ''}${politeParam()}`;

      let response = await fetchJson(build(!selectUnsupported));
      if (response.status === 400 && !selectUnsupported) {
        const retry = await fetchJson(build(false));
        if (retry.ok) selectUnsupported = true;
        response = retry;
      }
      if (!response.ok) {
        throw upstreamError(
          response.status === 429
            ? 'OpenAlex is rate-limiting requests right now. Wait a moment and search again.'
            : `OpenAlex API returned an error (status ${response.status}). Please try again.`
        );
      }

      let data;
      try {
        data = await response.json();
      } catch {
        throw upstreamError('OpenAlex returned a malformed response.');
      }

      const results = Array.isArray(data.results) ? data.results.map(normalizeWork) : [];
      const totalCount = (data.meta && data.meta.count) || results.length;
      return { results, page, perPage, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / perPage)) };
    },
    { bypass: bypassCache, staleOnError: true }
  );

  // Callers mutate result.results (annotating ids / selection) — hand out a copy.
  return { ...result, results: result.results.map((r) => ({ ...r, authors: [...r.authors] })) };
}

// Fetch a single work by its OpenAlex ID (full URL id or short id like W123).
async function getWorkById(openalexId) {
  if (!openalexId) {
    const err = new Error('OpenAlex ID is required.');
    err.status = 400;
    throw err;
  }
  const idPart = openalexId.startsWith('http') ? openalexId.split('/').pop() : openalexId;

  const work = await workCache.wrap(
    idPart,
    async () => {
      const mailto = politeParam().slice(1);
      const response = await fetchJson(`${BASE_URL()}/works/${encodeURIComponent(idPart)}${mailto ? `?${mailto}` : ''}`);
      if (response.status === 404) {
        const err = new Error('Paper not found in OpenAlex.');
        err.status = 404;
        throw err;
      }
      if (!response.ok) throw upstreamError(`OpenAlex API returned an error (status ${response.status}).`);
      return normalizeWork(await response.json());
    },
    { staleOnError: true }
  );
  return { ...work, authors: [...work.authors] };
}

function cacheStats() {
  return { search: searchCache.stats(), work: workCache.stats() };
}

module.exports = { searchWorks, getWorkById, cacheStats };
