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
  getQuickLocations,
  forgetUserWorkspace
} from './workspaceManager.js';

import { isRestricted, isPathAllowed, isModeAllowed, toolPathViolation } from './accessPolicy.js';

import {
  setPermissionNotifier,
  registerTask,
  unregisterTask,
  requestPermission,
  answerPermission,
  listPendingFor,
  forgetChat
} from './permissionManager.js';

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
import {
  summarizeResultCost,
  recordUsage,
  getUsage,
  resetUsage,
  getPlanLimits,
  getMonthCost,
  forgetUserUsage
} from './usageManager.js';

import {
  login,
  getUserFromToken,
  logout,
  logoutAll,
  changePassword,
  requireAuth,
  requireAuthAllowDefault,
  requireAdmin,
  tokenFromRequest,
  getAdminUsername,
  isUsingDefaultPassword,
  listUsers,
  createUser,
  updateUser,
  deleteUser
} from './auth.js';

import {
  getAllSessions,
  getSession,
  createSession,
  addMessageToSession,
  setClaudeSessionId,
  deleteSession,
  assignLegacyOwner,
  deleteSessionsByOwner
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

assignLegacyOwner(getAdminUsername());

// --------------------------------------------------------------------------
// Permisos de herramientas: el servidor MCP (permissionMcp.js) que lanza Claude Code llama aquí
// y la petición espera a que el usuario responda desde la web. Va antes del parser global
// porque el input de una herramienta (p. ej. Write) puede superar su límite de tamaño.
// --------------------------------------------------------------------------
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

app.post('/internal/permission', express.json({ limit: '20mb' }), async (req, res) => {
  const secret = req.headers['x-claudezer0-secret'];
  if (!LOOPBACK.has(req.socket.remoteAddress) || typeof secret !== 'string') {
    return res.status(403).json({ behavior: 'deny', message: 'No autorizado' });
  }
  const decision = await requestPermission(secret, req.body || {});
  res.json(decision);
});

app.use(express.json());
app.use(express.static(path.join(projectRoot, 'public')));

// Enviar a todos los dispositivos autenticados (datos comunes: catálogo de modelos, límites del plan)
function broadcast(data) {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
      client.send(json);
    }
  }
}

// Enviar solo a los dispositivos de un usuario (sus conversaciones, tareas y permisos)
function sendToUser(username, data) {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.isAuthenticated && client.username === username) {
      client.send(json);
    }
  }
}

function closeUserSockets(username, { exceptToken = null } = {}) {
  for (const client of wss.clients) {
    if (client.username === username && client.authToken !== exceptToken) client.close(4001, 'Sesión cerrada');
  }
}

setPermissionNotifier(sendToUser);

// Dirección a la que llama el servidor MCP de permisos (siempre en este mismo equipo)
function permissionCallbackUrl() {
  const host = !HOST || HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST;
  return `http://${host.includes(':') ? `[${host}]` : host}:${PORT}/internal/permission`;
}

// Límite mensual del usuario con la cuenta del anfitrión (null = sin límite o no aplica)
function monthlyLimitStatus(user, usingOwnKey) {
  if (!isRestricted(user) || usingOwnKey || user.monthlyLimitUSD === null) return null;
  const spent = getMonthCost(user.username);
  return { limitUSD: user.monthlyLimitUSD, spentUSD: spent, reached: spent >= user.monthlyLimitUSD };
}

// Datos del usuario que necesita la web
function userInfo(user) {
  return {
    username: user.username,
    role: user.role,
    allowedModes: user.allowedModes,
    roots: user.roots,
    monthlyLimitUSD: user.monthlyLimitUSD,
    monthSpentUSD: isRestricted(user) ? getMonthCost(user.username) : null
  };
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
  const user = getUserFromToken(tokenFromRequest(req));
  if (user) {
    res.json({ success: true, username: user.username, mustChangePassword: user.mustChangePassword, user: userInfo(user) });
  } else {
    res.status(401).json({ success: false });
  }
});

app.post('/api/auth/change-password', requireAuthAllowDefault, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const result = changePassword(req.userToken, currentPassword, newPassword);
  if (result.success) {
    // Echar a los WebSocket de las sesiones que se acaban de cerrar
    closeUserSockets(req.user.username, { exceptToken: req.userToken });
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

// Cerrar sesión en todos los dispositivos del usuario (incluido este)
app.post('/api/auth/logout-all', requireAuthAllowDefault, (req, res) => {
  logoutAll(req.user.username);
  closeUserSockets(req.user.username);
  res.json({ success: true });
});

// --------------------------------------------------------------------------
// Gestión de usuarios (solo admin)
// --------------------------------------------------------------------------
function usersWithUsage() {
  return listUsers().map(u => ({ ...u, monthSpentUSD: getMonthCost(u.username) }));
}

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ success: true, users: usersWithUsage() });
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const user = createUser(req.body || {});
    res.json({ success: true, user, users: usersWithUsage() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.patch('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
  try {
    const { password, roots, allowedModes, monthlyLimitUSD } = req.body || {};
    const user = updateUser(req.params.username, { password, roots, allowedModes, monthlyLimitUSD });
    if (password) closeUserSockets(user.username);
    else sendToUser(user.username, { type: 'user_updated', user: userInfo(user) });
    res.json({ success: true, user, users: usersWithUsage() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
  const { username } = req.params;
  cancelActiveTask(username);
  if (!deleteUser(username)) {
    return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
  }
  closeUserSockets(username);
  for (const s of deleteSessionsByOwner(username)) {
    forgetChat(s.id);
    if (s.claudeSessionId) deleteClaudeTranscript(s.claudeSessionId);
  }
  forgetUserWorkspace(username);
  forgetUserUsage(username);
  res.json({ success: true, users: usersWithUsage() });
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
    user: userInfo(req.user),
    currentWorkspace: getCurrentWorkspace(req.user),
    isTaskActive: isTaskActive(req.user.username),
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

app.post('/api/models', requireAuth, requireAdmin, (req, res) => {
  try {
    const { id, name, tag, badge, desc, icon } = req.body;
    const model = addOrUpdateModel({ id, name, tag, badge, desc, icon });
    res.json({ success: true, model, models: withPricing(getAvailableModels()) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/models/:id', requireAuth, requireAdmin, (req, res) => {
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

// Gasto acumulado por modelo (el admin ve el total; cada usuario, el suyo y su límite mensual)
app.get('/api/usage', requireAuth, (req, res) => {
  const own = isRestricted(req.user);
  res.json({
    success: true,
    usage: getUsage(own ? req.user.username : null),
    monthlyLimit: own ? monthlyLimitStatus(req.user, false) : null,
    pricing: getPricingInfo()
  });
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

app.post('/api/usage/reset', requireAuth, requireAdmin, (req, res) => {
  res.json({ success: true, usage: resetUsage() });
});

app.post('/api/auth/validate-key', requireAuth, (req, res) => {
  const { apiKey } = req.body;
  const result = validateApiKey(apiKey);
  res.json(result);
});

app.get('/api/sessions', requireAuth, (req, res) => {
  res.json({ success: true, sessions: getAllSessions(req.user.username) });
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const { title } = req.body;
  const session = createSession(title, getCurrentWorkspace(req.user), { owner: req.user.username });
  res.json({ success: true, session });
});

app.get('/api/sessions/:id', requireAuth, (req, res) => {
  const session = getSession(req.params.id, req.user.username);
  if (session) {
    res.json({ success: true, session });
  } else {
    res.status(404).json({ success: false, error: 'Conversación no encontrada' });
  }
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  if (!getSession(req.params.id, req.user.username)) {
    return res.status(404).json({ success: false, error: 'Conversación no encontrada' });
  }
  const removed = deleteSession(req.params.id);
  forgetChat(req.params.id);
  // En incógnito se borra también la transcripción que guarda Claude Code en disco
  if (removed && removed.incognito && removed.claudeSessionId) {
    deleteClaudeTranscript(removed.claudeSessionId);
  }
  res.json({ success: !!removed });
});

app.get('/api/workspace', requireAuth, (req, res) => {
  const target = req.query.dir || getCurrentWorkspace(req.user);
  try {
    const list = listDirectory(req.user, target);
    res.json({ success: true, ...list });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/workspace', requireAuth, (req, res) => {
  const { path: newPath } = req.body;
  try {
    const updated = setWorkspace(req.user, newPath);
    sendToUser(req.user.username, { type: 'workspace_changed', workspace: updated });
    res.json({ success: true, workspace: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/workspace/create', requireAuth, (req, res) => {
  const { parentPath, name } = req.body;
  try {
    const created = createDirectory(req.user, parentPath || getCurrentWorkspace(req.user), name);
    res.json({ success: true, created });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/quick-locations', requireAuth, (req, res) => {
  res.json({ success: true, locations: getQuickLocations(req.user) });
});

app.post('/api/cancel', requireAuth, (req, res) => {
  const result = cancelActiveTask(req.user.username);
  sendToUser(req.user.username, { type: 'task_canceled', result });
  res.json({ success: true, ...result });
});

// --------------------------------------------------------------------------
// WebSocket Server
// --------------------------------------------------------------------------
wss.on('connection', (ws) => {
  ws.isAuthenticated = false;
  ws.authToken = null;
  ws.username = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      // Autenticación: el token llega en el primer mensaje, nunca en la URL
      if (data.type === 'auth') {
        const authUser = getUserFromToken(data.token);
        if (authUser && !authUser.mustChangePassword) {
          ws.isAuthenticated = true;
          ws.authToken = data.token;
          ws.username = authUser.username;
          ws.send(JSON.stringify({
            type: 'auth_success',
            workspace: getCurrentWorkspace(authUser),
            isTaskActive: isTaskActive(authUser.username),
            user: userInfo(authUser),
            // Peticiones de permiso que siguen esperando (p. ej. tras perder la conexión en el móvil)
            pendingPermissions: listPendingFor(authUser.username)
          }));
        } else {
          ws.send(JSON.stringify({ type: 'auth_error', message: 'Token inválido' }));
        }
        return;
      }

      // Bloquear mensajes sin sesión (o cuya sesión se ha cerrado mientras tanto).
      // El usuario se relee en cada mensaje: el admin puede haber cambiado sus permisos.
      const user = ws.isAuthenticated ? getUserFromToken(ws.authToken) : null;
      if (!user || user.mustChangePassword) {
        ws.isAuthenticated = false;
        ws.send(JSON.stringify({ type: 'auth_error', message: 'No autenticado' }));
        return;
      }
      const owner = user.username;

      if (data.type === 'run_task') {
        const { prompt, workspace, sessionId, permissionMode, model, apiKey, attachments, effort, outputStyle, customInstructions, incognito } = data;
        const targetWs = workspace || getCurrentWorkspace(user);
        const attachmentList = Array.isArray(attachments) ? attachments : [];
        const mode = permissionMode || 'acceptEdits';
        const usingOwnKey = getAppMode() === 'Client' || !!(apiKey && String(apiKey).trim());

        // Comprobaciones antes de crear nada: carpeta, modo y límite mensual
        const rejection = !isPathAllowed(user, targetWs)
          ? 'No tienes acceso a esa carpeta. Elige una de tus carpetas permitidas.'
          : isRestricted(user) && !isModeAllowed(user, mode)
            ? 'Tu usuario no tiene permitido ese modo de ejecución.'
            : monthlyLimitStatus(user, usingOwnKey)?.reached
              ? `Has alcanzado tu límite mensual de ${user.monthlyLimitUSD.toFixed(2)} USD. Pídele al administrador que lo amplíe o usa tu propia clave de API.`
              : null;
        if (rejection) {
          sendToUser(owner, {
            type: 'task_error',
            sessionId: sessionId || null,
            message: { role: 'assistant', status: 'error', error: rejection },
            error: { message: rejection }
          });
          return;
        }

        // Get or create session
        let currentSession = sessionId ? getSession(sessionId, owner) : null;
        if (!currentSession) {
          currentSession = createSession('Nueva conversación', targetWs, { incognito: !!incognito, owner });
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
        sendToUser(owner, { type: 'user_message', sessionId: currentSession.id, message: userMsg });

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
        sendToUser(owner, { type: 'assistant_start', sessionId: currentSession.id, message: assistantMsg });

        // Puente de permisos de esta tarea: las rutas fuera de las carpetas del usuario se deniegan sin preguntar
        const permissionSecret = registerTask({
          owner,
          chatId: currentSession.id,
          check: (tool, input) => toolPathViolation(user, tool, input, targetWs)
        });

        try {
          executeTask({
            prompt,
            workspace: targetWs,
            sessionId: currentSession.claudeSessionId,
            owner,
            permissionMode: mode,
            permissionBridge: { url: permissionCallbackUrl(), secret: permissionSecret },
            model: model || null,
            apiKey: apiKey || null,
            attachments: attachmentList,
            effort: effort || null,
            outputStyle: outputStyle || null,
            customInstructions: typeof customInstructions === 'string' ? customInstructions : null,
            onEvent: (event) => {
              if (event.type === 'text_delta') {
                assistantMsg.text += event.text;
                sendToUser(owner, { type: 'stream_delta', sessionId: currentSession.id, text: event.text });
              } else if (event.type === 'thinking_delta') {
                assistantMsg.thinking += event.thinking;
                sendToUser(owner, { type: 'stream_thinking', sessionId: currentSession.id, thinking: event.thinking });
              } else if (event.type === 'text_raw') {
                assistantMsg.text += event.text + '\n';
                sendToUser(owner, { type: 'stream_raw', sessionId: currentSession.id, text: event.text });
              } else if (event.type === 'tool_use') {
                assistantMsg.tools.push({
                  id: event.id,
                  tool: event.tool,
                  input: event.input,
                  subagent: !!event.subagent,
                  status: 'running',
                  time: Date.now()
                });
                sendToUser(owner, {
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
                sendToUser(owner, {
                  type: 'tool_result',
                  sessionId: currentSession.id,
                  id: event.id,
                  isError: event.isError,
                  content: event.content
                });
              }
            },
            onDone: (result) => {
              unregisterTask(permissionSecret);
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
                recordUsage(cost, owner, { hostAccount: !usingOwnKey });
              }

              if (result.sessionId) {
                setClaudeSessionId(currentSession.id, result.sessionId);
              }

              addMessageToSession(currentSession.id, assistantMsg);

              sendToUser(owner, {
                type: 'task_completed',
                sessionId: currentSession.id,
                message: assistantMsg,
                result
              });

              if (!apiKey) broadcastPlanLimits();
            },
            onError: (err) => {
              unregisterTask(permissionSecret);
              assistantMsg.status = 'error';
              assistantMsg.error = err.message || 'Error en la ejecución de Claude Code';
              if (err.text) assistantMsg.text = err.text;

              addMessageToSession(currentSession.id, assistantMsg);

              sendToUser(owner, {
                type: 'task_error',
                sessionId: currentSession.id,
                message: assistantMsg,
                error: err
              });
            }
          });
        } catch (err) {
          unregisterTask(permissionSecret);
          assistantMsg.status = 'error';
          assistantMsg.error = err.message;
          sendToUser(owner, {
            type: 'task_error',
            sessionId: currentSession.id,
            message: assistantMsg,
            error: { message: err.message }
          });
        }
      } else if (data.type === 'permission_response') {
        answerPermission(String(data.id || ''), owner, {
          allow: data.allow === true,
          always: data.always === true,
          message: data.message
        });
      } else if (data.type === 'cancel_task') {
        const res = cancelActiveTask(owner);
        sendToUser(owner, { type: 'task_canceled', result: res });
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
  console.log(`👤 Administrador:       ${getAdminUsername()}`);
  console.log(`🔑 Contraseña:          ${isUsingDefaultPassword() ? '⚠️ Por defecto: se pedirá cambiarla al entrar' : 'Guardada cifrada en data/auth.json'}`);
  console.log('====================================================');
});
