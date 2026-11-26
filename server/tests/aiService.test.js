const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER = 'openrouter';
process.env.AI_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
process.env.AI_API_KEY = 'test-key';
process.env.AI_MODEL = 'test-model';
process.env.AI_CACHE = 'off';
process.env.AI_MAX_RETRIES = '2';
process.env.AI_MAX_OUTPUT_TOKENS = '3000';

const { callAIJson, parseJsonLoose } = require('../services/aiService');

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null },
    text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) };
}
function choice(content, finish_reason = 'stop') {
  return { id: 'mock', choices: [{ message: { content }, finish_reason }], usage: { completion_tokens: 100 } };
}

test('parses JSON wrapped in a markdown fence', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"ok":true}\n```').value, { ok: true });
});

test('retries finish_reason length with an increased token budget', async () => {
  const calls = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body.max_tokens);
    if (calls.length === 1) return response(choice('', 'length'));
    return response(choice('{"ok":true}', 'stop'));
  };
  const value = await callAIJson({ system: 'sys', prompt: 'task', maxTokens: 500,
    cache: false, validate: (v) => { if (!v.ok) throw new Error('missing ok'); } });
  assert.deepEqual(value, { ok: true });
  assert.ok(calls.length === 2 && calls[1] > calls[0]);
});

test('does not accept truncated JSON repaired by the parser', async () => {
  global.fetch = async () => response(choice('{"ok":true,', 'stop'));
  await assert.rejects(
    callAIJson({ system: 'sys', prompt: 'task', maxTokens: 500, cache: false }),
    /valid structured response|no final answer|could not produce/i
  );
});

test('does not mistake reasoning-only output for final text', async () => {
  global.fetch = async () => response({ choices: [{ message: { content: null, reasoning: 'internal reasoning' }, finish_reason: 'stop' }] });
  await assert.rejects(
    callAIJson({ system: 'sys', prompt: 'task', maxTokens: 500, cache: false }),
    /no final answer|valid structured response/i
  );
});

test('does not retry authentication failures as empty responses', async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; return response({ error: { message: 'bad key' } }, 401); };
  await assert.rejects(callAIJson({ system: 'sys', prompt: 'task', cache: false }), /rejected the API key/i);
  assert.equal(calls, 1);
});

test('does not cache failed structured generations', async () => {
  process.env.AI_CACHE = 'on';
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(choice('not-json', 'stop'));
  };
  const args = { system: 'cache-test-system', prompt: 'cache-test-prompt', maxTokens: 500 };
  await assert.rejects(callAIJson(args));
  const afterFirst = calls;
  await assert.rejects(callAIJson(args));
  assert.equal(calls - afterFirst, afterFirst, 'second failed call must reach provider again');
  process.env.AI_CACHE = 'off';
});
