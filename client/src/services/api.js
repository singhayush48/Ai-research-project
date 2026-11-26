// Thin wrapper around browser fetch(). No axios / react-query / SWR.
// All requests include credentials so the httpOnly session cookie is sent.
//
// Pass 10 additions:
//  * default base is the same-origin '/api' (Vite proxies it to the backend),
//    so there is no CORS / cross-site-cookie problem whether you open the app
//    as localhost or 127.0.0.1 or on a different port. Override with
//    VITE_API_BASE for a separately hosted API.
//  * GET responses are cached in memory for a short time and identical
//    in-flight GETs are shared. ANY successful write clears the whole cache,
//    so the UI can never show data older than the user's own last action.
//  * a 401 from an authenticated call emits an "auth-expired" event so the
//    app returns to the login screen instead of showing cryptic errors.
//  * unreachable backend / proxy errors produce a clear message.

const API_BASE = (import.meta.env && import.meta.env.VITE_API_BASE) || '/api';
const GET_TTL_MS = 20_000;
const MAX_CACHE_ENTRIES = 80;

const getCache = new Map(); // url -> { at, data }
const inflight = new Map(); // url -> Promise

const clone = (data) => (typeof structuredClone === 'function' && data !== null && typeof data === 'object' ? structuredClone(data) : data);

export function clearApiCache() {
  getCache.clear();
}

function buildUrl(path, params) {
  let url = `${API_BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
    ).toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

async function doFetch(url, { method, body }) {
  let response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Network error: could not reach the server. Is the backend running?');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Some responses (e.g. 204/304) may not have a JSON body.
  }

  if (!response.ok) {
    const isAuthCall = url.includes('/auth/');
    if (response.status === 401 && !isAuthCall && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth-expired'));
    }
    if (!data && response.status >= 500) {
      throw new Error('The server is not responding. Make sure the backend is running (npm run dev in /server).');
    }
    throw new Error((data && data.error) || `Request failed (status ${response.status}).`);
  }
  return data;
}

async function request(path, { method = 'GET', body, params, cache = true } = {}) {
  const url = buildUrl(path, params);

  if (method !== 'GET') {
    try {
      return await doFetch(url, { method, body });
    } finally {
      // Even a failed write may have partially succeeded server-side.
      clearApiCache();
    }
  }

  if (cache) {
    const hit = getCache.get(url);
    if (hit && Date.now() - hit.at < GET_TTL_MS) return clone(hit.data);
    if (inflight.has(url)) return clone(await inflight.get(url));
  }

  const promise = doFetch(url, { method }).then((data) => {
    if (cache) {
      getCache.set(url, { at: Date.now(), data });
      if (getCache.size > MAX_CACHE_ENTRIES) getCache.delete(getCache.keys().next().value);
    }
    return data;
  });
  if (cache) inflight.set(url, promise);
  try {
    return clone(await promise);
  } finally {
    inflight.delete(url);
  }
}

export const api = {
  // Auth (never cached)
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me', { cache: false }),

  // Dashboard
  getDashboard: () => request('/dashboard'),

  // Projects
  listProjects: () => request('/projects'),
  createProject: (payload) => request('/projects', { method: 'POST', body: payload }),
  getProject: (id) => request(`/projects/${id}`),
  updateProject: (id, payload) => request(`/projects/${id}`, { method: 'PUT', body: payload }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  addPaperToProject: (id, payload) =>
    request(`/projects/${id}/papers`, { method: 'POST', body: payload }),
  removePaperFromProject: (id, paperId) =>
    request(`/projects/${id}/papers/${paperId}`, { method: 'DELETE' }),
  getProjectTimeline: (id) => request(`/projects/${id}/timeline`),

  // Papers
  searchPapers: (q, page = 1, projectId = undefined) =>
    // Searches inside a chat write server-side (link + log), so never serve
    // them from the client cache.
    request('/papers/search', { params: { q, page, projectId }, cache: projectId === undefined }),
  getPaper: (id) => request(`/papers/${encodeURIComponent(id)}`),
  savePaper: (payload) => request('/papers/save', { method: 'POST', body: payload }),
  removeSavedPaper: (id) => request(`/papers/save/${id}`, { method: 'DELETE' }),
  listSavedPapers: () => request('/papers/saved'),

  // AI. `regenerate: true` tells the server to skip its answer cache.
  analyzePaper: (paperId, regenerate = false) =>
    request('/ai/analyze-paper', { method: 'POST', body: { paperId, regenerate } }),
  comparePapers: (paperIds, regenerate = false) =>
    request('/ai/compare-papers', { method: 'POST', body: { paperIds, regenerate } }),
  researchGap: (paperIds, regenerate = false) =>
    request('/ai/research-gap', { method: 'POST', body: { paperIds, regenerate } }),
  generateDraft: (projectId, paperIds, regenerate = false) =>
    request('/ai/generate-draft', { method: 'POST', body: { projectId, paperIds, regenerate } }),
  getProjectDraft: (projectId) => request(`/ai/draft/${projectId}`),
  suggestResearchQuestion: (payload) => request('/ai/suggest-question', { method: 'POST', body: payload }),
  kickoffResearch: (topic, researchType) =>
    request('/ai/kickoff', { method: 'POST', body: { topic, researchType } }),
  analyzeProjectSources: (projectId, regenerate = false) =>
    request('/ai/analyze-sources', { method: 'POST', body: { projectId, regenerate } }),
  getProjectIntelligence: (projectId) => request(`/ai/analyze-sources/${projectId}`),
  identifyResearchGaps: (projectId, regenerate = false) =>
    request('/ai/research-gaps', { method: 'POST', body: { projectId, regenerate } }),
  getProjectGaps: (projectId) => request(`/ai/research-gaps/${projectId}`),
  buildResearchPlan: (projectId, regenerate = false) =>
    request('/ai/research-plan', { method: 'POST', body: { projectId, regenerate } }),
  getProjectPlan: (projectId) => request(`/ai/research-plan/${projectId}`),
  sendCopilotMessage: (projectId, message) =>
    request('/ai/copilot', { method: 'POST', body: { projectId, message } }),
  getCopilotHistory: (projectId) => request(`/ai/copilot/${projectId}`),
  // Natural-language intent router — the composer's primary send path.
  // `retry` tells the server the user message was already saved by a failed
  // earlier attempt, so it isn't stored twice.
  routeChatMessage: (projectId, message, retry = false) =>
    request('/ai/chat', { method: 'POST', body: { projectId, message, retry } }),

  // Notes
  listNotes: (projectId) => request('/notes', { params: { projectId } }),
  createNote: (payload) => request('/notes', { method: 'POST', body: payload }),
  updateNote: (id, payload) => request(`/notes/${id}`, { method: 'PUT', body: payload }),
  deleteNote: (id) => request(`/notes/${id}`, { method: 'DELETE' }),
};
