import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
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
  validateApiKey,
  deleteClaudeTranscript
} from './claudeRunner.js';

import {
  getAvailableModels,
  addOrUpdateModel,
  deleteCustomModel,
  syncModelsFromAnthropic,
  withPricing,
  getDefaultModelId,
  getHostOAuthToken
} from './modelsManager.js';

import { refreshPricing, getPricingInfo } from './pricingManager.js';
import { summarizeResultCost, recordUsage, getUsage, resetUsage, getPlanLimits } from './usageManager.js';

import {
  login,
  validateToken,
  logout,
  logoutAll,
  changePassword,
  requireAuth,
  requireAuthAllowDefault,
  tokenFromRequest,
  getUsername,
  isUsingDefaultPassword
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
// Solo se aceptan conexiones WebSocket desde la propia web (evita que otra página abra una)
const wss = new WebSocketServer({
  server,
  verifyClient: ({ origin, req }) => {
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
});

const PORT = process.env.PORT || 5050;
// HOST=127.0.0.1 para que solo se pueda entrar desde este PC (p. ej. si usas Tailscale)
const HOST = process.env.HOST || '0.0.0.0';

// Cabeceras de seguridad básicas
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

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
  const { username, password } = req.body || {};
  const result = login(username, password, req);
  if (result.success) {
    res.json(result);
  } else {
    res.status(result.locked ? 429 : 401).json(result);
  }
});

app.get('/api/auth/verify', (req, res) => {
  if (validateToken(tokenFromRequest(req))) {
    res.json({ success: true, username: getUsername(), mustChangePassword: isUsingDefaultPassword() });
  } else {
    res.status(401).json({ success: false });
  }
});

app.post('/api/auth/change-password', requireAuthAllowDefault, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const result = changePassword(req.userToken, currentPassword, newPassword);
  if (result.success) {
    // Echar a los WebSocket de las sesiones que se acaban de cerrar
    for (const client of wss.clients) {
      if (client.authToken && !validateToken(client.authToken)) client.close(4001, 'Sesión cerrada');
    }
  }
  res.status(result.success ? 200 : 400).json(result);
});

app.post('/api/auth/logout', requireAuthAllowDefault, (req, res) => {
  logout(req.userToken);
  for (const client of wss.clients) {
    if (client.authToken === req.userToken) client.close(4001, 'Sesión cerrada');
  }
  res.json({ success: true });
});

// Cerrar sesión en todos los dispositivos (incluido este)
app.post('/api/auth/logout-all', requireAuthAllowDefault, (req, res) => {
  logoutAll();
  for (const client of wss.clients) client.close(4001, 'Sesión cerrada');
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
    availableModels: withPricing(getAvailableModels()),
    defaultModel: getDefaultModelId()
  });
});

// Dynamic Models Management Endpoints
app.get('/api/models', requireAuth, (req, res) => {
  res.json({
    success: true,
    models: withPricing(getAvailableModels()),
    defaultModel: getDefaultModelId()
  });
});

app.post('/api/models', requireAuth, (req, res) => {
  try {
    const { id, name, tag, badge, desc, icon } = req.body;
    const model = addOrUpdateModel({ id, name, tag, badge, desc, icon });
    res.json({ success: true, model, models: withPricing(getAvailableModels()) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/models/:id', requireAuth, (req, res) => {
  const ok = deleteCustomModel(req.params.id);
  res.json({ success: ok, models: withPricing(getAvailableModels()) });
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
  await refreshPricing();
  const result = await syncModelsFromAnthropic(resolveModelsCredential(clientKey));
  if (result.models) result.models = withPricing(result.models);
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

// Gasto acumulado por modelo
app.get('/api/usage', requireAuth, (req, res) => {
  res.json({ success: true, usage: getUsage(), pricing: getPricingInfo() });
});

// Porcentaje gastado de los límites de la suscripción del anfitrión (sesión y semana)
app.get('/api/usage/plan', requireAuth, async (req, res) => {
  const clientKey = req.headers['x-claude-api-key'] || null;
  if (getAppMode() === 'Client' || clientKey) {
    return res.json({ success: false, notApplicable: true, message: 'Estás usando una clave de API: no hay límites de suscripción.' });
  }
  res.json(await getPlanLimits(getHostOAuthToken(), req.query.refresh === '1' ? { maxAgeMs: 0 } : {}));
});

// Tras cada respuesta que gasta la suscripción, avisar a todos los dispositivos del nuevo porcentaje
async function broadcastPlanLimits() {
  if (getAppMode() === 'Client') return;
  const limits = await getPlanLimits(getHostOAuthToken(), { maxAgeMs: 20 * 1000 });
  if (limits.success) broadcast({ type: 'plan_limits', limits });
}

app.post('/api/usage/reset', requireAuth, (req, res) => {
  res.json({ success: true, usage: resetUsage() });
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
  const removed = deleteSession(req.params.id);
  // En incógnito se borra también la transcripción que guarda Claude Code en disco
  if (removed && removed.incognito && removed.claudeSessionId) {
    deleteClaudeTranscript(removed.claudeSessionId);
  }
  res.json({ success: !!removed });
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
wss.on('connection', (ws) => {
  ws.isAuthenticated = false;
  ws.authToken = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      // Autenticación: el token llega en el primer mensaje, nunca en la URL
      if (data.type === 'auth') {
        if (validateToken(data.token) && !isUsingDefaultPassword()) {
          ws.isAuthenticated = true;
          ws.authToken = data.token;
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

      // Bloquear mensajes sin sesión (o cuya sesión se ha cerrado mientras tanto)
      if (!ws.isAuthenticated || !validateToken(ws.authToken)) {
        ws.isAuthenticated = false;
        ws.send(JSON.stringify({ type: 'auth_error', message: 'No autenticado' }));
        return;
      }

      if (data.type === 'run_task') {
        const { prompt, workspace, sessionId, permissionMode, model, apiKey, attachments, effort, outputStyle, customInstructions, incognito } = data;
        const targetWs = workspace || getCurrentWorkspace();
        const attachmentList = Array.isArray(attachments) ? attachments : [];

        // Get or create session
        let currentSession = sessionId ? getSession(sessionId) : null;
        if (!currentSession) {
          currentSession = createSession('Nueva conversación', targetWs, { incognito: !!incognito });
        }

        const userMsg = {
          id: Date.now().toString(),
          role: 'user',
          text: prompt,
          // Solo los nombres: el contenido de los adjuntos nunca se guarda
          attachments: attachmentList.map(a => String(a.name || 'archivo')),
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
            attachments: attachmentList,
            effort: effort || null,
            outputStyle: outputStyle || null,
            customInstructions: typeof customInstructions === 'string' ? customInstructions : null,
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
                  id: event.id,
                  tool: event.tool,
                  input: event.input,
                  subagent: !!event.subagent,
                  status: 'running',
                  time: Date.now()
                });
                broadcast({
                  type: 'tool_use',
                  sessionId: currentSession.id,
                  id: event.id,
                  tool: event.tool,
                  input: event.input,
                  subagent: !!event.subagent
                });
              } else if (event.type === 'tool_result') {
                const toolEntry = assistantMsg.tools.find(t => t.id === event.id);
                if (toolEntry) toolEntry.status = event.isError ? 'error' : 'done';
                broadcast({
                  type: 'tool_result',
                  sessionId: currentSession.id,
                  id: event.id,
                  isError: event.isError,
                  content: event.content
                });
              }
            },
            onDone: (result) => {
              assistantMsg.status = 'completed';
              if (!assistantMsg.text && result.text) {
                assistantMsg.text = result.text;
              }
              // El resultado final solo contiene el último bloque de texto: usarlo solo si no se recibió nada en streaming
              if (!assistantMsg.text && result.result && result.result.result) {
                assistantMsg.text = typeof result.result.result === 'string'
                  ? result.result.result
                  : JSON.stringify(result.result.result, null, 2);
              }
              assistantMsg.duration = result.result?.duration_ms || null;

              // Coste de la respuesta según Claude Code (precio de tarifa de la API)
              const cost = summarizeResultCost(result.result);
              if (cost) {
                assistantMsg.cost = cost;
                recordUsage(cost);
              }

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

              if (!apiKey) broadcastPlanLimits();
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
          assistantMsg.status = 'error';
          assistantMsg.error = err.message;
          broadcast({
            type: 'task_error',
            sessionId: currentSession.id,
            message: assistantMsg,
            error: { message: err.message }
          });
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

// Mantener el catálogo de modelos al día con la API de Anthropic
const MODELS_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
setInterval(() => runModelsSync(null, 'periódica'), MODELS_SYNC_INTERVAL_MS).unref();

server.listen(PORT, HOST, () => {
  runModelsSync(null, 'arranque');

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
  if (HOST === '0.0.0.0') {
    console.log(`📱 Acceso móvil (Wi-Fi): http://${primaryIp}:${PORT}`);
  } else {
    console.log(`🔒 Solo escucha en:     ${HOST} (HOST en .env)`);
  }
  console.log('----------------------------------------------------');
  console.log(`📡 Modo (.env):         MODE=${currentMode} (${currentMode === 'Hoster' ? 'Cuenta compartida del anfitrión' : 'Cada cliente usa su propia key'})`);
  console.log(`🤖 Cuenta Claude:       ${authSummary}`);
  console.log(`👤 Usuario:             ${getUsername()}`);
  console.log(`🔑 Contraseña:          ${isUsingDefaultPassword() ? '⚠️ Por defecto: se pedirá cambiarla al entrar' : 'Guardada cifrada en data/auth.json'}`);
  console.log('====================================================');
});
