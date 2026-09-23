import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

import {
  getCurrentWorkspace,
  setWorkspace,
  listDirectory,
  createDirectory,
  getQuickLocations
} from './workspaceManager.js';

import {
  getClaudeAuthStatus,
  executeTask,
  cancelActiveTask,
  isTaskActive,
  getAppMode,
  validateApiKey
} from './claudeRunner.js';

import {
  getAvailableModels,
  addOrUpdateModel,
  deleteCustomModel,
  syncModelsFromAnthropic,
  getDefaultModelId,
  getHostOAuthToken
} from './modelsManager.js';

import {
  login,
  validateToken,
  logout,
  requireAuth
} from './auth.js';

import {
  getAllSessions,
  getSession,
  createSession,
  addMessageToSession,
  setClaudeSessionId,
  deleteSession
} from './sessionManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 5050;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(projectRoot, 'public')));

// Broadcast to authenticated WebSocket clients
function broadcast(data) {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
      client.send(json);
    }
  }
}

// --------------------------------------------------------------------------
// Auth Endpoints
// --------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const result = login(username, password);
  if (result.success) {
    res.json(result);
  } else {
    res.status(401).json(result);
  }
});

app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (validateToken(token)) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  logout(req.userToken);
  res.json({ success: true });
});

// --------------------------------------------------------------------------
// Application Endpoints (Protected by Auth)
// --------------------------------------------------------------------------
app.get('/api/status', requireAuth, (req, res) => {
  const clientKey = req.headers['x-claude-api-key'] || req.query.apiKey || null;
  const appMode = getAppMode();
  const auth = getClaudeAuthStatus(clientKey);
  res.json({
    status: 'ok',
    appMode,
    auth,
    currentWorkspace: getCurrentWorkspace(),
    isTaskActive: isTaskActive(),
    availableModels: getAvailableModels(),
    defaultModel: getDefaultModelId()
  });
});

// Dynamic Models Management Endpoints
app.get('/api/models', requireAuth, (req, res) => {
  res.json({
    success: true,
    models: getAvailableModels(),
    defaultModel: getDefaultModelId()
  });
});

app.post('/api/models', requireAuth, (req, res) => {
  try {
    const { id, name, tag, badge, desc, icon } = req.body;
    const model = addOrUpdateModel({ id, name, tag, badge, desc, icon });
    res.json({ success: true, model, models: getAvailableModels() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/models/:id', requireAuth, (req, res) => {
  const ok = deleteCustomModel(req.params.id);
  res.json({ success: ok, models: getAvailableModels() });
});

/**
 * Credencial para consultar /v1/models: la clave del cliente si la hay; en modo Hoster,
 * además, la ANTHROPIC_API_KEY del .env o la sesión OAuth del CLI del anfitrión.
 * En modo Client nunca se usan las credenciales del anfitrión.
 */
function resolveModelsCredential(clientKey = null) {
  if (clientKey && clientKey.trim()) return { apiKey: clientKey.trim() };
  if (getAppMode() === 'Client') return null;
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && envKey.trim()) return { apiKey: envKey.trim() };
  const oauthToken = getHostOAuthToken();
  return oauthToken ? { oauthToken } : null;
}

async function runModelsSync(clientKey = null, reason = 'manual') {
  const result = await syncModelsFromAnthropic(resolveModelsCredential(clientKey));
  if (result.success) {
    const changes = result.addedCount || result.removedCount
      ? ` (+${result.addedCount} / -${result.removedCount})`
      : ' (sin cambios)';
    console.log(`[modelos] Sincronizados desde Anthropic [${reason}]: ${result.models.map(m => m.id).join(', ')}${changes}`);
    if (result.addedCount || result.removedCount) {
      broadcast({ type: 'models_updated', models: result.models, defaultModel: result.defaultModel });
    }
  } else if (reason !== 'manual') {
    console.warn(`[modelos] No se pudo sincronizar [${reason}]: ${result.message}`);
  }
  return result;
}

app.post('/api/models/sync', requireAuth, async (req, res) => {
  const clientKey = req.headers['x-claude-api-key'] || req.body.apiKey || null;
  const result = await runModelsSync(clientKey, 'manual');
  res.json(result);
});

app.post('/api/auth/validate-key', requireAuth, (req, res) => {
  const { apiKey } = req.body;
  const result = validateApiKey(apiKey);
  res.json(result);
});

app.get('/api/sessions', requireAuth, (req, res) => {
  res.json({ success: true, sessions: getAllSessions() });
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const { title } = req.body;
  const session = createSession(title, getCurrentWorkspace());
  res.json({ success: true, session });
});

app.get('/api/sessions/:id', requireAuth, (req, res) => {
  const session = getSession(req.params.id);
  if (session) {
    res.json({ success: true, session });
  } else {
    res.status(404).json({ success: false, error: 'Conversación no encontrada' });
  }
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const ok = deleteSession(req.params.id);
  res.json({ success: ok });
});

app.get('/api/workspace', requireAuth, (req, res) => {
  const target = req.query.dir || getCurrentWorkspace();
  try {
    const list = listDirectory(target);
    res.json({ success: true, ...list });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/workspace', requireAuth, (req, res) => {
  const { path: newPath } = req.body;
  try {
    const updated = setWorkspace(newPath);
    broadcast({ type: 'workspace_changed', workspace: updated });
    res.json({ success: true, workspace: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/workspace/create', requireAuth, (req, res) => {
  const { parentPath, name } = req.body;
  try {
    const created = createDirectory(parentPath || getCurrentWorkspace(), name);
    res.json({ success: true, created });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/quick-locations', requireAuth, (req, res) => {
  res.json({ success: true, locations: getQuickLocations() });
});

app.post('/api/cancel', requireAuth, (req, res) => {
  const result = cancelActiveTask();
  broadcast({ type: 'task_canceled', result });
  res.json({ success: true, ...result });
});

// --------------------------------------------------------------------------
// WebSocket Server
// --------------------------------------------------------------------------
wss.on('connection', (ws, req) => {
  ws.isAuthenticated = false;

  // Check token in query param
  const urlParams = new URLSearchParams(req.url.replace(/^.*\?/, ''));
  const queryToken = urlParams.get('token');
  if (queryToken && validateToken(queryToken)) {
    ws.isAuthenticated = true;
    ws.send(JSON.stringify({
      type: 'auth_success',
      workspace: getCurrentWorkspace(),
      isTaskActive: isTaskActive()
    }));
  }

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      // Handle WebSocket Auth
      if (data.type === 'auth') {
        if (validateToken(data.token)) {
          ws.isAuthenticated = true;
          ws.send(JSON.stringify({
            type: 'auth_success',
            workspace: getCurrentWorkspace(),
            isTaskActive: isTaskActive()
          }));
        } else {
          ws.send(JSON.stringify({ type: 'auth_error', message: 'Token inválido' }));
        }
        return;
      }

      // Block unauthenticated messages
      if (!ws.isAuthenticated) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'No autenticado' }));
        return;
      }

      if (data.type === 'run_task') {
        const { prompt, workspace, sessionId, permissionMode, model, apiKey } = data;
        const targetWs = workspace || getCurrentWorkspace();

        // Get or create session
        let currentSession = sessionId ? getSession(sessionId) : null;
        if (!currentSession) {
          currentSession = createSession('Nueva conversación', targetWs);
        }

        const userMsg = {
          id: Date.now().toString(),
          role: 'user',
          text: prompt,
          workspace: targetWs,
          timestamp: Date.now()
        };

        addMessageToSession(currentSession.id, userMsg);
        broadcast({ type: 'user_message', sessionId: currentSession.id, message: userMsg });

        let assistantMsg = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          text: '',
          thinking: '',
          tools: [],
          workspace: targetWs,
          model: model || getDefaultModelId(),
          timestamp: Date.now(),
          status: 'running'
        };
        broadcast({ type: 'assistant_start', sessionId: currentSession.id, message: assistantMsg });

        try {
          executeTask({
            prompt,
            workspace: targetWs,
            sessionId: currentSession.claudeSessionId,
            permissionMode: permissionMode || 'acceptEdits',
            model: model || null,
            apiKey: apiKey || null,
            onEvent: (event) => {
              if (event.type === 'text_delta') {
                assistantMsg.text += event.text;
                broadcast({ type: 'stream_delta', sessionId: currentSession.id, text: event.text });
              } else if (event.type === 'thinking_delta') {
                assistantMsg.thinking += event.thinking;
                broadcast({ type: 'stream_thinking', sessionId: currentSession.id, thinking: event.thinking });
              } else if (event.type === 'text_raw') {
                assistantMsg.text += event.text + '\n';
                broadcast({ type: 'stream_raw', sessionId: currentSession.id, text: event.text });
              } else if (event.type === 'tool_use') {
                assistantMsg.tools.push({
                  tool: event.tool,
                  input: event.input,
                  status: 'running',
                  time: Date.now()
                });
                broadcast({ type: 'tool_use', sessionId: currentSession.id, tool: event.tool, input: event.input });
              } else if (event.type === 'tool_result') {
                broadcast({ type: 'tool_result', sessionId: currentSession.id, result: event.toolResult });
              }
            },
            onDone: (result) => {
              assistantMsg.status = 'completed';
              if (!assistantMsg.text && result.text) {
                assistantMsg.text = result.text;
              }
              if (result.result && result.result.result) {
                assistantMsg.text = typeof result.result.result === 'string'
                  ? result.result.result
                  : JSON.stringify(result.result.result, null, 2);
              }
              assistantMsg.duration = result.result?.duration_ms || null;

              if (result.sessionId) {
                setClaudeSessionId(currentSession.id, result.sessionId);
              }

              addMessageToSession(currentSession.id, assistantMsg);

              broadcast({
                type: 'task_completed',
                sessionId: currentSession.id,
                message: assistantMsg,
                result
              });
            },
            onError: (err) => {
              assistantMsg.status = 'error';
              assistantMsg.error = err.message || 'Error en la ejecución de Claude Code';
              if (err.text) assistantMsg.text = err.text;

              addMessageToSession(currentSession.id, assistantMsg);

              broadcast({
                type: 'task_error',
                sessionId: currentSession.id,
                message: assistantMsg,
                error: err
              });
            }
          });
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'error',
            message: err.message
          }));
        }
      } else if (data.type === 'cancel_task') {
        const res = cancelActiveTask();
        broadcast({ type: 'task_canceled', result: res });
      }
    } catch (e) {
      console.error('WebSocket message error:', e.message);
    }
  });
});

// Helper to get local network IPv4 addresses
function getLocalIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    const isVirtual = /vEthernet|WSL|Hyper-V|vboxnet|docker|vmnet/i.test(name);
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        ips.push({
          name,
          address: net.address,
          priority: isVirtual ? 1 : (net.address.startsWith('192.168.') || net.address.startsWith('10.') ? 10 : 5)
        });
      }
    }
  }
  ips.sort((a, b) => b.priority - a.priority);
  return ips;
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIps();
  const primaryIp = ips.length > 0 ? ips[0].address : 'localhost';
  const currentMode = getAppMode();

  let authSummary = 'Consultando...';
  try {
    const auth = getClaudeAuthStatus();
    if (auth && auth.loggedIn) {
      const plan = auth.subscriptionType ? auth.subscriptionType.toUpperCase() : 'PRO';
      authSummary = `✅ Conectada (${auth.email || 'Cuenta activa'} - Plan ${plan})`;
    } else {
      authSummary = `⚠️ NO conectada (Ejecuta: pnpm auth:login o añade ANTHROPIC_API_KEY en .env)`;
    }
  } catch (e) {
    authSummary = `⚠️ No detectada (${e.message})`;
  }

  console.log('====================================================');
  console.log('       🌟 CLAUDEZER0 - INTERFAZ CLAUDE.AI 🌟        ');
  console.log('====================================================');
  console.log(`💻 Acceso PC:           http://localhost:${PORT}`);
  console.log(`📱 Acceso móvil (Wi-Fi): http://${primaryIp}:${PORT}`);
  console.log('----------------------------------------------------');
  console.log(`📡 Modo (.env):         MODE=${currentMode} (${currentMode === 'Hoster' ? 'Cuenta compartida del anfitrión' : 'Cada cliente usa su propia key'})`);
  console.log(`🤖 Cuenta Claude:       ${authSummary}`);
  console.log(`👤 Usuario (.env):      ${process.env.CLAUDEZER0_USER || 'admin'}`);
  console.log(`🔑 Contraseña (.env):   ${process.env.CLAUDEZER0_PASSWORD || 'claudezer0'}`);
  console.log('====================================================');
});
