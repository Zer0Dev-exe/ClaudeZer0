import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const modelsFilePath = path.join(projectRoot, 'data', 'models.json');

// Modelos por defecto con sus alias oficiales para Claude Code CLI
const DEFAULT_MODELS = [
  {
    id: 'sonnet',
    name: 'Claude 3.7 Sonnet',
    tag: 'Híbrido',
    badge: 'Recomendado',
    desc: 'Razonamiento híbrido profundo, alta velocidad y codificación avanzada',
    icon: 'sonnet',
    isDefault: true
  },
  {
    id: 'haiku',
    name: 'Claude 3.5 Haiku',
    tag: 'Ultrarrápido',
    badge: 'Rápido',
    desc: 'Respuestas instantáneas y máxima agilidad para tareas rápidas y directas',
    icon: 'haiku'
  },
  {
    id: 'opus',
    name: 'Claude 3 Opus',
    tag: 'Profundo',
    badge: 'Analítico',
    desc: 'Gran potencia analítica para comprensión profunda de problemas complejos',
    icon: 'opus'
  }
];

/**
 * Cargar lista de modelos persistida o inicializar con los por defecto
 */
export function getAvailableModels() {
  try {
    if (fs.existsSync(modelsFilePath)) {
      const content = fs.readFileSync(modelsFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Error leyendo models.json, usando valores por defecto:', err.message);
  }

  // Guardar archivo inicial si no existe
  saveModels(DEFAULT_MODELS);
  return DEFAULT_MODELS;
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
    icon: icon || (cleanId.includes('haiku') ? 'haiku' : cleanId.includes('opus') ? 'opus' : 'sonnet'),
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
  // Asegurar que al menos quede un modelo por defecto
  if (filtered.length === 0) {
    saveModels(DEFAULT_MODELS);
    return true;
  }
  saveModels(filtered);
  return true;
}

/**
 * Sincronizar catálogo en vivo consultando la API de Anthropic /v1/models
 */
export async function syncModelsFromAnthropic(apiKey) {
  const currentModels = getAvailableModels();

  // Si no hay API key personal, sincronizamos con las versiones canónicas de Claude
  if (!apiKey || !apiKey.trim()) {
    const OFFICIAL_EXTRA_MODELS = [
      {
        id: 'claude-3-7-sonnet-20250219',
        name: 'Claude 3.7 Sonnet (20250219)',
        tag: 'Híbrido',
        badge: 'Oficial',
        desc: 'Identificador canónico de Claude 3.7 Sonnet con razonamiento híbrido',
        icon: 'sonnet'
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku (20241022)',
        tag: 'Ultrarrápido',
        badge: 'Oficial',
        desc: 'Identificador canónico de Claude 3.5 Haiku para máxima velocidad',
        icon: 'haiku'
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus (20240229)',
        tag: 'Profundo',
        badge: 'Oficial',
        desc: 'Identificador canónico de Claude 3 Opus para razonamiento profundo',
        icon: 'opus'
      }
    ];

    let addedCount = 0;
    for (const em of OFFICIAL_EXTRA_MODELS) {
      if (!currentModels.some(m => m.id.toLowerCase() === em.id.toLowerCase())) {
        currentModels.push({
          ...em,
          custom: true,
          addedAt: Date.now()
        });
        addedCount++;
      }
    }
    if (addedCount > 0) {
      saveModels(currentModels);
    }
    return {
      success: true,
      addedCount,
      totalCount: currentModels.length,
      models: currentModels,
      message: addedCount > 0
        ? `Catálogo actualizado con ${addedCount} versiones canónicas de Claude.`
        : 'Todos los modelos canónicos ya están al día.'
    };
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01'
      }
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        message: errData.error?.message || `Error HTTP ${res.status} al consultar modelos de Anthropic`
      };
    }

    const data = await res.json();
    const remoteModels = data.data || [];
    if (!Array.isArray(remoteModels) || remoteModels.length === 0) {
      return { success: false, message: 'No se encontraron modelos en la respuesta de Anthropic' };
    }

    const currentModels = getAvailableModels();
    let addedCount = 0;

    for (const rm of remoteModels) {
      const exists = currentModels.some(
        m => m.id.toLowerCase() === rm.id.toLowerCase() || m.name.toLowerCase() === (rm.display_name || '').toLowerCase()
      );
      if (!exists && rm.id) {
        const idLower = rm.id.toLowerCase();
        let tag = 'Reciente';
        let badge = 'Anthropic';
        let icon = 'sonnet';

        if (idLower.includes('haiku')) {
          tag = 'Ultrarrápido';
          icon = 'haiku';
        } else if (idLower.includes('opus')) {
          tag = 'Profundo';
          icon = 'opus';
        } else if (idLower.includes('sonnet')) {
          tag = 'Híbrido';
          icon = 'sonnet';
        }

        currentModels.push({
          id: rm.id,
          name: rm.display_name || rm.id,
          tag,
          badge,
          desc: `Modelo sincronizado desde la API de Anthropic (${rm.id})`,
          icon,
          custom: true,
          addedAt: Date.now()
        });
        addedCount++;
      }
    }

    if (addedCount > 0) {
      saveModels(currentModels);
    }

    return {
      success: true,
      addedCount,
      totalCount: currentModels.length,
      models: currentModels
    };
  } catch (err) {
    return { success: false, message: err.message || 'Error de conexión con la API de Anthropic' };
  }
}
