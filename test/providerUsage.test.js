import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProviderUsage,
  summarizeLocalUsage,
  summarizeClaudeQuota,
  summarizeCodexQuota,
  summarizeConnection,
  summarizeProviderUsage,
  unavailableQuota
} from '../server/providerUsage.js';

const providerOf = (id) => (/^gpt/.test(id) ? 'codex' : /gemini/.test(id) ? 'gemini' : 'claude');
const PROVIDERS = {
  claude: { name: 'Claude', cli: 'Claude Code' },
  codex: { name: 'ChatGPT', cli: 'Codex' },
  gemini: { name: 'Gemini', cli: 'Gemini CLI' }
};

const alice = {
  'claude-opus-5-5': { costUSD: 2, responses: 3, inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, lastUsed: 200 },
  'claude-sonnet-5-5': { costUSD: 0.5, responses: 1, inputTokens: 20, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, lastUsed: 300 }
};
const bob = { 'claude-opus-5-5': { costUSD: 99, responses: 9, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, lastUsed: 1 } };

const limits = {
  success: true,
  fetchedAt: 123,
  session: { percent: 85, resetsAt: 'x' },
  weekly: { percent: 40, resetsAt: 'y' },
  weeklyByModel: [{ name: 'Opus', percent: 60, resetsAt: 'y' }],
  breakdown: [],
  extraUsage: null
};

function makeDeps(overrides = {}) {
  const calls = { planLimits: [], usage: [] };
  const deps = {
    providers: PROVIDERS,
    providerOf,
    getUsage: (u) => { calls.usage.push(u); return { models: u === 'alice' ? alice : u === 'bob' ? bob : {} }; },
    getPlanLimits: async (token, opts) => { calls.planLimits.push([token, opts]); return limits; },
    getProvidersStatus: () => ({ codex: { loggedIn: true }, gemini: { loggedIn: false, backend: 'gemini' } }),
    getHostOAuthToken: () => 'tok',
    getAppMode: () => 'Subscription',
    getCodexLimits: () => ({ success: false, message: 'sin registro' }),
    ...overrides
  };
  return { deps, calls };
}

test('summarizeLocalUsage: filtra por proveedor y suma tokens', () => {
  const s = summarizeLocalUsage(alice, 'claude', providerOf);
  assert.equal(s.responses, 4);
  assert.equal(s.inputTokens, 120);
  assert.equal(s.outputTokens, 60);
  assert.equal(s.totalTokens, 195);
  assert.equal(s.costUSD, 2.5);
  assert.equal(s.costBasis, 'api-list-price');
  assert.equal(s.lastUsed, 300);
  assert.deepEqual(s.models.map(m => m.id), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.equal(summarizeLocalUsage(alice, 'codex', providerOf).tracked, false);
});

test('summarizeLocalUsage: sin datos de ChatGPT/Gemini no inventa nada', () => {
  const s = summarizeLocalUsage(alice, 'gemini', providerOf);
  assert.equal(s.tracked, false);
  assert.equal(s.responses, 0);
  assert.equal(s.totalTokens, 0);
  assert.equal(s.costBasis, null);
  assert.ok(s.note);
  assert.equal(summarizeLocalUsage({}, 'claude', providerOf).tracked, true);
});

test('summarizeLocalUsage: registros de Codex se muestran como rastreados', () => {
  const s = summarizeLocalUsage({ 'gpt-x': { responses: 2, inputTokens: 5, outputTokens: 5 } }, 'codex', providerOf);
  assert.equal(s.tracked, true);
  assert.equal(s.totalTokens, 10);
  assert.equal(s.note, null);
});

test('summarizeClaudeQuota: cuota explícita de Claude y compartida de la cuenta', () => {
  const q = summarizeClaudeQuota(limits);
  assert.equal(q.available, true);
  assert.equal(q.verified, true);
  assert.equal(q.provider, 'claude');
  assert.equal(q.scope, 'host-account-shared');
  assert.equal(q.session.percent, 85);
  assert.equal(q.weekly.percent, 40);
});

test('summarizeClaudeQuota: fallo, clave de API y modo cliente', () => {
  const failed = summarizeClaudeQuota({ success: false, message: 'boom' });
  assert.equal(failed.available, false);
  assert.equal(failed.reason, 'quota_unreachable');
  assert.equal(failed.message, 'boom');
  assert.equal(summarizeClaudeQuota(limits, { apiKey: true }).reason, 'api_key');
  assert.equal(summarizeClaudeQuota(limits, { appMode: 'Client' }).reason, 'api_key');
});

test('unavailableQuota: Codex y Gemini sin porcentajes', () => {
  for (const id of ['codex', 'gemini']) {
    const q = unavailableQuota(id);
    assert.equal(q.available, false);
    assert.equal(q.verified, false);
    assert.equal(q.reason, 'no_quota_source');
    assert.ok(!('session' in q) && !('weekly' in q) && !('percent' in q));
  }
});

test('summarizeConnection: estados por proveedor', () => {
  const providersStatus = { codex: { loggedIn: true }, gemini: { loggedIn: false, backend: 'antigravity' } };
  assert.equal(summarizeConnection('claude', { hostToken: 't' }).status, 'connected');
  assert.equal(summarizeConnection('claude', {}).status, 'unknown');
  assert.equal(summarizeConnection('claude', { apiKey: true }).status, 'api_key');
  assert.equal(summarizeConnection('codex', { providersStatus }).status, 'connected');
  const g = summarizeConnection('gemini', { providersStatus });
  assert.equal(g.status, 'disconnected');
  assert.equal(g.backend, 'antigravity');
  assert.equal(summarizeConnection('codex', {}).status, 'unknown');
});

test('getProviderUsage: forma completa, etiquetas y solo uso del usuario', async () => {
  const { deps, calls } = makeDeps();
  const res = await getProviderUsage('alice', { deps });
  assert.equal(res.success, true);
  assert.equal(res.scope, 'user');
  assert.deepEqual(res.providers.map(p => p.id), ['claude', 'codex', 'gemini']);
  assert.deepEqual(res.providers.map(p => p.label), ['Claude', 'ChatGPT', 'Gemini']);
  const [claude, codex, gemini] = res.providers;
  assert.equal(claude.localUsage.responses, 4);
  assert.equal(claude.quota.scope, 'host-account-shared');
  assert.equal(codex.connection.status, 'connected');
  assert.equal(codex.quota.available, false);
  assert.equal(gemini.connection.status, 'disconnected');
  assert.equal(gemini.quota.available, false);
  assert.deepEqual(calls.usage, ['alice']);
  assert.deepEqual(calls.planLimits, [['tok', {}]]);
});

test('getProviderUsage: no mezcla usuarios ni usa el total global sin usuario', async () => {
  const { deps } = makeDeps();
  const b = await getProviderUsage('bob', { deps });
  assert.equal(b.providers[0].localUsage.costUSD, 99);
  const none = await getProviderUsage(null, { deps });
  assert.equal(none.providers[0].localUsage.responses, 0);
});

test('getProviderUsage: force salta la caché de Claude', async () => {
  const { deps, calls } = makeDeps();
  await getProviderUsage('alice', { force: true, deps });
  assert.deepEqual(calls.planLimits, [['tok', { maxAgeMs: 0 }]]);
});

test('getProviderUsage: con clave de API no consulta la cuota', async () => {
  const { deps, calls } = makeDeps();
  const res = await getProviderUsage('alice', { apiKey: true, deps });
  assert.equal(calls.planLimits.length, 0);
  assert.equal(res.providers[0].quota.reason, 'api_key');
  assert.equal(res.providers[0].connection.status, 'api_key');
});

test('getProviderUsage: errores de cuota o estado no rompen la respuesta', async () => {
  const { deps } = makeDeps({
    getPlanLimits: async () => { throw new Error('red caída'); },
    getProvidersStatus: () => { throw new Error('sin cli'); }
  });
  const res = await getProviderUsage('alice', { deps });
  assert.equal(res.success, true);
  assert.equal(res.providers[0].quota.reason, 'quota_unreachable');
  assert.equal(res.providers[1].connection.status, 'unknown');
});

test('summarizeProviderUsage: Codex turn.completed separa la caché de la entrada', () => {
  const usage = { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 50, reasoning_output_tokens: 20 };
  const s = summarizeProviderUsage('codex', 'gpt-x', { success: true, result: { usage } });
  assert.deepEqual(s.byModel, {
    'gpt-x': { costUSD: 0, inputTokens: 600, outputTokens: 50, cacheReadTokens: 400, cacheWriteTokens: 0 }
  });
  assert.equal(s.totalCostUSD, 0);
  assert.deepEqual(s.metrics, { available: true, source: 'codex-turn-completed', reason: null });
});

test('summarizeProviderUsage: Gemini CLI stats (total_tokens/input_tokens/output_tokens/cached/input)', () => {
  const stats = {
    total_tokens: 1200, input_tokens: 1000, output_tokens: 150, cached: 300, input: 700,
    duration_ms: 4000, tool_calls: 2,
    models: { 'gemini-3.1-pro-preview': { total_tokens: 1200, input_tokens: 1000, output_tokens: 150, cached: 300, input: 700 } }
  };
  const s = summarizeProviderUsage('gemini', 'gemini-3.1-pro-preview', { result: { duration_ms: 4000, usage: stats } });
  assert.deepEqual(s.byModel['gemini-3.1-pro-preview'], {
    costUSD: 0, inputTokens: 700, outputTokens: 150, cacheReadTokens: 300, cacheWriteTokens: 0
  });
  assert.equal(s.metrics.source, 'gemini-cli-stats');
  const noInput = summarizeProviderUsage('gemini', 'g', { result: { usage: { input_tokens: 100, output_tokens: 5, cached: 40 } } });
  assert.equal(noInput.byModel.g.inputTokens, 60);
});

test('summarizeProviderUsage: sin tokens cuenta la respuesta sin inventar datos', () => {
  for (const result of [null, { success: true, result: null }, { result: { usage: {} } }, { result: { usage: { foo: 1 } } }]) {
    const s = summarizeProviderUsage('codex', 'gpt-x', result);
    assert.deepEqual(s.byModel['gpt-x'], { costUSD: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    assert.deepEqual(s.metrics, { available: false, source: null, reason: 'no_token_source' });
  }
  assert.ok(summarizeProviderUsage('gemini', '', {}).byModel.gemini);
  assert.equal(summarizeProviderUsage('claude', 'claude-opus-5-5', {}), null);
});

test('summarizeLocalUsage: respuestas sin tokens quedan reconocidas con nota', () => {
  const models = { 'gpt-x': { responses: 3, costUSD: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  const s = summarizeLocalUsage(models, 'codex', providerOf);
  assert.equal(s.tracked, true);
  assert.equal(s.responses, 3);
  assert.equal(s.tokensAvailable, false);
  assert.match(s.note, /no informó tokens/);
  assert.match(summarizeLocalUsage({}, 'codex', providerOf).note, /no equivale a 0 %/);
});

test('summarizeProviderUsage: campos nulos no son tokens verificados', () => {
  for (const provider of ['codex', 'gemini']) {
    const summary = summarizeProviderUsage(provider, '', { usage: { input_tokens: null, output_tokens: '' } });
    assert.equal(summary.metrics.available, false);
  }
});

test('summarizeProviderUsage: Antigravity no reutiliza un esquema de tokens no verificado', () => {
  const summary = summarizeProviderUsage('gemini', 'gemini-test', {
    result: { usageSource: 'antigravity', usage: { input_tokens: 100, output_tokens: 20 } }
  });
  assert.equal(summary.metrics.available, false);
  assert.equal(summary.byModel['gemini-test'].inputTokens, 0);
});

test('summarizeCodexQuota: cuota de ChatGPT con ventanas de sesión y semana', () => {
  const quota = summarizeCodexQuota({
    success: true, plan: 'plus', fetchedAt: 'x',
    session: { percent: 22, resetsAt: 'a' }, weekly: { percent: 3, resetsAt: 'b' }
  });
  assert.equal(quota.available, true);
  assert.equal(quota.verified, true);
  assert.equal(quota.session.percent, 22);
  assert.equal(quota.weekly.percent, 3);
  assert.equal(summarizeCodexQuota({ success: false, message: 'm' }).available, false);
});
