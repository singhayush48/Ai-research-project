// Provider-agnostic AI client. `callAI()` / `callAIJson()` are what the rest
// of the app uses; it never knows which provider is behind it. Each provider
// is just a small async function registered in PROVIDERS below.
//
// Reliability + performance features (Pass 10):
//   * automatic retry with back-off on 429 / 5xx / network errors
//   * configurable timeout (AI_TIMEOUT_MS, default 90s — free models are slow)
//   * tolerant JSON extraction + repair (code fences, <think> blocks, prose
//     around the JSON, trailing commas, TRUNCATED output)
//   * response caching for structured (JSON) calls: L1 in-memory LRU with
//     in-flight de-duplication + L2 PostgreSQL table that survives restarts
//   * every error that is safe to show a user carries `expose = true` so the
//     UI sees "the AI provider is rate-limiting" instead of "Something went
//     wrong on the server"

const crypto = require('crypto');
const { TTLCache } = require('../utils/cache');

const CACHE_VERSION = 'v2'; // bump when prompts/normalizers change shape

function cfg() {
  return {
    apiUrl: process.env.AI_API_URL,
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
    provider: (process.env.AI_PROVIDER || 'openrouter').toLowerCase(),
    apiVersion: process.env.AI_API_VERSION || '2023-06-01',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 90_000),
    maxRetries: Math.min(3, Math.max(0, Number(process.env.AI_MAX_RETRIES ?? 2))),
    maxOutputTokens: Math.max(512, Number(process.env.AI_MAX_OUTPUT_TOKENS || 6000)),
    retryTokenMultiplier: Math.min(2.5, Math.max(1.1, Number(process.env.AI_RETRY_TOKEN_MULTIPLIER || 1.6))),
    cacheEnabled: String(process.env.AI_CACHE || 'on').toLowerCase() !== 'off',
    cacheTtlMs: Number(process.env.AI_CACHE_TTL_HOURS || 168) * 3600_000,
  };
}

function aiError(message, status = 502, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  Object.assign(err, extra);
  return err;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function friendlyProviderError(status, detail) {
  const tail = detail ? ` (${String(detail).slice(0, 160)})` : '';
  if (status === 401 || status === 403) return aiError(`The AI provider rejected the API key${tail}. Check AI_API_KEY in server/.env.`, 502);
  if (status === 402) return aiError(`The AI provider reports insufficient credits${tail}.`, 502);
  if (status === 404) return aiError(`The AI provider could not find the configured model${tail}. Check AI_MODEL in server/.env.`, 502);
  if (status === 429) return aiError('The AI provider is rate-limiting requests (free models have tight limits). Wait a few seconds and press Retry.', 503, { providerStatus: 429 });
  return aiError(`The AI provider returned an error (status ${status})${tail}. Please try again.`, 502, { providerStatus: status });
}

// fetch with timeout + retry/back-off. `bodyFactory` lets the caller change
// the request between attempts if ever needed; here it is just a string.
async function fetchWithRetry(url, options, { timeoutMs, maxRetries }) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (RETRYABLE.has(response.status) && attempt < maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 8000) : 700 * 2 ** attempt + Math.random() * 300;
        await response.arrayBuffer().catch(() => {});
        await sleep(wait);
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250);
        continue;
      }
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw aiError('The AI provider timed out. Try fewer sources or increase AI_TIMEOUT_MS.', 504, { code: 'AI_TIMEOUT' });
      }
    }
  }
  throw aiError('Could not reach the AI provider (network error). Check your internet connection and AI_API_URL.', 502, { cause: lastError });
}

async function readJson(response) {
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    if (!response.ok) throw friendlyProviderError(response.status, raw.slice(0, 120));
    throw aiError('AI provider returned a malformed (non-JSON) response.', 502);
  }
  if (!response.ok) {
    const detail = (data && data.error && (data.error.message || data.error)) || '';
    const err = friendlyProviderError(response.status, typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.rawStatus = response.status;
    throw err;
  }
  return data;
}

// Remember (per process) that the configured model rejects response_format,
// so later calls skip the doomed first attempt.
let jsonModeUnsupported = false;

async function callOpenRouter({ system, prompt, maxTokens, apiUrl, apiKey, model, jsonMode, timeoutMs, maxRetries }) {
  const baseBody = {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
  };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  const send = (body) => fetchWithRetry(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) }, { timeoutMs, maxRetries });

  let response;
  if (jsonMode && !jsonModeUnsupported) {
    response = await send({ ...baseBody, response_format: { type: 'json_object' } });
    // Some OpenRouter models/providers don't support response_format.
    if ([400, 404, 422].includes(response.status)) {
      const fallback = await send(baseBody);
      if (fallback.ok) jsonModeUnsupported = true;
      response = fallback;
    }
  } else {
    response = await send(baseBody);
  }

  const data = await readJson(response);
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  const message = choice && choice.message;
  let content = message && message.content;

  if (Array.isArray(content)) {
    content = content
      .filter((block) => block && (block.type === 'text' || typeof block.text === 'string'))
      .map((block) => block.text || '')
      .join('');
  }
  
const finishReason = (choice && choice.finish_reason) || 'unknown';
  // Reasoning is intentionally not substituted for the final answer.
  if (typeof content === 'string' && content.trim()) {
    if (finishReason === 'length') {
      throw aiError('The AI response reached its output-token limit before completion.', 502, {
        code: 'AI_TRUNCATED_RESPONSE', finishReason, model,
        completionTokens: data?.usage?.completion_tokens, responseId: data?.id,
      });
    }
    return { text: content, finishReason };
  }

const messageMeta = {
  code: finishReason === 'length' ? 'AI_TRUNCATED_RESPONSE' : 'AI_EMPTY_RESPONSE',
  providerStatus: response.status,
  finishReason,
  model,
  responseId: data && data.id ? data.id : undefined,
  completionTokens: data && data.usage
    ? data.usage.completion_tokens
    : undefined,
  hasRefusal: Boolean(message && message.refusal),
  hasToolCalls: Boolean(
    message &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length
  ),
};

throw aiError(
  finishReason === 'length'
    ? 'The AI response reached its output-token limit without producing a complete answer.'
    : 'OpenRouter returned no usable final text. The model may have returned an empty or reasoning-only response; reasoning text is not accepted as a completed answer.',
  502,
  messageMeta
);

}

async function callAnthropic({ system, prompt, maxTokens, apiUrl, apiKey, model, apiVersion, timeoutMs, maxRetries }) {
  const response = await fetchWithRetry(
    apiUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': apiVersion },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
    },
    { timeoutMs, maxRetries }
  );
  const data = await readJson(response);
  const textBlock = Array.isArray(data.content) && data.content.find((block) => block.type === 'text');
  if (data.stop_reason === 'max_tokens') {
    throw aiError('The AI response reached its output-token limit before completion.', 502, { code: 'AI_TRUNCATED_RESPONSE', finishReason: 'length', model });
  }
  if (!textBlock || typeof textBlock.text !== 'string' || !textBlock.text.trim()) {
    throw aiError('The AI provider returned no final text content.', 502, { code: 'AI_EMPTY_RESPONSE' });
  }
  return { text: textBlock.text, finishReason: data.stop_reason || null };
}

const PROVIDERS = { openrouter: callOpenRouter, anthropic: callAnthropic };

async function callProvider({ system, prompt, maxTokens = 2000, jsonMode = false }) {
  const c = cfg();
  if (!c.apiUrl || !c.apiKey || !c.model) {
    throw aiError('AI provider is not configured. Set AI_API_URL, AI_API_KEY and AI_MODEL in the server .env file.', 500);
  }
  const provider = PROVIDERS[c.provider];
  if (!provider) {
    throw aiError(`Unknown AI_PROVIDER "${c.provider}". Supported providers: ${Object.keys(PROVIDERS).join(', ')}.`, 500);
  }
  return provider({ system, prompt, maxTokens, jsonMode, ...c });
}

// Plain-text completion (used by the conversational copilot). Never cached:
// replies depend on a live conversation.
async function callAI({ system, prompt, maxTokens = 2000, jsonMode = false }) {
  const { text } = await callProvider({ system, prompt, maxTokens, jsonMode });
  return text;
}

// ---------------------------------------------------------------------
// Tolerant JSON extraction
// ---------------------------------------------------------------------
function closersFor(stack) {
  return stack
    .slice()
    .reverse()
    .map((c) => (c === '{' ? '}' : ']'))
    .join('');
}

// First balanced {...} / [...] value in the text (string/escape aware).
function extractBalanced(text, { firstOnly = false } = {}) {
  let seenStart = false;
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    if (firstOnly && seenStart) return '';
    seenStart = true;
    const stack = [];
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') {
        if (stack[stack.length - 1] !== (ch === '}' ? '{' : '[')) break;
        stack.pop();
        if (stack.length === 0) return text.slice(start, i + 1);
      }
    }
  }
  return '';
}

// Every balanced {...}/[...] block, one per opening-bracket position (capped).
function allBalanced(text) {
  const out = [];
  for (let start = 0; start < text.length && out.length < 25; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const found = extractBalanced(text.slice(start), { firstOnly: true });
    if (found) out.push(found);
  }
  return out;
}

// Recover a JSON value from output that was cut off mid-way (token limit).
function repairTruncated(text) {
  const startAt = text.search(/[{[]/);
  if (startAt < 0) return '';
  const s = text.slice(startAt);
  const stack = [];
  const cuts = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      stack.pop();
      cuts.push({ pos: i + 1, closers: closersFor(stack) });
    } else if (ch === ',') cuts.push({ pos: i, closers: closersFor(stack) });
  }
  const attempts = [];
  let tail = s;
  if (inString) tail += '"';
  attempts.push(tail.replace(/[,:\s]+$/, '') + closersFor(stack));
  for (let k = cuts.length - 1; k >= 0 && attempts.length < 40; k -= 1) {
    attempts.push(s.slice(0, cuts[k].pos) + cuts[k].closers);
  }
  for (const attempt of attempts) {
    try {
      JSON.parse(attempt);
      return attempt;
    } catch {
      /* try next cut */
    }
  }
  return '';
}

function tryParse(candidate) {
  if (!candidate) return undefined;
  try {
    return JSON.parse(candidate);
  } catch {
    // trailing commas are the most common "almost JSON" mistake
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return undefined;
    }
  }
}

// Returns { value, repaired } where repaired is 'truncated' when the output
// had to be closed off artificially. Throws a 502 if nothing is parseable.
function parseJsonLoose(rawText) {
  if (typeof rawText !== 'string') throw aiError('AI response was not valid JSON.', 502);
  let text = rawText.replace(/^\uFEFF/, '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  text = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  candidates.push(text);
  const firstBalanced = extractBalanced(text, { firstOnly: true });
  if (firstBalanced) candidates.push(firstBalanced);

  const accept = (v) => v !== undefined && v !== null && typeof v === 'object';
  for (const candidate of candidates) {
    const value = tryParse(candidate);
    if (accept(value)) return { value, repaired: null };
  }
  // Cut-off output: close the FIRST value artificially. This must run before
  // the "stray brace in prose" fallback below, otherwise a truncated outer
  // object would be mistaken for one of its own complete inner objects.
  const repairedValue = tryParse(repairTruncated(text));
  if (accept(repairedValue)) return { value: repairedValue, repaired: 'truncated' };

  // Stray braces in prose before the real JSON ("Sure {here}: {...}").
  for (const candidate of allBalanced(text)) {
    const value = tryParse(candidate);
    if (accept(value)) return { value, repaired: null };
  }
  throw aiError('AI response was not valid JSON.', 502);
}

function parseJsonResponse(rawText) {
  return parseJsonLoose(rawText).value;
}

function extractJsonCandidate(rawText) {
  try {
    return JSON.stringify(parseJsonLoose(rawText).value);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------
// Response cache (L1 memory + L2 PostgreSQL)
// ---------------------------------------------------------------------
const memoryCache = new TTLCache({ name: 'ai-json', max: 300, ttlMs: 60 * 60 * 1000 });

function cacheKeyFor({ system, prompt, maxTokens }) {
  const c = cfg();
  return crypto
    .createHash('sha256')
    .update([CACHE_VERSION, c.provider, c.apiUrl, c.model, maxTokens, c.maxOutputTokens, c.maxRetries, c.retryTokenMultiplier, system, prompt].join('\u0001'))
    .digest('hex');
}

function getPool() {
  try {
    return require('../db/pool');
  } catch {
    return null;
  }
}

async function dbCacheGet(key, ttlMs) {
  const db = getPool();
  if (!db) return undefined;
  try {
    const { rows } = await db.query(
      `SELECT response FROM ai_response_cache
       WHERE cache_key = $1 AND created_at > NOW() - ($2 * INTERVAL '1 millisecond')`,
      [key, ttlMs]
    );
    return rows.length ? rows[0].response : undefined;
  } catch (err) {
    console.warn('[ai-cache] L2 read failed:', err.message);
    return undefined;
  }
}

async function dbCacheDelete(key) {
  const db = getPool();
  if (!db) return;
  try { await db.query('DELETE FROM ai_response_cache WHERE cache_key = $1', [key]); }
  catch (err) { console.warn('[ai-cache] L2 delete failed:', err.message); }
}

function dbCacheSet(key, value) {
  const db = getPool();
  if (!db) return;
  db.query(
    `INSERT INTO ai_response_cache (cache_key, response, model) VALUES ($1, $2, $3)
     ON CONFLICT (cache_key) DO UPDATE SET response = EXCLUDED.response, created_at = NOW()`,
    [key, JSON.stringify(value), cfg().model || null]
  ).catch((err) => console.warn('[ai-cache] L2 write failed:', err.message));
}

async function pruneAiCache() {
  const db = getPool();
  if (!db) return;
  try {
    const ttlMs = cfg().cacheTtlMs;
    await db.query(`DELETE FROM ai_response_cache WHERE created_at < NOW() - ($1 * INTERVAL '1 millisecond')`, [ttlMs]);
    await db.query(
      `DELETE FROM ai_response_cache WHERE cache_key IN (
         SELECT cache_key FROM ai_response_cache ORDER BY created_at DESC OFFSET 3000)`
    );
  } catch (err) {
    console.warn('[ai-cache] prune failed:', err.message);
  }
}

const clone = (value) => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

// Structured (JSON) completion.
//   normalize(parsed) -> coerced value (see services/normalizers.js)
//   validate(value)   -> throws if the value is unusable (triggers 1 retry)
//   cache / bypassCache control reuse of identical earlier answers
async function callAIJson({ system, prompt, maxTokens = 2000, normalize, validate, cache = true, bypassCache = false }) {
  const c = cfg();
  const initialTokens = Math.min(Math.max(256, Number(maxTokens) || 2000), c.maxOutputTokens);
  const useCache = cache && c.cacheEnabled;
  const key = useCache ? cacheKeyFor({ system, prompt, maxTokens: initialTokens }) : null;
  const validateValue = (value) => { if (validate) validate(value); return value; };

  const generate = async () => {
    if (useCache && !bypassCache) {
      const stored = await dbCacheGet(key, c.cacheTtlMs);
      if (stored !== undefined) {
        try { return { value: validateValue(stored), cacheable: true, fromDb: true }; }
        catch { await dbCacheDelete(key); }
      }
    }
    const strictPrompt = `${prompt}\n\nFINAL OUTPUT CONTRACT: Return one and only one complete valid JSON value. Do not wrap it in markdown or add text before or after it.`;
    let lastError;
    let tokens = initialTokens;
    const maxAttempts = Math.min(3, Math.max(1, c.maxRetries + 1));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const retryPrompt = attempt === 0 ? strictPrompt :
        `${strictPrompt}\n\nRECOVERY: The previous attempt was empty, truncated, or invalid. Return COMPLETE concise JSON. Preserve required keys and shorten descriptions rather than stopping mid-value.`;
      const retrySystem = attempt === 0 ? system :
        `${system}\n\nStrict recovery mode: output only complete RFC 8259 JSON. Never output reasoning, markdown, or explanatory prose.`;
      try {
        const result = await callProvider({ system: retrySystem, prompt: retryPrompt, maxTokens: tokens, jsonMode: true });
        if (result.finishReason === 'length') throw aiError('AI output was truncated.', 502, { code: 'AI_TRUNCATED_RESPONSE' });
        const parsed = parseJsonLoose(result.text);
        if (parsed.repaired === 'truncated') throw aiError('AI returned incomplete JSON; partial JSON was rejected.', 502, { code: 'AI_INCOMPLETE_JSON' });
        const value = validateValue(normalize ? normalize(parsed.value) : parsed.value);
        return { value, cacheable: true };
      } catch (err) {
        lastError = err;
        const retryable = ['AI_EMPTY_RESPONSE','AI_TRUNCATED_RESPONSE','AI_INCOMPLETE_JSON'].includes(err.code)
          || err.message === 'AI response was not valid JSON.' || /came back empty/.test(err.message);
        if (!retryable) throw err;
        if (attempt >= maxAttempts - 1) break;
        const nextTokens = Math.min(c.maxOutputTokens, Math.max(tokens + 256, Math.ceil(tokens * c.retryTokenMultiplier)));
        if (nextTokens === tokens && err.code === 'AI_TRUNCATED_RESPONSE') break;
        tokens = nextTokens;
        await sleep(Math.min(1200, 250 * (attempt + 1)));
      }
    }
    if (lastError?.code === 'AI_EMPTY_RESPONSE' || lastError?.code === 'AI_TRUNCATED_RESPONSE') {
      throw aiError(lastError.code === 'AI_TRUNCATED_RESPONSE'
        ? `The model could not complete this response within the configured ${c.maxOutputTokens}-token output budget. Try a model with a larger output limit or select fewer sources.`
        : 'The AI provider repeatedly returned no final answer. Try another model or retry shortly.',
        502, { code: lastError.code, cause: lastError });
    }
    throw aiError('The AI could not produce a valid structured response after the allowed attempts. No incomplete result was saved.', 502, {
      code: 'AI_INVALID_STRUCTURED_RESPONSE', cause: lastError,
    });
  };
  if (!useCache) return (await generate()).value;
  const result = await memoryCache.wrap(key, async () => {
    const out = await generate();
    if (out.cacheable && !out.fromDb) dbCacheSet(key, out.value);
    return out;
  }, { bypass: bypassCache, shouldCache: (out) => Boolean(out && out.cacheable) });
  return clone(result.value);
}

function cacheStats() {
  return { ai: memoryCache.stats() };
}

module.exports = {
  callAI,
  callAIJson,
  parseJsonResponse,
  parseJsonLoose,
  extractJsonCandidate,
  pruneAiCache,
  cacheStats,
  aiError,
};
