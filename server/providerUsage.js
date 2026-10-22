import { getCodexLimits } from './codexLimits.js';

const PROVIDER_ORDER = ['claude', 'codex', 'gemini'];

const FALLBACK_PROVIDERS = {
  claude: { name: 'Claude', cli: 'Claude Code' },
  codex: { name: 'ChatGPT', cli: 'Codex' },
  gemini: { name: 'Gemini', cli: 'Gemini CLI' }
};

const QUOTA_UNAVAILABLE = {
  codex: {
    code: 'no_quota_source',
    message: 'La cuota de la suscripción de ChatGPT no está disponible en esta conexión. Los tokens locales no equivalen a la cuota.'
  },
  gemini: {
    code: 'no_quota_source',
    message: 'La cuota de la suscripción de Google AI no está disponible en esta conexión. Los tokens locales no equivalen a la cuota.'
  }
};

const NOT_TRACKED_NOTE = {
  codex: 'Aún no hay respuestas de ChatGPT registradas. El uso anterior a esta función no se contabilizó y no equivale a 0 % de la suscripción.',
  gemini: 'Aún no hay respuestas de Gemini registradas. El uso anterior a esta función no se contabilizó y no equivale a 0 % de la suscripción.'
};

const NO_TOKENS_NOTE = 'Respuestas contadas; el proveedor no informó tokens en ellas. Los tokens son locales y no equivalen a la cuota de la suscripción.';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function defaultProviderOf(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (/^(gpt|o\d|codex)/.test(id)) return 'codex';
  if (id.includes('gemini')) return 'gemini';
  return 'claude';
}

export function summarizeLocalUsage(models, provider, providerOf = defaultProviderOf) {
  const rows = Object.entries(models || {})
    .filter(([modelId]) => providerOf(modelId) === provider)
    .map(([modelId, m]) => {
      const inputTokens = num(m?.inputTokens);
      const outputTokens = num(m?.outputTokens);
      const cacheReadTokens = num(m?.cacheReadTokens);
      const cacheWriteTokens = num(m?.cacheWriteTokens);
      return {
        id: modelId,
        responses: num(m?.responses),
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
        costUSD: num(m?.costUSD),
        lastUsed: num(m?.lastUsed) || null
      };
    })
    .sort((a, b) => b.costUSD - a.costUSD || b.responses - a.responses || a.id.localeCompare(b.id));

  const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
  const responses = sum('responses');
  const tracked = provider === 'claude' || responses > 0;
  const totalTokens = sum('totalTokens');
  const note = !tracked
    ? (NOT_TRACKED_NOTE[provider] || null)
    : provider !== 'claude' && totalTokens === 0 ? NO_TOKENS_NOTE : null;
  return {
    scope: 'user',
    tracked,
    responses,
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    totalTokens,
    tokensAvailable: totalTokens > 0,
    costUSD: sum('costUSD'),
    costBasis: tracked && sum('costUSD') > 0 ? 'api-list-price' : null,
    lastUsed: rows.reduce((max, r) => Math.max(max, r.lastUsed || 0), 0) || null,
    models: rows,
    note
  };
}

function count(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function normalizeCodexUsage(u) {
  const input = count(u.input_tokens);
  const output = count(u.output_tokens);
  if (input === null && output === null) return null;
  const cached = Math.min(count(u.cached_input_tokens) ?? 0, input ?? 0);
  return {
    source: 'codex-turn-completed',
    inputTokens: (input ?? 0) - cached,
    outputTokens: output ?? 0,
    cacheReadTokens: cached,
    cacheWriteTokens: 0
  };
}

function normalizeGeminiUsage(u) {
  const prompt = count(u.input_tokens);
  const output = count(u.output_tokens);
  if (prompt === null && output === null) return null;
  const cached = Math.min(count(u.cached) ?? 0, prompt ?? 0);
  const fresh = count(u.input);
  return {
    source: 'gemini-cli-stats',
    inputTokens: fresh !== null ? fresh : (prompt ?? 0) - cached,
    outputTokens: output ?? 0,
    cacheReadTokens: cached,
    cacheWriteTokens: 0
  };
}

export function summarizeProviderUsage(provider, modelId, result) {
  if (provider !== 'codex' && provider !== 'gemini') return null;
  const raw = result?.result?.usage ?? result?.usage ?? result;
  const usage = raw && typeof raw === 'object' ? raw : {};
  const source = result?.result?.usageSource ?? result?.usageSource;
  const tokens = source === 'antigravity' ? null : provider === 'codex' ? normalizeCodexUsage(usage) : normalizeGeminiUsage(usage);
  return {
    totalCostUSD: 0,
    byModel: {
      [String(modelId || provider)]: {
        costUSD: 0,
        inputTokens: tokens?.inputTokens ?? 0,
        outputTokens: tokens?.outputTokens ?? 0,
        cacheReadTokens: tokens?.cacheReadTokens ?? 0,
        cacheWriteTokens: tokens?.cacheWriteTokens ?? 0
      }
    },
    metrics: tokens
      ? { available: true, source: tokens.source, reason: null }
      : { available: false, source: null, reason: 'no_token_source' }
  };
}

export function unavailableQuota(provider, reason) {
  const base = reason || QUOTA_UNAVAILABLE[provider] || { code: 'no_quota_source', message: 'Sin fuente de cuota verificada.' };
  return {
    available: false,
    verified: false,
    provider,
    scope: null,
    source: null,
    reason: base.code,
    message: base.message
  };
}

export function summarizeClaudeQuota(limits, { apiKey = false, appMode = null } = {}) {
  if (apiKey || appMode === 'Client') {
    return unavailableQuota('claude', {
      code: 'api_key',
      message: 'Con una clave de API no hay límites de suscripción de Claude.'
    });
  }
  if (!limits || limits.success !== true) {
    return unavailableQuota('claude', {
      code: 'quota_unreachable',
      message: limits?.message || 'No se pudieron consultar los límites del plan de Claude.'
    });
  }
  return {
    available: true,
    verified: true,
    provider: 'claude',
    scope: 'host-account-shared',
    scopeLabel: 'Cuota de la cuenta de Claude del anfitrión, compartida por todos los usuarios y dispositivos',
    source: 'anthropic-oauth-usage',
    label: 'Claude',
    fetchedAt: limits.fetchedAt || null,
    session: limits.session || null,
    weekly: limits.weekly || null,
    weeklyByModel: Array.isArray(limits.weeklyByModel) ? limits.weeklyByModel : [],
    breakdown: Array.isArray(limits.breakdown) ? limits.breakdown : [],
    extraUsage: limits.extraUsage || null,
    reason: null,
    message: null
  };
}

export function summarizeCodexQuota(limits) {
  if (!limits || limits.success !== true || (!limits.session && !limits.weekly)) return unavailableQuota('codex', limits?.message ? { code: 'quota_unreachable', message: limits.message } : undefined);
  return {
    available: true,
    verified: true,
    provider: 'codex',
    scope: 'host-account-shared',
    scopeLabel: `Cuota de la suscripción de ChatGPT${limits.plan ? ` (${limits.plan})` : ''} del anfitrión, según el último uso de Codex`,
    source: 'codex-rate-limits',
    label: 'ChatGPT',
    fetchedAt: limits.fetchedAt || null,
    session: limits.session || null,
    weekly: limits.weekly || null,
    weeklyByModel: [],
    breakdown: [],
    extraUsage: null,
    reason: null,
    message: null
  };
}

export function summarizeConnection(provider, { providersStatus = {}, hostToken = null, apiKey = false, appMode = null } = {}) {
  if (provider === 'claude') {
    if (apiKey || appMode === 'Client') {
      return { status: 'api_key', loggedIn: true, via: 'api-key', backend: null };
    }
    return hostToken
      ? { status: 'connected', loggedIn: true, via: 'subscription', backend: null }
      : { status: 'unknown', loggedIn: null, via: 'subscription', backend: null };
  }
  const st = providersStatus?.[provider];
  if (!st || typeof st.loggedIn !== 'boolean') {
    return { status: 'unknown', loggedIn: null, via: 'subscription', backend: st?.backend || null };
  }
  return {
    status: st.loggedIn ? 'connected' : 'disconnected',
    loggedIn: st.loggedIn,
    via: 'subscription',
    backend: st.backend || null
  };
}

async function loadDefaultDeps() {
  const [usage, providers, models, runner] = await Promise.all([
    import('./usageManager.js'),
    import('./providers.js'),
    import('./modelsManager.js'),
    import('./claudeRunner.js')
  ]);
  return {
    getUsage: usage.getUsage,
    getPlanLimits: usage.getPlanLimits,
    getProvidersStatus: providers.getProvidersStatus,
    providerOf: providers.providerOf,
    providers: providers.PROVIDERS,
    getHostOAuthToken: models.getHostOAuthToken,
    getAppMode: runner.getAppMode
  };
}

export async function getProviderUsage(username, { force = false, apiKey = false, deps } = {}) {
  const d = deps || await loadDefaultDeps();
  const providerOf = d.providerOf || defaultProviderOf;
  const catalog = d.providers || FALLBACK_PROVIDERS;
  const appMode = d.getAppMode ? d.getAppMode() : null;
  const hostToken = d.getHostOAuthToken ? d.getHostOAuthToken() : null;
  const usingApiKey = !!apiKey;
  const clientMode = appMode === 'Client';

  let providersStatus = {};
  try {
    providersStatus = (d.getProvidersStatus && d.getProvidersStatus()) || {};
  } catch {
    providersStatus = {};
  }

  const models = username && d.getUsage ? (d.getUsage(username)?.models || {}) : {};

  let claudeLimits = null;
  if (!usingApiKey && !clientMode && d.getPlanLimits) {
    try {
      claudeLimits = await d.getPlanLimits(hostToken, force ? { maxAgeMs: 0 } : {});
    } catch (err) {
      claudeLimits = { success: false, message: err?.message || 'No se pudieron consultar los límites del plan' };
    }
  }

  const providers = PROVIDER_ORDER.map((id) => {
    const meta = catalog[id] || FALLBACK_PROVIDERS[id];
    return {
      id,
      name: meta.name,
      cli: meta.cli,
      label: meta.name,
      connection: summarizeConnection(id, { providersStatus, hostToken, apiKey: usingApiKey, appMode }),
      localUsage: summarizeLocalUsage(models, id, providerOf),
      quota: id === 'claude'
        ? summarizeClaudeQuota(claudeLimits, { apiKey: usingApiKey, appMode })
        : id === 'codex'
          ? summarizeCodexQuota((d.getCodexLimits || getCodexLimits)())
          : unavailableQuota(id)
    };
  });

  return { success: true, generatedAt: Date.now(), scope: 'user', providers };
}
