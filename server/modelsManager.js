import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const modelsFilePath = path.join(projectRoot, 'data', 'models.json');

const ANTHROPIC_API = 'https://api.anthropic.com';

// Familias de modelos, en el orden en que se muestran en el selector
const FAMILIES = {
  fable: { tag: 'Máximo', badge: 'Nuevo', desc: 'Para tus desafíos más difíciles', icon: 'opus' },
  opus: { tag: 'Profundo', badge: 'Recomendado', desc: 'El más capaz para trabajos ambiciosos', icon: 'opus' },
  sonnet: { tag: 'Equilibrado', badge: 'Eficiente', desc: 'Lo más eficiente para las tareas diarias', icon: 'sonnet' },
  haiku: { tag: 'Ultrarrápido', badge: 'Rápido', desc: 'La más rápida para respuestas inmediatas', icon: 'haiku' }
};
const FAMILY_ORDER = Object.keys(FAMILIES);

// Familia que se selecciona por defecto
const DEFAULT_FAMILY = 'opus';

// Catálogo de respaldo, solo para cuando todavía no se ha podido consultar la API
const FALLBACK_MODELS = [
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' }
].map(m => buildModelEntry(m.id, m.name));

function getFamily(id) {
  const lower = String(id || '').toLowerCase();
  return FAMILY_ORDER.find(f => lower.includes(f)) || null;
}

function buildModelEntry(id, name, createdAt = null) {
  const family = getFamily(id);
  const meta = FAMILIES[family] || { tag: 'Reciente', badge: 'Anthropic', desc: `Modelo ${name}`, icon: 'sonnet' };
  return {
    id,
    name,
    tag: meta.tag,
    badge: meta.badge,
    desc: meta.desc,
    icon: meta.icon,
    source: 'anthropic',
    ...(createdAt ? { createdAt } : {}),
    ...(family === DEFAULT_FAMILY ? { isDefault: true } : {})
  };
}

// Modelos añadidos a mano por el usuario (los que no vienen de Anthropic ni del catálogo base)
function isUserModel(m) {
  if (m.source === 'anthropic') return false;
  if (!m.custom) return false;
  // Entradas de sincronizaciones antiguas que se marcaban como custom
  if (m.badge === 'Oficial' || m.badge === 'Anthropic') return false;
  return true;
}

// Modelos retirados (Claude 3.x y alias genéricos antiguos)
function isLegacyModel(m) {
  const id = String(m.id || '').toLowerCase();
  const name = String(m.name || '').toLowerCase();
  return /^claude-3/.test(id) || /claude 3(\.\d)?\b/.test(name) || (['sonnet', 'haiku', 'opus'].includes(id) && !m.custom);
}

/**
 * Cargar lista de modelos persistida o inicializar con el catálogo de respaldo
 */
export function getAvailableModels() {
  try {
    if (fs.existsSync(modelsFilePath)) {
      const content = fs.readFileSync(modelsFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const kept = parsed.filter(m => !isLegacyModel(m));
        if (kept.length === 0) {
          saveModels(FALLBACK_MODELS);
          return FALLBACK_MODELS;
        }
        if (kept.length !== parsed.length) {
          saveModels(kept);
        }
        return kept;
      }
    }
  } catch (err) {
    console.warn('Error leyendo models.json, usando valores por defecto:', err.message);
  }

  saveModels(FALLBACK_MODELS);
  return FALLBACK_MODELS;
}

/**
 * ID del modelo por defecto según el catálogo actual (el Opus más reciente)
 */
export function getDefaultModelId() {
  const models = getAvailableModels();
  const def = models.find(m => m.isDefault) || models.find(m => getFamily(m.id) === DEFAULT_FAMILY) || models[0];
  return def ? def.id : FALLBACK_MODELS[1].id;
}

/**
 * Guardar lista de modelos en data/models.json
 */
export function saveModels(modelsList) {
  try {
    const dir = path.dirname(modelsFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(modelsFilePath, JSON.stringify(modelsList, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error guardando models.json:', err.message);
    return false;
  }
}

/**
 * Añadir o actualizar un modelo dinámicamente
 */
export function addOrUpdateModel({ id, name, tag, badge, desc, icon }) {
  if (!id || !name) {
    throw new Error('El ID y el nombre del modelo son obligatorios');
  }

  const cleanId = String(id).trim();
  const cleanName = String(name).trim();
  const models = getAvailableModels();

  const existingIdx = models.findIndex(m => m.id.toLowerCase() === cleanId.toLowerCase());
  const newModel = {
    id: cleanId,
    name: cleanName,
    tag: tag ? String(tag).trim() : 'Personalizado',
    badge: badge ? String(badge).trim() : 'Nuevo',
    desc: desc ? String(desc).trim() : `Modelo personalizado ${cleanName}`,
    icon: icon || (FAMILIES[getFamily(cleanId)]?.icon ?? 'sonnet'),
    custom: true,
    addedAt: Date.now()
  };

  if (existingIdx >= 0) {
    models[existingIdx] = { ...models[existingIdx], ...newModel };
  } else {
    models.push(newModel);
  }

  saveModels(models);
  return newModel;
}

/**
 * Eliminar un modelo personalizado
 */
export function deleteCustomModel(id) {
  if (!id) return false;
  const models = getAvailableModels();
  const filtered = models.filter(m => m.id.toLowerCase() !== id.toLowerCase());
  if (filtered.length === models.length) {
    return false;
  }
  // Asegurar que al menos quede un modelo
  saveModels(filtered.length === 0 ? FALLBACK_MODELS : filtered);
  return true;
}

/**
 * Token OAuth de la sesión del CLI de Claude Code del anfitrión (suscripción Pro/Max).
 * Solo existe en disco en Windows/Linux; en macOS está en el llavero y devuelve null.
 */
export function getHostOAuthToken() {
  try {
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const credsPath = path.join(configDir, '.credentials.json');
    if (!fs.existsSync(credsPath)) return null;
    const oauth = JSON.parse(fs.readFileSync(credsPath, 'utf-8')).claudeAiOauth;
    if (!oauth?.accessToken) return null;
    if (oauth.expiresAt && Date.now() >= oauth.expiresAt) return null;
    return oauth.accessToken;
  } catch {
    return null;
  }
}

/**
 * Consultar todos los modelos disponibles en GET /v1/models (con paginación)
 * credential: { apiKey } o { oauthToken }
 */
async function fetchRemoteModels(credential) {
  const headers = { 'anthropic-version': '2023-06-01' };
  if (credential.apiKey) {
    headers['x-api-key'] = credential.apiKey;
  } else {
    headers['authorization'] = `Bearer ${credential.oauthToken}`;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  }

  const all = [];
  let afterId = null;
  for (let page = 0; page < 20; page++) {
    const url = new URL('/v1/models', ANTHROPIC_API);
    url.searchParams.set('limit', '1000');
    if (afterId) url.searchParams.set('after_id', afterId);

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Error HTTP ${res.status} al consultar modelos de Anthropic`);
    }
    const data = await res.json();
    all.push(...(data.data || []));
    if (!data.has_more || !data.last_id) break;
    afterId = data.last_id;
  }
  return all;
}

/**
 * De la lista remota, quedarse solo con el modelo más reciente de cada familia
 */
function pickLatestPerFamily(remoteModels) {
  const latest = new Map();
  for (const rm of remoteModels) {
    const family = getFamily(rm.id);
    if (!family || /^claude-3/i.test(rm.id)) continue;
    const prev = latest.get(family);
    if (!prev || new Date(rm.created_at) > new Date(prev.created_at)) {
      latest.set(family, rm);
    }
  }
  return FAMILY_ORDER
    .filter(f => latest.has(f))
    .map(f => {
      const rm = latest.get(f);
      return buildModelEntry(rm.id, rm.display_name || rm.id, rm.created_at);
    });
}

/**
 * Sincronizar el catálogo con la API de Anthropic: sustituye los modelos oficiales por los
 * actuales (el más reciente de cada familia) y elimina los antiguos. Conserva los añadidos a mano.
 * credential: { apiKey } o { oauthToken }
 */
export async function syncModelsFromAnthropic(credential) {
  if (!credential || (!credential.apiKey && !credential.oauthToken)) {
    return {
      success: false,
      message: 'No hay credenciales para consultar la API de Anthropic (añade una clave API o inicia sesión con pnpm auth:login).',
      models: getAvailableModels()
    };
  }

  try {
    const remoteModels = await fetchRemoteModels(credential);
    const latest = pickLatestPerFamily(remoteModels);
    if (latest.length === 0) {
      return { success: false, message: 'No se encontraron modelos en la respuesta de Anthropic', models: getAvailableModels() };
    }

    const previous = getAvailableModels();
    const userModels = previous.filter(m => isUserModel(m) && !latest.some(l => l.id === m.id));
    const models = [...latest, ...userModels];

    const previousIds = new Set(previous.map(m => m.id));
    const nextIds = new Set(models.map(m => m.id));
    const added = models.filter(m => !previousIds.has(m.id)).map(m => m.id);
    const removed = previous.filter(m => !nextIds.has(m.id)).map(m => m.id);

    saveModels(models);

    return {
      success: true,
      addedCount: added.length,
      removedCount: removed.length,
      added,
      removed,
      totalCount: models.length,
      models,
      defaultModel: getDefaultModelId()
    };
  } catch (err) {
    return { success: false, message: err.message || 'Error de conexión con la API de Anthropic', models: getAvailableModels() };
  }
}
