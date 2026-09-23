import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pricingFilePath = path.resolve(__dirname, '..', 'data', 'pricing.json');

// Página oficial de precios en Markdown (la misma tabla que platform.claude.com/docs/en/about-claude/pricing)
const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md';
const REFRESH_MS = 24 * 60 * 60 * 1000;

let cache = loadCache();

function loadCache() {
  try {
    if (fs.existsSync(pricingFilePath)) {
      const parsed = JSON.parse(fs.readFileSync(pricingFilePath, 'utf-8'));
      if (parsed && parsed.models) return parsed;
    }
  } catch (err) {
    console.warn('Error leyendo pricing.json:', err.message);
  }
  return { fetchedAt: 0, source: PRICING_URL, models: {} };
}

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/^claude\s+/, '').replace(/\s+/g, ' ').trim();
}

function parseDollars(cell) {
  const match = String(cell).replace(/<[^>]+>/g, '').match(/\$\s*([\d.,]+)/);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

/**
 * Extraer la tabla de precios por modelo del Markdown oficial.
 * Localiza las columnas por su cabecera, así sigue funcionando aunque cambie el orden.
 */
export function parsePricingMarkdown(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const headerIdx = lines.findIndex(l => /^\|\s*Model\s*\|/i.test(l) && /input/i.test(l) && /output/i.test(l));
  if (headerIdx < 0) return {};

  const headers = lines[headerIdx].split('|').slice(1, -1).map(h => h.trim().toLowerCase());
  const col = (re) => headers.findIndex(h => re.test(h));
  const cols = {
    input: col(/base input/),
    cacheWrite5m: col(/5m cache/),
    cacheWrite1h: col(/1h cache/),
    cacheRead: col(/cache hits/),
    output: col(/^output/)
  };
  if (cols.input < 0 || cols.output < 0) return {};

  const models = {};
  for (let i = headerIdx + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
    // "Claude Opus 4.1 ([retired, ...](...))" -> "Claude Opus 4.1"
    const name = cells[0].replace(/\s*\(.*$/, '').trim();
    if (!name || /retired/i.test(cells[0])) continue;
    const entry = {};
    for (const [key, idx] of Object.entries(cols)) {
      if (idx >= 0) entry[key] = parseDollars(cells[idx]);
    }
    if (entry.input != null && entry.output != null) {
      models[normalizeName(name)] = { name, ...entry };
    }
  }
  return models;
}

/**
 * Descargar y cachear los precios oficiales (como mucho una vez al día salvo que se fuerce)
 */
export async function refreshPricing({ force = false } = {}) {
  if (!force && Date.now() - cache.fetchedAt < REFRESH_MS && Object.keys(cache.models).length > 0) {
    return { success: true, cached: true, count: Object.keys(cache.models).length };
  }
  try {
    const res = await fetch(PRICING_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const models = parsePricingMarkdown(await res.text());
    if (Object.keys(models).length === 0) throw new Error('No se encontró la tabla de precios');
    cache = { fetchedAt: Date.now(), source: PRICING_URL, models };
    fs.mkdirSync(path.dirname(pricingFilePath), { recursive: true });
    fs.writeFileSync(pricingFilePath, JSON.stringify(cache, null, 2), 'utf-8');
    return { success: true, cached: false, count: Object.keys(models).length };
  } catch (err) {
    return { success: false, message: err.message, count: Object.keys(cache.models).length };
  }
}

/**
 * Precio por millón de tokens de un modelo a partir de su nombre visible ("Claude Opus 5.5")
 */
export function getModelPricing(displayName) {
  const entry = cache.models[normalizeName(displayName)];
  return entry
    ? {
        input: entry.input,
        output: entry.output,
        cacheRead: entry.cacheRead ?? null,
        cacheWrite5m: entry.cacheWrite5m ?? null,
        cacheWrite1h: entry.cacheWrite1h ?? null
      }
    : null;
}

export function getPricingInfo() {
  return { fetchedAt: cache.fetchedAt, source: cache.source, count: Object.keys(cache.models).length };
}
