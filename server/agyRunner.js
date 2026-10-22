import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { activeProcesses, writeTempAttachments, removeTempDir, releaseProcess } from './claudeRunner.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Binario de Antigravity CLI (el instalador oficial lo deja en ~/.local/bin; si no, el del PATH)
 */
export function getAgyBinary() {
  const local = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy');
  return fs.existsSync(local) ? local : 'agy';
}

export function hasAgy() {
  return fs.existsSync(path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy'));
}

// Antigravity solo distingue entre aprobar todo o denegar (sin terminal) lo que pide aprobación
const SKIP_PERMISSION_MODES = new Set(['auto', 'bypassPermissions']);
const AGY_EFFORTS = new Set(['low', 'medium', 'high']);

/**
 * Herramientas de Antigravity -> nombre e input al estilo de Claude Code, para que la web las pinte igual
 */
function mapTool(name = '', p = {}) {
  switch (name) {
    case 'run_command':
    case 'run_shell_command': return { tool: 'Bash', input: { command: p.command || p.CommandLine, description: p.description || p.command || p.CommandLine } };
    case 'view_file':
    case 'read_file': return { tool: 'Read', input: { file_path: p.absolute_path || p.file_path || p.path || p.AbsolutePath } };
    case 'write_to_file':
    case 'write_file': return { tool: 'Write', input: { file_path: p.file_path || p.TargetFile || p.path, content: p.content || p.CodeContent } };
    case 'replace_file_content':
    case 'multi_replace_file_content':
    case 'replace': return { tool: 'Edit', input: { file_path: p.file_path || p.TargetFile || p.path, old_string: p.old_string, new_string: p.new_string } };
    case 'find_by_name':
    case 'glob': return { tool: 'Glob', input: { pattern: p.pattern || p.Pattern } };
    case 'list_dir':
    case 'list_directory': return { tool: 'Glob', input: { pattern: p.dir_path || p.path || p.DirectoryPath } };
    case 'grep_search':
    case 'grep': return { tool: 'Grep', input: { pattern: p.pattern || p.Query } };
    case 'search_web':
    case 'google_web_search': return { tool: 'WebSearch', input: { query: p.query } };
    case 'read_url_content':
    case 'web_fetch': return { tool: 'WebFetch', input: { url: p.url || p.Url } };
    default: return { tool: name, input: p };
  }
}

/**
 * Ejecutar una tarea con Antigravity CLI (cuenta de Google con Google AI Pro/Ultra). Emite los mismos eventos que el runner de Claude.
 * @param {boolean} [options.restricted] - Usuario con carpetas limitadas: nunca aprueba comandos sin preguntar
 */
export function executeAgyTask({
  prompt,
  workspace,
  sessionId,
  owner,
  permissionMode = 'acceptEdits',
  restricted = false,
  model,
  effort,
  attachments,
  onEvent,
  onDone,
  onError
}) {
  if (activeProcesses.has(owner)) {
    throw new Error('Ya tienes una tarea en ejecución. Cancélala primero.');
  }

  const targetDir = workspace && fs.existsSync(workspace) ? workspace : projectRoot;
  const temp = writeTempAttachments(attachments);
  if (temp) {
    prompt = `${prompt}\n\nArchivos adjuntos por el usuario (léelos): ${temp.files.join(' ')}`;
  }

  const args = ['-p', prompt, '--output-format', 'stream-json', '--print-timeout', '60m'];
  if (model) args.push('--model', model);
  if (effort && AGY_EFFORTS.has(effort)) args.push('--effort', effort);
  if (sessionId) args.push('--conversation', sessionId);
  if (SKIP_PERMISSION_MODES.has(permissionMode) && !restricted) args.push('--dangerously-skip-permissions');

  const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  onEvent({ type: 'system_start', taskId, model: model || 'gemini', workspace: targetDir, timestamp: Date.now() });

  const isWin = process.platform === 'win32';
  const bin = getAgyBinary();
  const child = isWin
    ? spawn(bin, args, { cwd: targetDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(bin, args, { cwd: targetDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  activeProcesses.set(owner, child);

  let capturedSessionId = sessionId || null;
  let accumulatedText = '';
  let accumulatedStderr = '';
  let failure = null;
  let usage = null;
  let durationMs = null;
  let lastWasTool = false;
  const toolsStarted = new Set(); // step_index de las herramientas ya enviadas a la web

  let buffer = '';
  child.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      // Cada línea es { event: 'init' | 'step_update' | 'result', <ese mismo nombre>: { ...datos } }
      const p = event[event.event] || {};
      if (event.conversation_id) capturedSessionId = event.conversation_id;

      if (p.conversation_id) capturedSessionId = p.conversation_id;

      if (event.event === 'step_update') {
        if (p.step_type === 'agent_response' && p.text_delta) {
          // Texto nuevo tras herramientas: párrafo aparte
          if (lastWasTool && accumulatedText) {
            accumulatedText += '\n\n';
            onEvent({ type: 'text_delta', text: '\n\n', sessionId: capturedSessionId });
          }
          lastWasTool = false;
          accumulatedText += p.text_delta;
          onEvent({ type: 'text_delta', text: p.text_delta, sessionId: capturedSessionId });
        } else if (p.step_type === 'tool') {
          lastWasTool = true;
          const id = `agy-${p.step_index}`;
          const info = p.tool_info || {};
          if (!toolsStarted.has(id)) {
            toolsStarted.add(id);
            const { tool, input } = mapTool(p.tool_name, info.parameters || {});
            onEvent({ type: 'tool_use', id, tool, input, subagent: !!p.subagent_info, sessionId: capturedSessionId });
          }
          if (p.state === 'DONE') {
            // Antigravity no envía la salida de las herramientas, solo que han terminado
            onEvent({ type: 'tool_result', id, isError: false, content: '', sessionId: capturedSessionId });
          }
        }
      } else if (event.event === 'result') {
        usage = p.usage || null;
        if (p.duration_seconds) durationMs = Math.round(p.duration_seconds * 1000);
        if (p.status && p.status !== 'SUCCESS') failure = p.error || `Gemini terminó con estado ${p.status}`;
        // Si no llegó nada en streaming, la respuesta completa va en el resultado
        if (!accumulatedText && p.response) {
          accumulatedText = p.response;
          onEvent({ type: 'text_delta', text: p.response, sessionId: capturedSessionId });
        }
        // Sin terminal, lo que necesita aprobación se deniega: se avisa en la respuesta
        const denied = (p.denied_actions || []).map(a => a.display_name || a.action);
        if (denied.length) {
          const note = `${accumulatedText ? '\n\n' : ''}_Acciones denegadas (necesitan el modo automático): ${[...new Set(denied)].join(', ')}_`;
          accumulatedText += note;
          onEvent({ type: 'text_delta', text: note, sessionId: capturedSessionId });
        }
      }
    }
  });

  child.stderr.on('data', (data) => {
    const str = data.toString().trim();
    if (str) accumulatedStderr += (accumulatedStderr ? '\n' : '') + str;
  });

  child.on('close', (code) => {
    releaseProcess(owner, child);
    removeTempDir(temp?.dir);
    if (code === 0 && !failure) {
      onEvent({ type: 'result', result: accumulatedText, usage, sessionId: capturedSessionId });
      onDone({
        success: true,
        exitCode: code,
        sessionId: capturedSessionId,
        text: accumulatedText,
        result: durationMs || usage ? { usageSource: 'antigravity', ...(durationMs ? { duration_ms: durationMs } : {}), ...(usage ? { usage } : {}) } : null
      });
    } else {
      onError({
        success: false,
        exitCode: code,
        sessionId: capturedSessionId,
        text: accumulatedText,
        stderr: accumulatedStderr,
        message: /authentication required/i.test(accumulatedStderr + (failure || ''))
          ? 'Gemini no está conectado en el servidor: inicia sesión con tu cuenta de Google ejecutando `agy` en una terminal.'
          : failure || String(accumulatedStderr).replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-6).join('\n') || `Gemini finalizó con código ${code}`
      });
    }
  });

  child.on('error', (err) => {
    releaseProcess(owner, child);
    removeTempDir(temp?.dir);
    onError({ success: false, message: err.message });
  });

  return { taskId, sessionId: capturedSessionId };
}
