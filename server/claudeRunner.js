import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
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

  // Resume previous session if provided
  if (sessionId) {
    args.push('--resume', sessionId);
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

        // Handle streaming assistant deltas
        if (event.type === 'content_block_delta' && event.delta) {
          if (event.delta.type === 'text_delta') {
            accumulatedText += event.delta.text;
            onEvent({
              type: 'text_delta',
              text: event.delta.text,
              sessionId: capturedSessionId
            });
          } else if (event.delta.type === 'thinking_delta') {
            onEvent({
              type: 'thinking_delta',
              thinking: event.delta.thinking,
              sessionId: capturedSessionId
            });
          }
        } else if (event.type === 'assistant_response' || event.type === 'message_start') {
          onEvent({
            type: 'message_start',
            sessionId: capturedSessionId,
            event
          });
        } else if (event.type === 'tool_use' || (event.content_block && event.content_block.type === 'tool_use')) {
          onEvent({
            type: 'tool_use',
            tool: event.content_block ? event.content_block.name : event.name,
            input: event.content_block ? event.content_block.input : event.input,
            sessionId: capturedSessionId
          });
        } else if (event.type === 'tool_result') {
          onEvent({
            type: 'tool_result',
            toolResult: event,
            sessionId: capturedSessionId
          });
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
