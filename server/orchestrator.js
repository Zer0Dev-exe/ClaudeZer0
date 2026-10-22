import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { DATA_DIR } from './paths.js';
import { EFFORT_LEVELS } from './claudeRunner.js';

// ==========================================================================
// Orquestador de agentes: un modelo desarrolla y otro, de otra familia, revisa el código
// mientras tanto (y al terminar). El revisor solo puede leer: nunca toca los archivos.
// ==========================================================================

const CONFIG_FILE = path.join(DATA_DIR, 'orchestration.json');

// Ajustes por usuario. `null` en un modelo o esfuerzo = «elige Zer0Code» (ver recommendRoles).
export const DEFAULT_CONFIG = {
  enabled: false,
  reviewerModel: null,
  reviewerEffort: null,
  live: true,
  autoFix: false,
  maxRounds: 2
};

const MAX_ROUNDS_LIMIT = 5;

// Revisión durante el desarrollo: se espera a que el desarrollador deje de editar un rato,
// no se lanzan dos seguidas y hay un tope por tarea (cada una cuesta tokens).
const LIVE_QUIET_MS = Number(process.env.ZER0CODE_REVIEW_QUIET_MS) || 45 * 1000;
const LIVE_MIN_GAP_MS = Number(process.env.ZER0CODE_REVIEW_MIN_GAP_MS) || 90 * 1000;
const LIVE_MAX_PER_TASK = 3;
const EMIT_THROTTLE_MS = 400;
const REVIEW_TEXT_MAX = 20000;

let store = null;

function load() {
  if (store) return store;
  try {
    store = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) : {};
  } catch (err) {
    console.warn('Error leyendo orchestration.json:', err.message);
    store = {};
  }
  return store;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('Error guardando orchestration.json:', err.message);
  }
}

function sanitize(input = {}) {
  const out = {};
  if ('enabled' in input) out.enabled = input.enabled === true;
  if ('live' in input) out.live = input.live === true;
  if ('autoFix' in input) out.autoFix = input.autoFix === true;
  if ('reviewerModel' in input) {
    const v = typeof input.reviewerModel === 'string' ? input.reviewerModel.trim().slice(0, 120) : '';
    out.reviewerModel = v || null;
  }
  if ('reviewerEffort' in input) {
    out.reviewerEffort = EFFORT_LEVELS.includes(input.reviewerEffort) ? input.reviewerEffort : null;
  }
  if ('maxRounds' in input) {
    const n = Math.round(Number(input.maxRounds));
    out.maxRounds = Number.isFinite(n) ? Math.min(MAX_ROUNDS_LIMIT, Math.max(1, n)) : DEFAULT_CONFIG.maxRounds;
  }
  return out;
}

export function getOrchestrationConfig(username) {
  return { ...DEFAULT_CONFIG, ...(load()[username] || {}) };
}

export function setOrchestrationConfig(username, patch) {
  load()[username] = { ...getOrchestrationConfig(username), ...sanitize(patch) };
  save();
  return getOrchestrationConfig(username);
}

export function forgetUserOrchestration(username) {
  if (load()[username]) {
    delete store[username];
    save();
  }
}

// ==========================================================================
// Elección de modelos
// ==========================================================================

/** El nivel de esfuerzo admitido por el modelo más cercano al pedido (null si el modelo no tiene esfuerzo) */
export function pickEffort(model, wanted) {
  const levels = (model?.effortLevels || []).filter(l => EFFORT_LEVELS.includes(l));
  if (!levels.length || !wanted) return null;
  if (levels.includes(wanted)) return wanted;
  const target = EFFORT_LEVELS.indexOf(wanted);
  return levels.reduce((best, l) =>
    Math.abs(EFFORT_LEVELS.indexOf(l) - target) < Math.abs(EFFORT_LEVELS.indexOf(best) - target) ? l : best);
}

const byProvider = (models, provider) => models.filter(m => (m.provider || 'claude') === provider);

/**
 * Reparto de papeles que recomienda Zer0Code, calculado con el catálogo vivo (así sigue valiendo
 * cuando salen modelos nuevos; no hay ningún id fijo):
 *  - Desarrollador: el Claude por defecto del catálogo (Opus), esfuerzo alto. Es el que escribe y ejecuta.
 *  - Revisor: el mejor modelo de ChatGPT (Codex) con esfuerzo alto. Es de otra familia: sus fallos no
 *    suelen coincidir con los de Claude, que es justo lo que se busca al revisar. Si ChatGPT no está
 *    conectado: Gemini; y si tampoco, Claude Sonnet (mejor que nada, pero el mismo «punto ciego»).
 * Las revisiones durante el desarrollo usan un esfuerzo menor que la final para no gastar de más.
 */
export function recommendRoles(models, providers = {}) {
  const claude = byProvider(models, 'claude');
  const developer = claude.find(m => m.isDefault) || claude.find(m => /opus/i.test(m.id)) || claude[0] || null;

  let reviewer = null;
  let reason = '';
  const codex = byProvider(models, 'codex');
  const gemini = byProvider(models, 'gemini');
  if (providers.codex?.loggedIn && codex.length) {
    reviewer = codex.find(m => m.providerDefault) || codex[0];
    reason = 'Otra familia de modelos que el desarrollador: sus errores no suelen coincidir con los de Claude.';
  } else if (providers.gemini?.loggedIn && gemini.length) {
    reviewer = gemini.find(m => m.providerDefault) || gemini[0];
    reason = 'ChatGPT no está conectado; Gemini también aporta una segunda opinión de otra familia.';
  } else {
    reviewer = claude.find(m => /sonnet/i.test(m.id)) || developer;
    reason = 'No hay ChatGPT ni Gemini conectados: revisa un Claude más ligero. Conecta ChatGPT (codex login) para una revisión realmente independiente.';
  }

  return {
    developer: developer ? { model: developer.id, provider: 'claude', effort: pickEffort(developer, 'high') } : null,
    reviewer: reviewer
      ? {
          model: reviewer.id,
          provider: reviewer.provider || 'claude',
          effort: pickEffort(reviewer, 'high'),
          liveEffort: pickEffort(reviewer, 'medium'),
          reason
        }
      : null
  };
}

/**
 * Revisor que se usará en una tarea: lo elegido por el usuario o, si lo deja en automático, lo recomendado.
 * Devuelve null si no hay ningún modelo disponible.
 */
export function resolveReviewer(config, models, providers, providerOf) {
  const rec = recommendRoles(models, providers).reviewer;
  const chosen = config.reviewerModel ? models.find(m => m.id === config.reviewerModel) : null;
  if (config.reviewerModel && !chosen) return rec; // el modelo elegido ya no existe
  const base = chosen || models.find(m => m.id === rec?.model);
  if (!base) return null;
  const effort = config.reviewerEffort ? pickEffort(base, config.reviewerEffort) : chosen ? pickEffort(base, 'high') : rec.effort;
  return {
    model: base.id,
    name: base.name || base.id,
    provider: base.provider || providerOf(base.id),
    effort,
    liveEffort: config.reviewerEffort ? effort : pickEffort(base, 'medium')
  };
}

// ==========================================================================
// Revisor
// ==========================================================================

export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite']);
// Comandos de solo lectura que el revisor de Claude puede ejecutar sin que nadie los apruebe
const READ_ONLY_BASH = /^\s*git\s+(status|diff|log|show|blame|ls-files|rev-parse|branch|cat-file)\b[^;&|`$><]*$/;

/**
 * Política de permisos del revisor de Claude: lee, busca y mira el estado de git; todo lo demás se deniega
 * (nunca se le pregunta al usuario: la revisión transcurre sin nadie delante).
 */
export function reviewerPermissionPolicy(tool, input) {
  if (READ_ONLY_TOOLS.has(tool)) return { behavior: 'allow' };
  if (tool === 'Bash' && READ_ONLY_BASH.test(String(input?.command || ''))) return { behavior: 'allow' };
  return { behavior: 'deny', message: 'El revisor solo puede leer el código: no puede modificar archivos ni ejecutar comandos.' };
}

function git(dir, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { timeout: 15000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

/**
 * Huella del estado del código (git status + diff): sirve para saber si el desarrollador ha cambiado algo
 * aunque lo hiciera con comandos y no con las herramientas de edición. null si no es un repositorio git.
 */
export async function workspaceFingerprint(dir) {
  const [status, diff] = await Promise.all([git(dir, ['status', '--porcelain=v1', '-z']), git(dir, ['diff', 'HEAD'])]);
  if (status === null) return null;
  return crypto.createHash('sha1').update(status).update('\0').update(diff || '').digest('hex');
}

const VERDICT = /^\s*[*`]*VEREDICTO[*`]*\s*:\s*[*`]*\s*(OK|CAMBIOS)\b/im;

/** `OK` | `CAMBIOS` | null según la última línea de veredicto del revisor */
export function parseVerdict(text) {
  const matches = [...String(text || '').matchAll(new RegExp(VERDICT.source, 'gim'))];
  return matches.length ? matches[matches.length - 1][1].toUpperCase() : null;
}

function reviewPrompt({ kind, userPrompt, files, developerName, resuming }) {
  const lines = [
    `Eres el REVISOR de código de un equipo de agentes. Otro agente (${developerName}) está desarrollando en esta carpeta; tú NO desarrollas.`,
    'No modifiques ni crees archivos y no ejecutes nada que cambie el proyecto: solo lee y analiza.',
    '',
    'Petición del usuario al desarrollador:',
    '"""',
    String(userPrompt || '').trim().slice(0, 4000),
    '"""',
    ''
  ];
  if (files.length) lines.push(`Archivos que ha tocado: ${files.slice(0, 40).join(', ')}`, '');
  lines.push(kind === 'final'
    ? 'El desarrollador HA TERMINADO: haz la revisión final.'
    : 'El desarrollador SIGUE TRABAJANDO: revisa lo que lleva hecho. No señales como fallo lo que aún no le ha dado tiempo a hacer.');
  lines.push(
    '',
    '1. Mira los cambios (`git status` y `git diff`; si no hay git, lee los archivos tocados).',
    '2. Busca lo que importa: bugs y fallos de lógica, casos límite, errores de seguridad, regresiones, llamadas a cosas que no existen y pruebas que faltan. Ignora el estilo salvo que cause errores.',
    resuming ? '3. Ya revisaste antes esta tarea: no repitas lo que se ha corregido; di solo lo que sigue pendiente y lo nuevo.' : '3. Sé concreto y breve.',
    '',
    'Responde con una lista ordenada por gravedad. Cada punto: `archivo:línea — problema — cómo arreglarlo`, con 🔴 crítico, 🟠 importante o 🟡 menor.',
    'Si no ves problemas, di en una frase qué has comprobado.',
    'Acaba con una última línea exacta: `VEREDICTO: OK` (nada que corregir) o `VEREDICTO: CAMBIOS` (hay algo 🔴 o 🟠 que arreglar).'
  );
  return lines.join('\n');
}

/**
 * Controlador de revisión de UNA tarea del desarrollador. Escucha sus ediciones, lanza revisiones
 * (durante el desarrollo, con calma, y una final) y deja los resultados en `reviews`, que es el
 * array que se guarda con el mensaje del desarrollador.
 *
 * deps: { owner, chatId, workspace, userPrompt, developerName, reviewer, live, reviews,
 *         run(options) -> arranca el proveedor del revisor (como executeWithProvider),
 *         getResumeId(provider), setResumeId(provider, id), onUpdate(review) }
 */
export function createReviewController(deps) {
  const { reviewer, reviews, onUpdate } = deps;
  const touched = new Set();
  let timer = null;
  let current = null; // { promise, review }
  let dirty = false; // hay cambios que ninguna revisión ha visto
  let closed = false;
  let lastStart = 0;
  let liveCount = 0;
  let startFingerprint = null;
  const ready = workspaceFingerprint(deps.workspace).then(fp => { startFingerprint = fp; });

  const emitNow = (review) => { try { onUpdate({ ...review }); } catch { /* el envío no debe romper la revisión */ } };

  function runReview(kind) {
    const resumeId = deps.getResumeId(reviewer.provider);
    const review = {
      id: 'rev_' + crypto.randomBytes(5).toString('hex'),
      kind,
      status: 'running',
      model: reviewer.model,
      name: reviewer.name,
      provider: reviewer.provider,
      effort: kind === 'live' ? reviewer.liveEffort : reviewer.effort,
      files: [...touched].slice(0, 40),
      text: '',
      toolCount: 0,
      verdict: null,
      startedAt: Date.now()
    };
    reviews.push(review);
    dirty = false;
    lastStart = Date.now();
    emitNow(review);

    let lastEmit = 0;
    let pendingEmit = null;
    const throttledEmit = () => {
      const wait = EMIT_THROTTLE_MS - (Date.now() - lastEmit);
      if (wait <= 0) { lastEmit = Date.now(); emitNow(review); return; }
      if (!pendingEmit) pendingEmit = setTimeout(() => { pendingEmit = null; lastEmit = Date.now(); emitNow(review); }, wait);
    };
    const finish = (patch) => {
      if (pendingEmit) { clearTimeout(pendingEmit); pendingEmit = null; }
      Object.assign(review, patch, { finishedAt: Date.now() });
      review.text = review.text.trim().slice(0, REVIEW_TEXT_MAX);
      if (review.status === 'done') review.verdict = parseVerdict(review.text);
      emitNow(review);
    };

    const promise = new Promise((resolve) => {
      let settled = false;
      const settle = (patch) => {
        if (settled) return;
        settled = true;
        // Si se canceló mientras corría, se queda como cancelada
        if (review.status === 'running') finish(patch);
        resolve(review);
      };
      try {
        deps.run({
          prompt: reviewPrompt({ kind, userPrompt: deps.userPrompt, files: review.files, developerName: deps.developerName, resuming: !!resumeId }),
          sessionId: resumeId,
          model: reviewer.model,
          effort: review.effort,
          onEvent: (event) => {
            if (event.type === 'text_delta') { review.text += event.text; throttledEmit(); }
            else if (event.type === 'tool_use') { review.toolCount++; throttledEmit(); }
          },
          onDone: (result) => {
            if (result.sessionId) deps.setResumeId(reviewer.provider, result.sessionId);
            if (!review.text.trim() && result.text) review.text = result.text;
            settle({ status: 'done' });
          },
          onError: (err) => {
            if (err.sessionId) deps.setResumeId(reviewer.provider, err.sessionId);
            settle({ status: 'error', error: String(err.message || 'El revisor no pudo terminar').slice(0, 600) });
          }
        });
      } catch (err) {
        settle({ status: 'error', error: err.message });
      }
    });
    current = { promise, review };
    promise.then(() => {
      if (current?.review === review) current = null;
      // Mientras revisaba hubo más ediciones: otra revisión, si procede
      if (dirty && !closed) schedule();
    });
    return promise;
  }

  function schedule() {
    if (closed || !deps.live || liveCount >= LIVE_MAX_PER_TASK) return;
    clearTimeout(timer);
    const wait = Math.max(LIVE_QUIET_MS, lastStart + LIVE_MIN_GAP_MS - Date.now());
    timer = setTimeout(() => {
      timer = null;
      if (closed || current || !dirty) return; // si hay una en marcha, se reprograma cuando acabe
      liveCount++;
      runReview('live');
    }, wait);
    timer.unref?.();
  }

  return {
    /** El desarrollador ha terminado de editar un archivo */
    noteEdit(file) {
      if (closed) return;
      if (file) touched.add(String(file).slice(0, 300));
      dirty = true;
      schedule();
    },

    /** Hay una revisión en marcha ahora mismo */
    get busy() { return !!current; },

    /**
     * Fin de la tarea del desarrollador: espera a la revisión en marcha y hace la final si queda algo sin ver.
     * Devuelve la última revisión (o null si no había cambios que revisar).
     */
    async finish({ failed = false } = {}) {
      clearTimeout(timer);
      timer = null;
      if (current) await current.promise;
      if (failed || closed) { closed = true; return reviews[reviews.length - 1] || null; }
      await ready;
      if (!dirty) {
        // Cambios hechos con comandos (sed, git apply…) que las herramientas de edición no vieron
        const end = await workspaceFingerprint(deps.workspace);
        dirty = reviews.length === 0 && end !== null && end !== startFingerprint;
      }
      if (dirty) await runReview('final');
      closed = true;
      clearTimeout(timer);
      return reviews[reviews.length - 1] || null;
    },

    /** Cancelar: no habrá más revisiones y las que estén en marcha se marcan como canceladas */
    cancel() {
      closed = true;
      clearTimeout(timer);
      timer = null;
      for (const r of reviews) {
        if (r.status === 'running') {
          r.status = 'canceled';
          r.finishedAt = Date.now();
          emitNow(r);
        }
      }
    }
  };
}

/** Mensaje que se le manda al desarrollador con lo que ha encontrado el revisor (modo corregir solo) */
export function autoFixPrompt(review) {
  return [
    `El revisor (${review.name || review.model}) ha revisado tus cambios y propone esto:`,
    '',
    review.text,
    '',
    'Corrige lo que sea correcto (🔴 y 🟠 primero). Si algún punto no es un problema real, no lo cambies y explica en una frase por qué.',
    'Al terminar, resume qué has arreglado y qué has descartado.'
  ].join('\n');
}
