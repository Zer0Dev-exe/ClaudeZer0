import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const usageFilePath = path.resolve(__dirname, '..', 'data', 'usage.json');

let usage = loadUsage();

function emptyUsage() {
  return { since: Date.now(), models: {} };
}

function loadUsage() {
  try {
    if (fs.existsSync(usageFilePath)) {
      const parsed = JSON.parse(fs.readFileSync(usageFilePath, 'utf-8'));
      if (parsed && parsed.models) return parsed;
    }
  } catch (err) {
    console.warn('Error leyendo usage.json:', err.message);
  }
  return emptyUsage();
}

function saveUsage() {
  try {
    fs.mkdirSync(path.dirname(usageFilePath), { recursive: true });
    fs.writeFileSync(usageFilePath, JSON.stringify(usage, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error guardando usage.json:', err.message);
  }
}

/**
 * Resumen del coste de una respuesta a partir del evento `result` de Claude Code.
 * El CLI calcula `costUSD` por modelo a precio de tarifa de la API (costBasis "list").
 */
export function summarizeResultCost(resultEvent) {
  if (!resultEvent || typeof resultEvent !== 'object') return null;
  const byModel = {};
  for (const [modelId, u] of Object.entries(resultEvent.modelUsage || {})) {
    byModel[modelId] = {
      costUSD: Number(u.costUSD) || 0,
      inputTokens: u.inputTokens || 0,
      outputTokens: u.outputTokens || 0,
      cacheReadTokens: u.cacheReadInputTokens || 0,
      cacheWriteTokens: u.cacheCreationInputTokens || 0
    };
  }
  const totalCostUSD = Number(resultEvent.total_cost_usd);
  if (!Number.isFinite(totalCostUSD) && Object.keys(byModel).length === 0) return null;
  return {
    totalCostUSD: Number.isFinite(totalCostUSD) ? totalCostUSD : Object.values(byModel).reduce((s, m) => s + m.costUSD, 0),
    byModel
  };
}

/**
 * Acumular el gasto de una respuesta en el total por modelo
 */
export function recordUsage(costSummary) {
  if (!costSummary) return;
  for (const [modelId, u] of Object.entries(costSummary.byModel)) {
    const acc = usage.models[modelId] || {
      costUSD: 0, responses: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, lastUsed: 0
    };
    acc.costUSD += u.costUSD;
    acc.responses += 1;
    acc.inputTokens += u.inputTokens;
    acc.outputTokens += u.outputTokens;
    acc.cacheReadTokens += u.cacheReadTokens;
    acc.cacheWriteTokens += u.cacheWriteTokens;
    acc.lastUsed = Date.now();
    usage.models[modelId] = acc;
  }
  saveUsage();
}

export function getUsage() {
  const totalCostUSD = Object.values(usage.models).reduce((s, m) => s + m.costUSD, 0);
  return { since: usage.since, totalCostUSD, models: usage.models };
}

export function resetUsage() {
  usage = emptyUsage();
  saveUsage();
  return getUsage();
}

// --------------------------------------------------------------------------
// Límites de uso de la suscripción (Pro/Max), los mismos que muestra claude.ai
// --------------------------------------------------------------------------
const PLAN_LIMITS_URL = 'https://api.anthropic.com/api/oauth/usage';
const PLAN_LIMITS_CACHE_MS = 60 * 1000;
let planLimitsCache = null;

function normalizeWindow(w) {
  if (!w || typeof w.utilization !== 'number') return null;
  return { percent: Math.max(0, Math.min(100, w.utilization)), resetsAt: w.resets_at || null };
}

/**
 * Consultar el porcentaje gastado de la sesión actual (5 h) y de los límites semanales
 * con el token OAuth de la suscripción. `maxAgeMs` es la antigüedad máxima aceptable de la caché (0 = consultar ya).
 */
export async function getPlanLimits(oauthToken, { maxAgeMs = PLAN_LIMITS_CACHE_MS } = {}) {
  if (!oauthToken) {
    return { success: false, message: 'No hay una suscripción de Claude vinculada en el anfitrión (pnpm auth:login).' };
  }
  if (planLimitsCache && Date.now() - planLimitsCache.fetchedAt < maxAgeMs) {
    return planLimitsCache;
  }

  try {
    const res = await fetch(PLAN_LIMITS_URL, {
      headers: { authorization: `Bearer ${oauthToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`Error HTTP ${res.status} al consultar los límites del plan`);
    const data = await res.json();

    const weeklyByModel = [
      ['Opus', data.seven_day_opus],
      ['Sonnet', data.seven_day_sonnet]
    ].map(([name, w]) => ({ name, ...normalizeWindow(w) })).filter(w => typeof w.percent === 'number');

    const extra = data.extra_usage;
    const decimals = extra?.decimal_places ?? 2;

    planLimitsCache = {
      success: true,
      fetchedAt: Date.now(),
      session: normalizeWindow(data.five_hour),
      weekly: normalizeWindow(data.seven_day),
      weeklyByModel,
      breakdown: (data.seven_day_breakdown?.rows || []).map(r => ({ name: r.display_name || r.key, percent: r.percent })),
      extraUsage: extra ? {
        enabled: !!extra.is_enabled,
        used: typeof extra.used_credits === 'number' ? extra.used_credits / 10 ** decimals : null,
        limit: typeof extra.monthly_limit === 'number' ? extra.monthly_limit / 10 ** decimals : null,
        currency: extra.currency || 'USD'
      } : null
    };
    return planLimitsCache;
  } catch (err) {
    return { success: false, message: err.message || 'No se pudieron consultar los límites del plan' };
  }
}
