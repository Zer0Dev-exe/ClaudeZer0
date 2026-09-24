import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/**
 * Detectar la ruta o comando del binario de Claude de forma multiplataforma (Windows / Linux / macOS)
 */
export function getClaudeBinary() {
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'claude.cmd' : 'claude';
  const localBin = path.join(projectRoot, 'node_modules', '.bin', binName);
  
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  // Fallback si no tiene .cmd o en entornos tipo WSL / Cygwin
  const localDirect = path.join(projectRoot, 'node_modules', '.bin', 'claude');
  if (fs.existsSync(localDirect)) {
    return localDirect;
  }

  // Fallback al comando global instalado en el sistema
  return isWin ? 'claude.cmd' : 'claude';
}

/**
 * Mapear identificadores de modelo a los alias oficiales requeridos por Claude Code CLI ('sonnet', 'haiku', 'opus')
 */
export function mapModelToCli(model) {
  if (!model) return 'opus';
  const m = String(model).trim();
  const lower = m.toLowerCase();
  const legacySonnetIds = new Set([
    'claude-3-7-sonnet',
    'claude-3-7-sonnet-latest',
    'claude-3-7-sonnet-20250219'
  ]);
  if (legacySonnetIds.has(lower)) return 'sonnet';
  if (lower.startsWith('claude-')) return m;
  if (lower.includes('fable')) return 'claude-fable-5-1';
  if (lower.includes('haiku')) return 'haiku';
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  return m;
}

const clientConfigDir = path.join(projectRoot, 'data', '.client_claude_config');
if (!fs.existsSync(clientConfigDir)) {
  try {
    fs.mkdirSync(clientConfigDir, { recursive: true });
  } catch (e) {
    // ignore
  }
}

let activeProcess = null;
let activeTaskId = null;

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/**
 * Escribir los adjuntos en una carpeta temporal del sistema (se borra al terminar la tarea).
 * No se guardan en el workspace ni en el historial.
 */
function writeTempAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new Error(`Máximo ${MAX_ATTACHMENTS} archivos adjuntos por mensaje.`);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudezer0-'));
  const files = [];
  try {
    attachments.forEach((att, i) => {
      const buf = Buffer.from(String(att.data || ''), 'base64');
      if (buf.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(`"${att.name}" supera el límite de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
      }
      const safeName = String(att.name || `archivo-${i}`).replace(/[^\w.\-]/g, '_').slice(0, 100) || `archivo-${i}`;
      const filePath = path.join(dir, `${i}-${safeName}`);
      fs.writeFileSync(filePath, buf);
      files.push(filePath);
    });
  } catch (err) {
    removeTempDir(dir);
    throw err;
  }
  return { dir, files };
}

function removeTempDir(dir) {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
}

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const OUTPUT_STYLES = ['Explanatory', 'Learning'];

const tmpDir = path.join(projectRoot, 'data', '.tmp');
if (!fs.existsSync(tmpDir)) {
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch (e) {
    // ignore
  }
}

/**
 * Archivo de settings con el estilo de respuesta elegido (null = estilo por defecto)
 */
function getOutputStyleSettingsFile(outputStyle) {
  if (!OUTPUT_STYLES.includes(outputStyle)) return null;
  const file = path.join(tmpDir, `output-style-${outputStyle.toLowerCase()}.json`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ outputStyle }), 'utf-8');
  }
  return file;
}

/**
 * Borrar la transcripción que Claude Code guarda en disco para una sesión (usado por el modo incógnito)
 */
export function deleteClaudeTranscript(claudeSessionId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(claudeSessionId || ''))) return 0;
  const configDirs = [
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
    clientConfigDir
  ];
  let removed = 0;
  for (const dir of configDirs) {
    const projectsDir = path.join(dir, 'projects');
    if (!fs.existsSync(projectsDir)) continue;
    for (const project of fs.readdirSync(projectsDir)) {
      const base = path.join(projectsDir, project, claudeSessionId);
      for (const target of [`${base}.jsonl`, base]) {
        if (fs.existsSync(target)) {
          fs.rmSync(target, { recursive: true, force: true });
          removed++;
        }
      }
    }
  }
  return removed;
}

/**
 * Obtener el modo configurado en .env (Hoster o Client)
 */
export function getAppMode() {
  const mode = (process.env.MODE || 'Hoster').trim().toLowerCase();
  return mode === 'client' ? 'Client' : 'Hoster';
}

/**
 * Validar una clave API de Claude de forma aislada
 */
export function validateApiKey(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return { valid: false, message: 'La clave no puede estar vacía' };
  }
  const cleanKey = apiKey.trim();
  try {
    const env = {
      ...process.env,
      CLAUDE_CONFIG_DIR: clientConfigDir,
      ANTHROPIC_API_KEY: cleanKey
    };
    const bin = getClaudeBinary();
    const cmd = `"${bin}" auth status`;
    const out = execSync(cmd, {
      encoding: 'utf-8',
      cwd: projectRoot,
      env,
      timeout: 10000
    });
    const jsonMatch = out.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const status = JSON.parse(jsonMatch[0]);
      if (status.loggedIn) {
        return { valid: true, status };
      }
    }
    return { valid: false, message: 'Clave no reconocida por Anthropic' };
  } catch (err) {
    return { valid: false, message: err.message || 'Error validando la clave' };
  }
}

// Get current Claude Auth status
export function getClaudeAuthStatus(clientApiKey = null) {
  const appMode = getAppMode();
  try {
    const env = { ...process.env };
    if (appMode === 'Client') {
      env.CLAUDE_CONFIG_DIR = clientConfigDir;
      if (clientApiKey && clientApiKey.trim()) {
        env.ANTHROPIC_API_KEY = clientApiKey.trim();
      } else {
        delete env.ANTHROPIC_API_KEY;
        return {
          loggedIn: false,
          mode: 'Client',
          needsKey: true,
          message: 'Se requiere configurar una API Key de Claude en Modo Cliente'
        };
      }
    } else {
      // Modo Hoster
      if (clientApiKey && clientApiKey.trim()) {
        env.ANTHROPIC_API_KEY = clientApiKey.trim();
      } else if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()) {
        env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY.trim();
      } else {
        delete env.ANTHROPIC_API_KEY;
      }
    }

    const bin = getClaudeBinary();
    const cmd = `"${bin}" auth status`;
    const out = execSync(cmd, {
      encoding: 'utf-8',
      cwd: projectRoot,
      env,
      timeout: 10000
    });
    // Parse JSON inside output
    const jsonMatch = out.match(/\{[\s\S]*\}/);
    let parsed = null;
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      parsed = { raw: out, loggedIn: out.includes('"loggedIn": true') || out.includes('loggedIn: true') };
    }
    parsed.mode = appMode;
    return parsed;
  } catch (err) {
    return {
      loggedIn: false,
      mode: appMode,
      error: err.message
    };
  }
}

/**
 * Execute a task with Claude Code
 * @param {Object} options
 * @param {string} options.prompt - Prompt or command for Claude Code
 * @param {string} options.workspace - Working directory
 * @param {string} [options.sessionId] - Session ID to resume
 * @param {string} [options.permissionMode] - 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan'
 * @param {string} [options.model] - Model name or alias
 * @param {string} [options.apiKey] - Claude API Key (requerida en Client mode, opcional en Hoster mode)
 * @param {Array<{name: string, data: string}>} [options.attachments] - Archivos adjuntos en base64 (temporales)
 * @param {string} [options.effort] - Nivel de esfuerzo: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
 * @param {string} [options.outputStyle] - Estilo de respuesta: 'default' | 'Explanatory' | 'Learning'
 * @param {string} [options.customInstructions] - Instrucciones personalizadas que se añaden al system prompt
 * @param {function} options.onEvent - Callback for streaming events
 * @param {function} options.onDone - Callback when completed
 * @param {function} options.onError - Callback on error
 */
export function executeTask({
  prompt,
  workspace,
  sessionId,
  permissionMode = 'auto',
  model,
  apiKey,
  attachments,
  effort,
  outputStyle,
  customInstructions,
  onEvent,
  onDone,
  onError
}) {
  if (activeProcess) {
    throw new Error('Ya hay una tarea en ejecución con Claude Code. Cancélala primero.');
  }

  const appMode = getAppMode();
  const cleanEnv = { ...process.env };

  if (appMode === 'Client') {
    if (!apiKey || !apiKey.trim()) {
      throw new Error('Modo Cliente activo: Debes configurar tu propia API Key de Claude en la configuración.');
    }
    cleanEnv.ANTHROPIC_API_KEY = apiKey.trim();
    // Aislamiento estricto de las credenciales del host
    cleanEnv.CLAUDE_CONFIG_DIR = clientConfigDir;
  } else {
    // Modo Hoster: si el cliente proporcionó su propia key la usa; si no, usa la cuenta/key del anfitrión
    if (apiKey && apiKey.trim()) {
      cleanEnv.ANTHROPIC_API_KEY = apiKey.trim();
    } else if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()) {
      cleanEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY.trim();
    } else {
      delete cleanEnv.ANTHROPIC_API_KEY;
    }
  }

  // Permitir modelos nuevos o dinámicos sin restricciones de catálogo rígidas
  cleanEnv.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1';

  const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  activeTaskId = taskId;

  const targetDir = workspace && fs.existsSync(workspace) ? workspace : projectRoot;

  const temp = writeTempAttachments(attachments);
  if (temp) {
    // En una sola línea: cmd.exe /c corta los argumentos con saltos de línea
    prompt = `${prompt} [Archivos adjuntos por el usuario (léelos con la herramienta Read): ${temp.files.join(' , ')}]`;
  }

  // Build arguments for Claude Code
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose'
  ];

  // Set permission mode
  if (permissionMode) {
    args.push('--permission-mode', permissionMode);
  }

  // Set model using valid Claude Code CLI alias
  const cliModel = mapModelToCli(model);
  args.push('--model', cliModel);

  // Nivel de esfuerzo (solo valores admitidos por el CLI; sin flag = valor por defecto del modelo)
  if (effort && EFFORT_LEVELS.includes(effort)) {
    args.push('--effort', effort);
  }

  // Estilo de respuesta (se pasa como archivo de settings para evitar problemas de comillas en cmd.exe)
  const stylePath = getOutputStyleSettingsFile(outputStyle);
  if (stylePath) {
    args.push('--settings', stylePath);
  }

  // Instrucciones personalizadas (archivo temporal, se borra al terminar la tarea)
  let instructionsPath = null;
  if (customInstructions && customInstructions.trim()) {
    instructionsPath = path.join(tmpDir, `instructions-${taskId}.txt`);
    fs.writeFileSync(instructionsPath, customInstructions.trim().slice(0, 4000), 'utf-8');
    args.push('--append-system-prompt-file', instructionsPath);
  }

  // Resume previous session if provided
  if (sessionId) {
    args.push('--resume', sessionId);
  }

  // Permitir leer la carpeta temporal de adjuntos (está fuera del workspace)
  if (temp) {
    args.push('--add-dir', temp.dir);
  }

  onEvent({
    type: 'system_start',
    taskId,
    model: cliModel,
    workspace: targetDir,
    timestamp: Date.now()
  });

  let capturedSessionId = sessionId || null;
  let accumulatedText = '';
  let accumulatedStderr = '';
  let fullResult = null;
  let isFallback = false;

  // Multiplataforma: en Windows .cmd requiere cmd.exe /c
  // En Linux/macOS el binario se ejecuta directamente (manejado por el shebang de node)
  const isWin = process.platform === 'win32';
  const bin = getClaudeBinary();
  const child = isWin
    ? spawn('cmd.exe', ['/c', bin, ...args], {
        cwd: targetDir,
        env: cleanEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    : spawn(bin, args, {
        cwd: targetDir,
        env: cleanEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      });

  activeProcess = child;

  let buffer = '';

  child.stdout.on('data', (data) => {
    const str = data.toString();
    buffer += str;

    const lines = buffer.split('\n');
    // Keep last incomplete segment in buffer
    buffer = lines.pop();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const event = JSON.parse(line);

        // Track session ID
        if (event.session_id) {
          capturedSessionId = event.session_id;
        }

        // Los eventos de subagentes (Task) llevan parent_tool_use_id: su texto no se mezcla con la respuesta principal
        const isSubagent = !!event.parent_tool_use_id;

        // Con --include-partial-messages los eventos de la API llegan envueltos en { type: 'stream_event', event }
        if (event.type === 'stream_event' && event.event) {
          const inner = event.event;
          if (isSubagent) continue;
          if (inner.type === 'content_block_start' && inner.content_block?.type === 'text' && accumulatedText) {
            // Nuevo bloque de texto tras herramientas o turnos previos: separar en párrafo nuevo
            accumulatedText += '\n\n';
            onEvent({ type: 'text_delta', text: '\n\n', sessionId: capturedSessionId });
          } else if (inner.type === 'content_block_delta' && inner.delta) {
            if (inner.delta.type === 'text_delta') {
              accumulatedText += inner.delta.text;
              onEvent({
                type: 'text_delta',
                text: inner.delta.text,
                sessionId: capturedSessionId
              });
            } else if (inner.delta.type === 'thinking_delta' && inner.delta.thinking) {
              onEvent({
                type: 'thinking_delta',
                thinking: inner.delta.thinking,
                sessionId: capturedSessionId
              });
            }
          }
        } else if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
          // Mensaje completo del asistente: aquí llegan las llamadas a herramientas con su input completo
          for (const block of event.message.content) {
            if (block.type !== 'tool_use') continue;
            onEvent({
              type: 'tool_use',
              id: block.id,
              tool: block.name,
              input: block.input,
              subagent: isSubagent,
              sessionId: capturedSessionId
            });
          }
        } else if (event.type === 'user' && Array.isArray(event.message?.content)) {
          // Resultados de herramientas (devueltos por Claude Code como mensaje de usuario)
          for (const block of event.message.content) {
            if (block.type !== 'tool_result') continue;
            const content = Array.isArray(block.content)
              ? block.content.map(c => c.text || '').join('\n')
              : String(block.content || '');
            onEvent({
              type: 'tool_result',
              id: block.tool_use_id,
              isError: !!block.is_error,
              content: content.slice(0, 2000),
              sessionId: capturedSessionId
            });
          }
        } else if (event.type === 'result') {
          fullResult = event;
          if (event.result && !accumulatedText) {
            accumulatedText = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
          }
          onEvent({
            type: 'result',
            result: event.result,
            cost: event.total_cost_usd,
            duration: event.duration_ms,
            usage: event.usage,
            sessionId: capturedSessionId
          });
        } else {
          // Other structured events (init, status, etc.)
          onEvent({
            type: 'event',
            subtype: event.subtype || event.type,
            data: event,
            sessionId: capturedSessionId
          });
        }
      } catch (e) {
        // Plain text output
        accumulatedText += line + '\n';
        onEvent({
          type: 'text_raw',
          text: line,
          sessionId: capturedSessionId
        });
      }
    }
  });

  child.stderr.on('data', (data) => {
    const errStr = data.toString().trim();
    if (!errStr) return;
    
    accumulatedStderr += (accumulatedStderr ? '\n' : '') + errStr;

    // Check if stream-json is not supported or needs fallback
    if (errStr.includes('Error: When using --print') && !isFallback) {
      console.warn('Fallback needed for claude command');
    }
    
    onEvent({
      type: 'stderr',
      text: errStr,
      sessionId: capturedSessionId
    });
  });

  const cleanupInstructions = () => {
    if (instructionsPath) fs.rm(instructionsPath, { force: true }, () => {});
  };
  child.once('close', cleanupInstructions);
  child.once('error', cleanupInstructions);

  child.on('close', (code) => {
    // Process any remaining text in buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        if (event.type === 'result') {
          fullResult = event;
          if (event.result) accumulatedText = event.result;
        }
      } catch (e) {
        accumulatedText += buffer;
      }
    }

    activeProcess = null;
    activeTaskId = null;
    removeTempDir(temp?.dir);

    if (code === 0 || fullResult) {
      onDone({
        success: true,
        exitCode: code,
        sessionId: capturedSessionId,
        text: accumulatedText,
        result: fullResult
      });
    } else {
      const errorMsg = accumulatedStderr || accumulatedText || `El proceso de Claude Code finalizó con código ${code}`;
      onError({
        success: false,
        exitCode: code,
        sessionId: capturedSessionId,
        text: accumulatedText,
        stderr: accumulatedStderr,
        message: errorMsg
      });
    }
  });

  child.on('error', (err) => {
    activeProcess = null;
    activeTaskId = null;
    removeTempDir(temp?.dir);
    onError({
      success: false,
      message: err.message
    });
  });

  return {
    taskId,
    sessionId: capturedSessionId
  };
}

/**
 * Cancel currently active Claude Code task
 */
export function cancelActiveTask() {
  if (activeProcess) {
    const isWin = process.platform === 'win32';
    if (isWin) {
      try {
        execSync(`taskkill /pid ${activeProcess.pid} /T /F`);
      } catch (e) {
        try {
          activeProcess.kill('SIGTERM');
        } catch (err) {}
      }
    } else {
      // Linux / macOS: terminar el subproceso y sus hijos
      try {
        execSync(`kill -TERM -${activeProcess.pid} 2>/dev/null || kill -TERM ${activeProcess.pid} 2>/dev/null`);
      } catch (e) {
        try {
          activeProcess.kill('SIGTERM');
        } catch (err) {}
      }
    }
    activeProcess = null;
    activeTaskId = null;
    return { canceled: true };
  }
  return { canceled: false, message: 'No hay ninguna tarea activa' };
}

export function isTaskActive() {
  return activeProcess !== null;
}
