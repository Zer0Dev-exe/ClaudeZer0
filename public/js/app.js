// ==========================================================================
// ClaudeZer0 - Cliente Oficial Estilo Claude.ai con Auth .env e Historial
// ==========================================================================

let authToken = localStorage.getItem('claudezer0_token') || null;
let currentUsername = localStorage.getItem('claudezer0_user') || 'admin';
let ws = null;
let currentWorkspace = '';
let activeSessionId = null;
let isRunning = false;

let currentAssistantElement = null;
let currentTextElement = null;
let currentThinkingElement = null;
let currentAccumulatedText = '';
let currentAccumulatedThinking = '';

let recognition = null;
let isListening = false;
let browsingDirectory = '';

// DOM Elements: Auth
const loginScreen = document.getElementById('login-screen');
const mainApp = document.getElementById('main-app');
const loginForm = document.getElementById('login-form');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const btnLogout = document.getElementById('btn-logout');
const userDisplayName = document.getElementById('user-display-name');
const userAvatarLetter = document.getElementById('user-avatar-letter');

// DOM Elements: Sidebar & History
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const btnHamburger = document.getElementById('btn-hamburger');
const btnNewChat = document.getElementById('btn-new-chat');
const sessionsList = document.getElementById('sessions-list');
const sidebarWsName = document.getElementById('sidebar-ws-name');
const btnChangeWs = document.getElementById('btn-change-ws');

// DOM Elements: Main Chat
const topChatTitle = document.getElementById('top-chat-title');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const chatViewport = document.getElementById('chat-viewport');
const emptyState = document.getElementById('empty-state');
const messagesContainer = document.getElementById('messages-container');
const promptInput = document.getElementById('prompt-input');
const btnSend = document.getElementById('btn-send');
const btnStop = document.getElementById('btn-stop');
const btnVoice = document.getElementById('btn-voice');
const inputWsPill = document.getElementById('input-ws-pill');
const inputWsName = document.getElementById('input-ws-name');
const permissionMode = document.getElementById('permission-mode');

// DOM Elements: Model & Mode Custom Dropdowns
const dropdownModel = document.getElementById('dropdown-model');
const btnModelTrigger = document.getElementById('btn-model-trigger');
const currentModelName = document.getElementById('current-model-name');
const currentModelTag = document.getElementById('current-model-tag');
const menuModelOptions = document.getElementById('menu-model-options');
const dynamicModelList = document.getElementById('dynamic-model-list');
const btnOpenAddModel = document.getElementById('btn-open-add-model');
const btnSyncModels = document.getElementById('btn-sync-models');

const dropdownMode = document.getElementById('dropdown-mode');
const btnModeTrigger = document.getElementById('btn-mode-trigger');
const currentModeIcon = document.getElementById('current-mode-icon');
const currentModeLabel = document.getElementById('current-mode-label');
const menuModeOptions = document.getElementById('menu-mode-options');

// DOM Elements: Custom Model Modal
const customModelModal = document.getElementById('custom-model-modal');
const btnCloseCustomModelModal = document.getElementById('btn-close-custom-model-modal');
const btnCancelCustomModelModal = document.getElementById('btn-cancel-custom-model-modal');
const btnSaveCustomModel = document.getElementById('btn-save-custom-model');
const customModelIdInput = document.getElementById('custom-model-id');
const customModelNameInput = document.getElementById('custom-model-name-input');
const customModelTagInput = document.getElementById('custom-model-tag-input');
const customModelDescInput = document.getElementById('custom-model-desc-input');
const customModelStatus = document.getElementById('custom-model-status');

// DOM Elements: Slash Commands Popover
const slashPopup = document.getElementById('slash-popup');
const slashPopupList = document.getElementById('slash-popup-list');
let highlightedSlashIndex = -1;
let currentSlashMatches = [];

// Dynamic Models Catalog
let availableModelsList = [
  { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', tag: 'Híbrido', desc: 'Pensamiento híbrido y alta precisión', default: true },
  { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', tag: 'Ultrarrápido', desc: 'Velocidad y bajo coste' },
  { id: 'claude-3-opus', name: 'Claude 3 Opus', tag: 'Profundo', desc: 'Capacidad profunda y contextual' }
];
let availableModelsMap = {};

function rebuildModelsMap() {
  availableModelsMap = {};
  availableModelsList.forEach(m => {
    availableModelsMap[m.id] = m;
    const lower = m.id.toLowerCase();
    if (lower.includes('sonnet')) availableModelsMap['sonnet'] = m;
    if (lower.includes('haiku')) availableModelsMap['haiku'] = m;
    if (lower.includes('opus')) availableModelsMap['opus'] = m;
  });
}
rebuildModelsMap();

function getModelInfo(id) {
  if (!id) return availableModelsList[0];
  if (availableModelsMap[id]) return availableModelsMap[id];
  const lower = String(id).toLowerCase();
  for (const m of availableModelsList) {
    if (m.id.toLowerCase() === lower || m.id.toLowerCase().includes(lower)) {
      return m;
    }
  }
  return { id, name: id, tag: 'Custom', desc: 'Modelo personalizado' };
}

const EXECUTION_MODES = {
  'acceptEdits': {
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="m15 5 4 4"></path></svg>`,
    label: 'Aceptar ediciones'
  },
  'auto': {
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
    label: 'Autónomo'
  },
  'manual': {
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
    label: 'Manual'
  },
  'plan': {
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><line x1="9" y1="11" x2="15" y2="11"></line><line x1="9" y1="16" x2="13" y2="16"></line></svg>`,
    label: 'Modo Plan'
  }
};

let selectedModel = localStorage.getItem('claudezer0_model') || 'claude-3-7-sonnet';

// DOM Elements: Workspace Modal
const workspaceModal = document.getElementById('workspace-modal');
const btnOpenWorkspace = document.getElementById('btn-open-workspace');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelWorkspace = document.getElementById('btn-cancel-workspace');
const btnSelectWorkspace = document.getElementById('btn-select-workspace');
const customDirInput = document.getElementById('custom-dir-input');
const btnDirGo = document.getElementById('btn-dir-go');
const btnDirUp = document.getElementById('btn-dir-up');
const quickLocationsList = document.getElementById('quick-locations-list');
const foldersList = document.getElementById('folders-list');
const newFolderName = document.getElementById('new-folder-name');
const btnCreateFolder = document.getElementById('btn-create-folder');

// DOM Elements: Modo Hoster/Client & Key Modal
let appMode = 'Hoster';
let clientApiKey = localStorage.getItem('claudezer0_client_key') || '';
let serverAuthInfo = null;

const btnModeIndicator = document.getElementById('btn-mode-indicator');
const modePillDot = document.getElementById('mode-pill-dot');
const modePillText = document.getElementById('mode-pill-text');
const userPlanLabel = document.getElementById('user-plan-label');
const btnSidebarKey = document.getElementById('btn-sidebar-key');
const btnSidebarUserPill = document.getElementById('btn-sidebar-user-pill');

const keyModal = document.getElementById('key-modal');
const btnCloseKeyModal = document.getElementById('btn-close-key-modal');
const btnCancelKeyModal = document.getElementById('btn-cancel-key-modal');
const btnSaveKeyModal = document.getElementById('btn-save-key-modal');
const keyModalModeBadge = document.getElementById('key-modal-mode-badge');
const keyModalModeStatus = document.getElementById('key-modal-mode-status');
const keyModalModeDesc = document.getElementById('key-modal-mode-desc');
const clientApiKeyInput = document.getElementById('client-api-key-input');
const btnToggleKeyVis = document.getElementById('btn-toggle-key-vis');
const keyValidationStatus = document.getElementById('key-validation-status');
const btnTestKey = document.getElementById('btn-test-key');
const btnDeleteKey = document.getElementById('btn-delete-key');
const emptySubtext = document.querySelector('.empty-subtext');

// ==========================================================================
// 1. Autenticación (.env)
// ==========================================================================
async function checkAuth() {
  if (!authToken) {
    showLogin();
    return;
  }

  try {
    const res = await fetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      showApp();
    } else {
      showLogin();
    }
  } catch (err) {
    console.warn('Error verificando auth:', err);
    showLogin();
  }
}

function showLogin() {
  loginScreen.style.display = 'flex';
  mainApp.style.display = 'none';
}

function showApp() {
  loginScreen.style.display = 'none';
  mainApp.style.display = 'flex';
  userDisplayName.textContent = currentUsername;
  userAvatarLetter.textContent = currentUsername.charAt(0).toUpperCase();

  initApp();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.style.display = 'none';

  const username = loginUsername.value.trim();
  const password = loginPassword.value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (data.success) {
      authToken = data.token;
      currentUsername = data.username;
      localStorage.setItem('claudezer0_token', authToken);
      localStorage.setItem('claudezer0_user', currentUsername);
      showApp();
    } else {
      loginError.textContent = data.message || 'Usuario o contraseña incorrectos';
      loginError.style.display = 'block';
    }
  } catch (err) {
    loginError.textContent = 'Error al conectar con el servidor';
    loginError.style.display = 'block';
  }
});

btnLogout.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
  } catch (e) {}

  localStorage.removeItem('claudezer0_token');
  authToken = null;
  showLogin();
});

// Helper for authenticated fetch
async function authFetch(url, options = {}) {
  options.headers = options.headers || {};
  options.headers['Authorization'] = `Bearer ${authToken}`;
  if (clientApiKey) {
    options.headers['x-claude-api-key'] = clientApiKey;
  }
  const res = await fetch(url, options);
  if (res.status === 401) {
    showLogin();
    throw new Error('No autorizado');
  }
  return res;
}

// ==========================================================================
// 2. Inicialización de la Aplicación
// ==========================================================================
function initApp() {
  initModelAndMode();
  loadModels();
  connectWebSocket();
  loadInitialStatus();
  loadSessions();
  setupVoice();
  setupEventListeners();
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}?token=${authToken}`;

  if (statusIndicator) statusIndicator.className = 'status-indicator';
  if (statusText) statusText.textContent = 'Conectando...';

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    if (statusIndicator) statusIndicator.className = 'status-indicator';
    if (statusText) statusText.textContent = 'Conectado';
    ws.send(JSON.stringify({ type: 'auth', token: authToken }));
  };

  ws.onclose = () => {
    if (statusIndicator) statusIndicator.className = 'status-indicator';
    if (statusText) statusText.textContent = 'Desconectado';
    if (btnModelTrigger) btnModelTrigger.classList.remove('working');
    setTimeout(() => {
      if (authToken) connectWebSocket();
    }, 3000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWsMessage(data);
    } catch (e) {
      console.error('Error parseando mensaje WS:', e);
    }
  };
}

async function loadInitialStatus() {
  try {
    const res = await authFetch('/api/status');
    const data = await res.json();
    if (data.auth) {
      serverAuthInfo = data.auth;
    }
    if (data.appMode) {
      appMode = data.appMode;
      updateModeUI();
    }
    if (data.currentWorkspace) {
      updateWorkspaceUI(data.currentWorkspace);
    }
    if (data.availableModels && Array.isArray(data.availableModels)) {
      availableModelsList = data.availableModels;
      rebuildModelsMap();
      renderModelDropdown();
    }
  } catch (e) {}
}

async function loadModels() {
  try {
    const res = await authFetch('/api/models');
    const data = await res.json();
    if (data.success && Array.isArray(data.models)) {
      availableModelsList = data.models;
      rebuildModelsMap();
      renderModelDropdown();
    }
  } catch (err) {
    console.warn('Error cargando modelos:', err);
  }
}

function updateModeUI() {
  if (appMode === 'Client') {
    if (userPlanLabel) {
      userPlanLabel.textContent = clientApiKey ? 'Cliente (Key lista)' : 'Cliente (Sin Key)';
    }
    if (btnModeIndicator && modePillText && modePillDot) {
      if (clientApiKey) {
        btnModeIndicator.className = 'mode-pill-btn client-ready';
        modePillText.textContent = 'Mi Key lista';
        btnModeIndicator.title = 'Modo Cliente: Tu clave personal de Claude está configurada (Clic para ver/cambiar)';
      } else {
        btnModeIndicator.className = 'mode-pill-btn client-missing';
        modePillText.textContent = 'Configurar Key';
        btnModeIndicator.title = 'Modo Cliente: Falta tu clave de Claude (Clic para configurar)';
      }
    }
    if (emptySubtext) {
      emptySubtext.textContent = clientApiKey
        ? 'Modo Cliente: Tu agente está ejecutándose con tu propia clave personal de Claude.'
        : 'Modo Cliente: Configura tu API Key de Claude para comenzar a interactuar.';
    }
  } else {
    // Hoster mode
    const isHostLoggedIn = serverAuthInfo && serverAuthInfo.loggedIn;
    const planName = serverAuthInfo && serverAuthInfo.subscriptionType
      ? `Claude ${serverAuthInfo.subscriptionType.toUpperCase()}`
      : (isHostLoggedIn ? 'Claude Conectado' : 'Sin cuenta');

    if (userPlanLabel) {
      userPlanLabel.textContent = clientApiKey
        ? 'Hoster (Key propia)'
        : (isHostLoggedIn ? planName : 'Hoster (Sin cuenta)');
    }

    const userPill = document.getElementById('btn-sidebar-user-pill');
    if (userPill) {
      userPill.title = isHostLoggedIn
        ? `Modo Hoster activo: ${serverAuthInfo.email || 'Cuenta compartida'}`
        : 'Modo Hoster: Cuenta no vinculada (ejecuta pnpm auth:login)';
    }

    if (btnModeIndicator && modePillText && modePillDot) {
      if (isHostLoggedIn || clientApiKey) {
        btnModeIndicator.className = 'mode-pill-btn hoster';
        modePillText.textContent = clientApiKey ? 'Key Propia' : 'Modo Hoster';
        btnModeIndicator.title = isHostLoggedIn
          ? `Modo Hoster: Cuenta activa (${serverAuthInfo.email || 'Compartida'})`
          : 'Modo Hoster: Usando clave personal';
      } else {
        btnModeIndicator.className = 'mode-pill-btn client-missing';
        modePillText.textContent = 'Vincular Claude';
        btnModeIndicator.title = 'Modo Hoster: El anfitrión aún no ha iniciado sesión. Clic para ver instrucciones.';
      }
    }
    if (emptySubtext) {
      emptySubtext.textContent = isHostLoggedIn
        ? `Modo Hoster: Conectado a la cuenta compartida de Claude (${serverAuthInfo.email || 'Plan Pro'}).`
        : 'Modo Hoster: El anfitrión debe vincular su cuenta con "pnpm auth:login" o definir ANTHROPIC_API_KEY en .env.';
    }
  }
}

function updateWorkspaceUI(wsPath) {
  currentWorkspace = wsPath;
  sidebarWsName.textContent = wsPath;
  const parts = wsPath.split(/[\\/]/).filter(Boolean);
  const shortName = parts.length > 0 ? parts[parts.length - 1] : wsPath;
  inputWsName.textContent = shortName;
  if (inputWsPill) inputWsPill.title = `Carpeta activa: ${wsPath} (clic para cambiar)`;
}

// ==========================================================================
// 3. Historial de Sesiones & Conversaciones
// ==========================================================================
async function loadSessions() {
  try {
    const res = await authFetch('/api/sessions');
    const data = await res.json();
    renderSessionsList(data.sessions || []);
  } catch (e) {
    sessionsList.innerHTML = '<div class="sessions-loading">Error al cargar chats</div>';
  }
}

function renderSessionsList(sessions) {
  sessionsList.innerHTML = '';
  if (sessions.length === 0) {
    sessionsList.innerHTML = '<div class="sessions-loading">Sin conversaciones previas</div>';
    return;
  }

  sessions.forEach(sess => {
    const item = document.createElement('div');
    item.className = 'session-item' + (sess.id === activeSessionId ? ' active' : '');
    item.innerHTML = `
      <span class="session-title-text" title="${escapeHtml(sess.title)}">${escapeHtml(sess.title)}</span>
      <button class="session-del-btn" title="Eliminar chat" data-id="${sess.id}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
        </svg>
      </button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.session-del-btn')) return;
      openSession(sess.id);
    });

    const delBtn = item.querySelector('.session-del-btn');
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`¿Eliminar la conversación "${sess.title}"?`)) {
        await deleteSession(sess.id);
      }
    });

    sessionsList.appendChild(item);
  });
}

async function openSession(id) {
  try {
    const res = await authFetch(`/api/sessions/${id}`);
    const data = await res.json();
    if (data.session) {
      activeSessionId = data.session.id;
      topChatTitle.textContent = data.session.title;
      renderMessages(data.session.messages || []);
      loadSessions();
      closeMobileSidebar();
    }
  } catch (err) {
    console.error('Error cargando sesión:', err);
  }
}

async function deleteSession(id) {
  try {
    await authFetch(`/api/sessions/${id}`, { method: 'DELETE' });
    if (activeSessionId === id) {
      newChat();
    } else {
      loadSessions();
    }
  } catch (e) {}
}

function newChat() {
  activeSessionId = null;
  topChatTitle.textContent = 'Nueva conversación';
  messagesContainer.innerHTML = '';
  emptyState.style.display = 'block';
  loadSessions();
  closeMobileSidebar();
}

// ==========================================================================
// 4. Renderizado de Mensajes (Estilo Claude.ai)
// ==========================================================================
function renderMessages(messages) {
  messagesContainer.innerHTML = '';
  if (!messages || messages.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  messages.forEach(msg => {
    if (msg.role === 'user') {
      appendUserMsg(msg.text);
    } else if (msg.role === 'assistant') {
      appendAssistantMsgStatic(msg);
    }
  });

  scrollToBottom();
}

function appendUserMsg(text) {
  emptyState.style.display = 'none';
  const row = document.createElement('div');
  row.className = 'msg-row user';
  row.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div>`;
  messagesContainer.appendChild(row);
  scrollToBottom();
}

function startStreamingAssistant() {
  emptyState.style.display = 'none';
  currentAccumulatedText = '';
  currentAccumulatedThinking = '';

  const row = document.createElement('div');
  row.className = 'msg-row assistant';

  row.innerHTML = `
    <div class="assistant-head">
      <div class="claude-avatar-mini">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L13.7 8.3L20 7L15.8 12L20 17L13.7 15.7L12 22L10.3 15.7L4 17L8.2 12L4 7L10.3 8.3L12 2Z"/>
        </svg>
      </div>
      <span class="assistant-name">Claude</span>
    </div>
    <div class="msg-bubble">
      <details class="claude-thinking" style="display: none;">
        <summary>Pensando...</summary>
        <div class="thinking-content" style="margin-top:6px;"></div>
      </details>
      <div class="text-body"><em>Pensando...</em></div>
    </div>
  `;

  messagesContainer.appendChild(row);

  currentAssistantElement = row;
  currentThinkingElement = row.querySelector('.claude-thinking');
  currentTextElement = row.querySelector('.text-body');

  scrollToBottom();
}

function appendAssistantMsgStatic(msg) {
  const row = document.createElement('div');
  row.className = 'msg-row assistant';

  let thinkingHtml = '';
  if (msg.thinking) {
    thinkingHtml = `
      <details class="claude-thinking">
        <summary>Pensamiento de Claude</summary>
        <div class="thinking-content" style="margin-top:6px;">${escapeHtml(msg.thinking)}</div>
      </details>
    `;
  }

  const renderedContent = window.marked ? marked.parse(msg.text || '') : escapeHtml(msg.text || '');

  row.innerHTML = `
    <div class="assistant-head">
      <div class="claude-avatar-mini">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L13.7 8.3L20 7L15.8 12L20 17L13.7 15.7L12 22L10.3 15.7L4 17L8.2 12L4 7L10.3 8.3L12 2Z"/>
        </svg>
      </div>
      <span class="assistant-name">Claude</span>
    </div>
    <div class="msg-bubble">
      ${thinkingHtml}
      <div class="text-body">${renderedContent}</div>
    </div>
  `;

  messagesContainer.appendChild(row);
}

function scrollToBottom() {
  chatViewport.scrollTop = chatViewport.scrollHeight;
}

// ==========================================================================
// 5. Envío de Mensajes, Slash Commands y WebSockets
// ==========================================================================
function renderAssistantCard(htmlContent) {
  emptyState.style.display = 'none';
  const row = document.createElement('div');
  row.className = 'msg-row assistant';
  row.innerHTML = `
    <div class="assistant-head">
      <div class="claude-avatar-mini">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L13.7 8.3L20 7L15.8 12L20 17L13.7 15.7L12 22L10.3 15.7L4 17L8.2 12L4 7L10.3 8.3L12 2Z"/>
        </svg>
      </div>
      <span class="assistant-name">Claude</span>
    </div>
    <div class="msg-bubble">
      <div class="text-body">${htmlContent}</div>
    </div>
  `;
  messagesContainer.appendChild(row);
  scrollToBottom();
  return row;
}

function showToast(message) {
  let toast = document.getElementById('claude-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'claude-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 84px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: #252422;
      border: 1px solid rgba(204, 120, 92, 0.4);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      color: #f5f4f0;
      padding: 9px 18px;
      border-radius: 20px;
      font-size: 0.82rem;
      font-weight: 500;
      z-index: 10000;
      opacity: 0;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--claude-terracotta); flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>${escapeHtml(message)}</span>`;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
  }, 3000);
}

// Slash Commands Definition
const SLASH_COMMANDS = [
  {
    name: '/model',
    badge: 'Modelo',
    desc: 'Cambiar o seleccionar modelo de Claude',
    hint: '[alias|id]',
    action: (arg) => handleSlashModel(arg)
  },
  {
    name: '/mode',
    badge: 'Permisos',
    desc: 'Cambiar modo de ejecución (auto, acceptEdits, plan, manual)',
    hint: '[auto|acceptEdits|plan|manual]',
    action: (arg) => handleSlashMode(arg)
  },
  {
    name: '/clear',
    badge: 'Chat',
    desc: 'Reiniciar y limpiar la conversación actual',
    hint: '',
    action: () => newChat()
  },
  {
    name: '/new',
    badge: 'Chat',
    desc: 'Iniciar una nueva conversación',
    hint: '',
    action: () => newChat()
  },
  {
    name: '/key',
    badge: 'Config',
    desc: 'Configurar tu API Key personal de Claude',
    hint: '',
    action: () => openKeyModal()
  },
  {
    name: '/status',
    badge: 'Sistema',
    desc: 'Ver estado del servidor, workspace, modelo y modo',
    hint: '',
    action: () => handleSlashStatus()
  },
  {
    name: '/folder',
    badge: 'Carpeta',
    desc: 'Explorar y cambiar la carpeta de trabajo activa',
    hint: '[ruta]',
    action: (arg) => handleSlashFolder(arg)
  },
  {
    name: '/sync',
    badge: 'Modelos',
    desc: 'Sincronizar modelos disponibles con Anthropic',
    hint: '',
    action: () => handleSlashSync()
  },
  {
    name: '/help',
    badge: 'Ayuda',
    desc: 'Mostrar la lista completa de comandos slash',
    hint: '',
    action: () => handleSlashHelp()
  }
];

function handleSlashModel(arg) {
  if (arg) {
    const lower = arg.toLowerCase();
    const found = availableModelsList.find(m => m.id.toLowerCase() === lower || m.id.toLowerCase().includes(lower) || m.name.toLowerCase().includes(lower)) || availableModelsMap[lower];
    if (found) {
      setModel(found.id, found.name, found.tag);
      renderAssistantCard(`
        <div class="interactive-card">
          <div class="interactive-card-title">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2L13.7 8.3L20 7L15.8 12L20 17L13.7 15.7L12 22L10.3 15.7L4 17L8.2 12L4 7L10.3 8.3L12 2Z"/></svg>
            <span>Modelo activo actualizado</span>
          </div>
          <div style="font-size:0.86rem; margin-top:4px;">
            Ahora estás usando <strong>${escapeHtml(found.name)}</strong> (${escapeHtml(found.tag || 'IA')}).
          </div>
          <div style="font-size:0.78rem; color:var(--text-subtle); margin-top:4px;">
            ${escapeHtml(found.desc || found.id)}
          </div>
        </div>
      `);
      return;
    }
  }

  // Interactive Card
  const cardId = 'model-card-' + Date.now();
  let buttonsHtml = '';
  availableModelsList.forEach(m => {
    const isAct = selectedModel === m.id || (m.id.includes('sonnet') && selectedModel === 'sonnet') || (m.id.includes('haiku') && selectedModel === 'haiku') || (m.id.includes('opus') && selectedModel === 'opus');
    buttonsHtml += `
      <button type="button" class="interactive-btn ${isAct ? 'active' : ''}" data-model-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}" data-tag="${escapeHtml(m.tag || '')}">
        <div style="display:flex; flex-direction:column; gap:2px; text-align:left;">
          <span style="font-weight:600;">${escapeHtml(m.name)}</span>
          <span style="font-size:0.72rem; color:var(--text-subtle);">${escapeHtml(m.desc || m.id)}</span>
        </div>
        <span class="model-badge-tag" style="display:inline-block; font-size:0.68rem; padding:2px 6px;">${escapeHtml(m.tag || 'IA')}</span>
      </button>
    `;
  });

  const cardHtml = `
    <div class="interactive-card" id="${cardId}">
      <div class="interactive-card-title">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2L13.7 8.3L20 7L15.8 12L20 17L13.7 15.7L12 22L10.3 15.7L4 17L8.2 12L4 7L10.3 8.3L12 2Z"/></svg>
        <span>Modelos de Claude Disponibles</span>
      </div>
      <div class="interactive-card-sub">Selecciona el modelo que deseas activar para las próximas respuestas del agente:</div>
      <div class="interactive-grid">
        ${buttonsHtml}
      </div>
      <div class="interactive-actions">
        <button type="button" class="interactive-action-btn card-btn-add">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span>Añadir modelo personalizado...</span>
        </button>
        <button type="button" class="interactive-action-btn card-btn-sync">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
          <span>Sincronizar con Anthropic</span>
        </button>
      </div>
    </div>
  `;

  const row = renderAssistantCard(cardHtml);
  const cardElem = row.querySelector(`#${cardId}`);
  if (cardElem) {
    cardElem.querySelectorAll('.interactive-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-model-id');
        const name = btn.getAttribute('data-name');
        const tag = btn.getAttribute('data-tag');
        setModel(id, name, tag);
        cardElem.querySelectorAll('.interactive-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        showToast(`Modelo cambiado a ${name}`);
      });
    });

    const addBtn = cardElem.querySelector('.card-btn-add');
    if (addBtn) addBtn.addEventListener('click', openCustomModelModal);

    const syncBtn = cardElem.querySelector('.card-btn-sync');
    if (syncBtn) syncBtn.addEventListener('click', handleSyncModels);
  }
}

function handleSlashMode(arg) {
  const modeKeys = Object.keys(EXECUTION_MODES);
  if (arg) {
    const lower = arg.toLowerCase().replace(/[-_]/g, '');
    let matchedKey = null;
    if (lower.includes('auto')) matchedKey = 'auto';
    else if (lower.includes('accept') || lower.includes('edit')) matchedKey = 'acceptEdits';
    else if (lower.includes('plan')) matchedKey = 'plan';
    else if (lower.includes('manual')) matchedKey = 'manual';

    if (matchedKey) {
      const info = EXECUTION_MODES[matchedKey];
      setPermissionMode(matchedKey, info.icon, info.label);
      renderAssistantCard(`
        <div class="interactive-card">
          <div class="interactive-card-title">
            <span class="mode-icon-current">${info.icon}</span>
            <span>Modo de ejecución cambiado a: ${escapeHtml(info.label)}</span>
          </div>
        </div>
      `);
      return;
    }
  }

  // Interactive card
  const cardId = 'mode-card-' + Date.now();
  const currentMode = permissionMode ? permissionMode.value : (localStorage.getItem('claudezer0_mode') || 'acceptEdits');
  let buttonsHtml = '';
  const modeDescriptions = {
    'acceptEdits': 'Recomendado: Claude edita y crea archivos automáticamente.',
    'auto': 'Autónomo total: Claude ejecuta herramientas y comandos sin confirmación.',
    'plan': 'Solo planificación: Claude analiza y diseña soluciones sin modificar código.',
    'manual': 'Control manual: Claude solicita confirmación antes de cada herramienta.'
  };

  modeKeys.forEach(k => {
    const info = EXECUTION_MODES[k];
    const isAct = currentMode === k;
    buttonsHtml += `
      <button type="button" class="interactive-btn ${isAct ? 'active' : ''}" data-mode-key="${k}">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="display:inline-flex; width:16px; height:16px; color:var(--claude-terracotta);">${info.icon}</span>
          <div style="display:flex; flex-direction:column; gap:2px; text-align:left;">
            <span style="font-weight:600;">${escapeHtml(info.label)}</span>
            <span style="font-size:0.72rem; color:var(--text-subtle);">${escapeHtml(modeDescriptions[k] || '')}</span>
          </div>
        </div>
      </button>
    `;
  });

  const cardHtml = `
    <div class="interactive-card" id="${cardId}">
      <div class="interactive-card-title">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
        <span>Modo de Ejecución de Claude Code</span>
      </div>
      <div class="interactive-card-sub">Selecciona el nivel de autonomía y permisos del agente:</div>
      <div class="interactive-grid" style="grid-template-columns: 1fr;">
        ${buttonsHtml}
      </div>
    </div>
  `;

  const row = renderAssistantCard(cardHtml);
  const cardElem = row.querySelector(`#${cardId}`);
  if (cardElem) {
    cardElem.querySelectorAll('.interactive-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.getAttribute('data-mode-key');
        const info = EXECUTION_MODES[k];
        setPermissionMode(k, info.icon, info.label);
        cardElem.querySelectorAll('.interactive-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        showToast(`Modo cambiado a ${info.label}`);
      });
    });
  }
}

function handleSlashStatus() {
  const currentInfo = getModelInfo(selectedModel);
  const curMode = permissionMode ? permissionMode.value : (localStorage.getItem('claudezer0_mode') || 'acceptEdits');
  const modeInfo = EXECUTION_MODES[curMode] || { label: curMode };

  const keyStatusText = clientApiKey
    ? 'Clave personal configurada'
    : (appMode === 'Hoster' ? 'Cuenta compartida del anfitrión' : 'Clave requerida (no configurada)');

  renderAssistantCard(`
    <div class="interactive-card">
      <div class="interactive-card-title">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
        <span>Estado del Sistema ClaudeZer0</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:10px; margin-top:10px; font-size:0.82rem;">
        <div style="background:var(--bg-input); padding:10px; border-radius:8px; border:1px solid var(--border-subtle);">
          <div style="color:var(--text-subtle); font-size:0.72rem; text-transform:uppercase;">Carpeta de trabajo</div>
          <div style="font-weight:600; margin-top:3px; word-break:break-all;">${escapeHtml(currentWorkspace || 'No definida')}</div>
        </div>
        <div style="background:var(--bg-input); padding:10px; border-radius:8px; border:1px solid var(--border-subtle);">
          <div style="color:var(--text-subtle); font-size:0.72rem; text-transform:uppercase;">Modelo Activo</div>
          <div style="font-weight:600; margin-top:3px; color:var(--claude-terracotta);">${escapeHtml(currentInfo.name)} <span class="model-badge-tag">${escapeHtml(currentInfo.tag || 'IA')}</span></div>
        </div>
        <div style="background:var(--bg-input); padding:10px; border-radius:8px; border:1px solid var(--border-subtle);">
          <div style="color:var(--text-subtle); font-size:0.72rem; text-transform:uppercase;">Modo de Permisos</div>
          <div style="font-weight:600; margin-top:3px;">${escapeHtml(modeInfo.label)}</div>
        </div>
        <div style="background:var(--bg-input); padding:10px; border-radius:8px; border:1px solid var(--border-subtle);">
          <div style="color:var(--text-subtle); font-size:0.72rem; text-transform:uppercase;">Modo Servidor & Clave</div>
          <div style="font-weight:600; margin-top:3px;">Modo ${escapeHtml(appMode)} &bull; ${escapeHtml(keyStatusText)}</div>
        </div>
      </div>
    </div>
  `);
}

function handleSlashHelp() {
  let commandsListHtml = '';
  SLASH_COMMANDS.forEach(c => {
    commandsListHtml += `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.06); gap:12px;">
        <div>
          <div style="display:flex; align-items:center; gap:6px;">
            <code style="color:var(--claude-terracotta); font-weight:600; font-size:0.86rem;">${escapeHtml(c.name)}</code>
            ${c.hint ? `<span style="font-size:0.75rem; color:var(--text-subtle);">${escapeHtml(c.hint)}</span>` : ''}
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(c.desc)}</div>
        </div>
        <span class="slash-cmd-badge" style="font-size:0.7rem; padding:3px 8px;">${escapeHtml(c.badge)}</span>
      </div>
    `;
  });

  renderAssistantCard(`
    <div class="interactive-card">
      <div class="interactive-card-title">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        <span>Comandos Slash Disponibles</span>
      </div>
      <div class="interactive-card-sub">Escribe <code>/</code> en el campo de texto para autocompletar rápidamente cualquiera de estos comandos:</div>
      <div style="margin-top:8px;">
        ${commandsListHtml}
      </div>
    </div>
  `);
}

function handleSlashFolder(arg) {
  if (arg) {
    saveSelectedWorkspaceDirect(arg);
  } else {
    openWorkspaceModal();
  }
}

async function saveSelectedWorkspaceDirect(path) {
  try {
    const res = await authFetch('/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (data.success) {
      updateWorkspaceUI(data.workspace);
      renderAssistantCard(`
        <div class="interactive-card">
          <div class="interactive-card-title">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            <span>Carpeta activa actualizada</span>
          </div>
          <div style="font-size:0.86rem; margin-top:4px;">
            Nueva carpeta de trabajo: <code>${escapeHtml(data.workspace)}</code>
          </div>
        </div>
      `);
    } else {
      renderAssistantCard(`<div style="color:var(--danger-red);">Error cambiando carpeta: ${escapeHtml(data.error || 'Ruta inválida')}</div>`);
    }
  } catch (err) {
    renderAssistantCard(`<div style="color:var(--danger-red);">Error cambiando carpeta: ${escapeHtml(err.message)}</div>`);
  }
}

async function handleSlashSync() {
  const row = renderAssistantCard(`
    <div style="display:flex; align-items:center; gap:8px; color:var(--text-muted);">
      <svg class="spin-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
      <span>Consultando catálogo de modelos con Anthropic...</span>
    </div>
  `);

  try {
    const res = await authFetch('/api/models/sync', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await loadModels();
      row.querySelector('.text-body').innerHTML = `
        <div class="interactive-card">
          <div class="interactive-card-title">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Modelos sincronizados con éxito</span>
          </div>
          <div style="font-size:0.84rem; margin-top:4px;">
            Se han sincronizado ${data.models.length} modelos. Disponibles para usar con <code>/model</code> o en el selector superior.
          </div>
        </div>
      `;
    } else {
      row.querySelector('.text-body').innerHTML = `<div style="color:var(--danger-red);">${escapeHtml(data.message || 'Error en sincronización')}</div>`;
    }
  } catch (err) {
    row.querySelector('.text-body').innerHTML = `<div style="color:var(--danger-red);">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function sendPrompt(customPrompt) {
  const prompt = (customPrompt || promptInput.value).trim();
  if (!prompt || isRunning) return;

  hideSlashPopup();

  // Interceptar Slash Commands
  if (prompt.startsWith('/')) {
    const parts = prompt.split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ').trim();

    const cmd = SLASH_COMMANDS.find(c => c.name.toLowerCase() === cmdName);
    if (cmd) {
      promptInput.value = '';
      adjustTextareaHeight();
      appendUserMsg(prompt);
      cmd.action(arg);
      return;
    } else {
      promptInput.value = '';
      adjustTextareaHeight();
      appendUserMsg(prompt);
      renderAssistantCard(`
        <div style="color:var(--text-muted); font-size:0.86rem;">
          Comando desconocido <code>${escapeHtml(cmdName)}</code>. Escribe <code>/help</code> para ver los comandos disponibles.
        </div>
      `);
      return;
    }
  }

  // En Modo Cliente, verificar si hay clave configurada
  if (appMode === 'Client' && (!clientApiKey || !clientApiKey.trim())) {
    openKeyModal();
    if (keyValidationStatus) {
      keyValidationStatus.style.display = 'flex';
      keyValidationStatus.className = 'key-status-box error';
      keyValidationStatus.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> <span>Modo Cliente activo: Ingresa tu propia API Key de Claude antes de enviar mensajes.</span>`;
    }
    return;
  }

  promptInput.value = '';
  adjustTextareaHeight();

  appendUserMsg(prompt);
  startStreamingAssistant();
  setRunning(true);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'run_task',
      prompt,
      workspace: currentWorkspace,
      sessionId: activeSessionId,
      permissionMode: permissionMode ? permissionMode.value : 'acceptEdits',
      model: selectedModel,
      apiKey: clientApiKey || null
    }));
  }
}

function handleWsMessage(data) {
  switch (data.type) {
    case 'assistant_start':
      if (data.sessionId && !activeSessionId) {
        activeSessionId = data.sessionId;
      }
      break;

    case 'stream_delta':
    case 'stream_raw':
      if (currentTextElement) {
        currentAccumulatedText += data.text;
        if (window.marked) {
          currentTextElement.innerHTML = marked.parse(currentAccumulatedText);
        } else {
          currentTextElement.textContent = currentAccumulatedText;
        }
        scrollToBottom();
      }
      break;

    case 'stream_thinking':
      if (currentThinkingElement) {
        currentAccumulatedThinking += data.thinking;
        currentThinkingElement.style.display = 'block';
        currentThinkingElement.querySelector('.thinking-content').textContent = currentAccumulatedThinking;
        scrollToBottom();
      }
      break;

    case 'tool_use':
      if (currentAssistantElement) {
        const bubble = currentAssistantElement.querySelector('.msg-bubble');
        const toolCard = document.createElement('div');
        toolCard.className = 'claude-tool';
        const inputStr = typeof data.input === 'object' ? JSON.stringify(data.input, null, 2) : String(data.input || '');
        toolCard.innerHTML = `
          <div class="claude-tool-name">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:4px;">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>Herramienta: ${escapeHtml(data.tool)}
          </div>
          ${inputStr ? `<pre class="claude-tool-body">${escapeHtml(inputStr.slice(0, 400))}</pre>` : ''}
        `;
        bubble.insertBefore(toolCard, currentTextElement);
        scrollToBottom();
      }
      break;

    case 'task_completed':
      if (data.message && data.message.text && (!currentAccumulatedText || currentAccumulatedText.includes('Pensando...'))) {
        currentAccumulatedText = data.message.text;
        if (window.marked) {
          currentTextElement.innerHTML = marked.parse(currentAccumulatedText);
        } else {
          currentTextElement.textContent = currentAccumulatedText;
        }
      }
      setRunning(false);
      currentAssistantElement = null;
      loadSessions();
      break;

    case 'task_error':
      if (currentTextElement) {
        currentTextElement.innerHTML += `<div style="color:var(--danger-red); margin-top:8px; display:flex; align-items:center; gap:6px;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
          <span>Error: ${escapeHtml(data.message.error || 'Error en ejecución')}</span>
        </div>`;
      }
      setRunning(false);
      currentAssistantElement = null;
      loadSessions();
      break;

    case 'task_canceled':
      if (currentTextElement) {
        currentTextElement.innerHTML += `<div style="color:var(--text-subtle); margin-top:8px; display:flex; align-items:center; gap:6px;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>Tarea cancelada</span>
        </div>`;
      }
      setRunning(false);
      currentAssistantElement = null;
      break;

    case 'workspace_changed':
      updateWorkspaceUI(data.workspace);
      break;
  }
}

function setRunning(running) {
  isRunning = running;
  if (running) {
    if (statusIndicator) statusIndicator.className = 'status-indicator busy';
    if (statusText) statusText.textContent = 'Claude trabajando';
    if (btnModelTrigger) btnModelTrigger.classList.add('working');
    btnSend.style.display = 'none';
    btnStop.style.display = 'flex';
  } else {
    if (statusIndicator) statusIndicator.className = 'status-indicator';
    if (statusText) statusText.textContent = 'Conectado';
    if (btnModelTrigger) btnModelTrigger.classList.remove('working');
    btnSend.style.display = 'flex';
    btnStop.style.display = 'none';
  }
}

function cancelActiveTask() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'cancel_task' }));
  }
}

// Auto-grow textarea
function adjustTextareaHeight() {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + 'px';
}

// ==========================================================================
// 6. Dictado por Voz (Web Speech API)
// ==========================================================================
function setupVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    btnVoice.style.display = 'none';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'es-ES';
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    isListening = true;
    btnVoice.classList.add('listening');
  };

  recognition.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      transcript += e.results[i][0].transcript;
    }
    promptInput.value = transcript;
    adjustTextareaHeight();
  };

  recognition.onerror = () => stopVoice();
  recognition.onend = () => stopVoice();

  btnVoice.addEventListener('click', () => {
    if (isListening) {
      recognition.stop();
    } else {
      try { recognition.start(); } catch (err) {}
    }
  });
}

function stopVoice() {
  isListening = false;
  btnVoice.classList.remove('listening');
}

// ==========================================================================
// 7. Modal de Selección de Carpeta (Workspace)
// ==========================================================================
async function openWorkspaceModal() {
  workspaceModal.style.display = 'flex';
  browsingDirectory = currentWorkspace;
  customDirInput.value = currentWorkspace;
  await loadQuickLocations();
  await loadDirectory(browsingDirectory);
}

function closeWorkspaceModal() {
  workspaceModal.style.display = 'none';
}

async function loadQuickLocations() {
  try {
    const res = await authFetch('/api/quick-locations');
    const data = await res.json();
    quickLocationsList.innerHTML = '';
    if (data.locations) {
      data.locations.forEach(loc => {
        const btn = document.createElement('button');
        btn.className = 'loc-chip';
        btn.textContent = loc.name;
        btn.addEventListener('click', () => loadDirectory(loc.path));
        quickLocationsList.appendChild(btn);
      });
    }
  } catch (e) {}
}

async function loadDirectory(targetPath) {
  foldersList.innerHTML = '<div class="dir-loading">Cargando...</div>';
  try {
    const res = await authFetch(`/api/workspace?dir=${encodeURIComponent(targetPath)}`);
    const data = await res.json();
    if (data.success) {
      browsingDirectory = data.current;
      customDirInput.value = data.current;
      foldersList.innerHTML = '';

      if (data.folders.length === 0) {
        foldersList.innerHTML = '<div style="padding:8px; color:var(--text-subtle); font-size:0.8rem;">Sin subcarpetas</div>';
      }

      data.folders.forEach(f => {
        const row = document.createElement('div');
        row.className = 'folder-row';
        row.innerHTML = `<span class="folder-svg-icon" style="display:flex;align-items:center;color:var(--claude-terracotta);"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></span> <span>${escapeHtml(f.name)}</span>`;
        row.addEventListener('click', () => loadDirectory(f.path));
        foldersList.appendChild(row);
      });

      btnDirUp.disabled = !data.parent;
      btnDirUp.onclick = () => {
        if (data.parent) loadDirectory(data.parent);
      };
    } else {
      foldersList.innerHTML = `<div style="padding:8px; color:var(--danger-red); font-size:0.8rem;">${escapeHtml(data.error)}</div>`;
    }
  } catch (err) {
    foldersList.innerHTML = '<div style="padding:8px; color:var(--danger-red); font-size:0.8rem;">Error al leer carpeta</div>';
  }
}

async function saveSelectedWorkspace() {
  const selected = customDirInput.value.trim() || browsingDirectory;
  try {
    const res = await authFetch('/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: selected })
    });
    const data = await res.json();
    if (data.success) {
      updateWorkspaceUI(data.workspace);
      closeWorkspaceModal();
    }
  } catch (err) {
    alert('Error cambiando carpeta: ' + err.message);
  }
}

async function createNewFolder() {
  const name = newFolderName.value.trim();
  if (!name) return;
  try {
    const res = await authFetch('/api/workspace/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath: browsingDirectory, name })
    });
    const data = await res.json();
    if (data.success) {
      newFolderName.value = '';
      loadDirectory(browsingDirectory);
    }
  } catch (e) {}
}

// ==========================================================================
// 8. Key Configuration Modal (Hoster / Client)
// ==========================================================================
const SVG_EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const SVG_EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

function openKeyModal() {
  if (!keyModal) return;
  keyModal.style.display = 'flex';

  if (clientApiKeyInput) {
    clientApiKeyInput.value = clientApiKey;
    clientApiKeyInput.type = 'password';
  }
  if (btnToggleKeyVis) {
    btnToggleKeyVis.innerHTML = SVG_EYE;
  }
  if (keyValidationStatus) {
    keyValidationStatus.style.display = 'none';
    keyValidationStatus.className = 'key-status-box';
    keyValidationStatus.textContent = '';
  }
  if (btnDeleteKey) {
    btnDeleteKey.style.display = clientApiKey ? 'inline-flex' : 'none';
  }

  if (keyModalModeBadge && keyModalModeStatus && keyModalModeDesc) {
    if (appMode === 'Client') {
      keyModalModeBadge.textContent = 'Modo Cliente';
      keyModalModeBadge.className = 'mode-badge-pill client';
      keyModalModeStatus.textContent = clientApiKey ? 'Clave configurada en este dispositivo' : 'Clave requerida para operar';
      keyModalModeDesc.textContent = 'El anfitrión ha configurado este servidor en Modo Cliente. Tu clave se almacena únicamente en tu navegador/móvil y no se comparte con otros usuarios ni con el anfitrión.';
    } else {
      const isHostLoggedIn = serverAuthInfo && serverAuthInfo.loggedIn;
      keyModalModeBadge.textContent = 'Modo Hoster';
      keyModalModeBadge.className = isHostLoggedIn ? 'mode-badge-pill hoster' : 'mode-badge-pill client';
      if (isHostLoggedIn) {
        const plan = serverAuthInfo.subscriptionType ? serverAuthInfo.subscriptionType.toUpperCase() : 'PRO';
        keyModalModeStatus.textContent = `Cuenta activa (${serverAuthInfo.email || 'Conectada'} - Plan ${plan})`;
        keyModalModeDesc.textContent = `El servidor está en Modo Hoster: el anfitrión comparte su suscripción o cuenta (${serverAuthInfo.email || 'Claude'}). Puedes enviar prompts sin necesidad de ingresar ninguna clave. Si deseas usar tu propia clave para no consumir la cuota del anfitrión, puedes ingresarla aquí.`;
      } else {
        keyModalModeStatus.textContent = '⚠️ Cuenta del anfitrión no vinculada';
        keyModalModeDesc.textContent = 'El anfitrión aún no ha iniciado sesión en Claude Code. Para vincularla: 1) En la consola del servidor ejecuta "pnpm auth:login", o 2) Añade ANTHROPIC_API_KEY en el archivo .env. También puedes ingresar una clave personal aquí abajo.';
      }
    }
  }
}

function closeKeyModal() {
  if (keyModal) keyModal.style.display = 'none';
}

function toggleKeyVisibility() {
  if (!clientApiKeyInput || !btnToggleKeyVis) return;
  if (clientApiKeyInput.type === 'password') {
    clientApiKeyInput.type = 'text';
    btnToggleKeyVis.innerHTML = SVG_EYE_OFF;
  } else {
    clientApiKeyInput.type = 'password';
    btnToggleKeyVis.innerHTML = SVG_EYE;
  }
}

async function handleValidateKey() {
  const inputKey = clientApiKeyInput.value.trim();
  if (!inputKey) {
    keyValidationStatus.style.display = 'flex';
    keyValidationStatus.className = 'key-status-box error';
    keyValidationStatus.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> <span>Por favor escribe una clave antes de comprobar.</span>`;
    return;
  }

  keyValidationStatus.style.display = 'flex';
  keyValidationStatus.className = 'key-status-box checking';
  keyValidationStatus.innerHTML = `<svg class="spin-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg> <span>Comprobando clave con Anthropic...</span>`;

  try {
    const res = await authFetch('/api/auth/validate-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: inputKey })
    });
    const result = await res.json();
    if (result.valid) {
      keyValidationStatus.className = 'key-status-box success';
      keyValidationStatus.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>Clave válida y confirmada por Anthropic.</span>`;
    } else {
      keyValidationStatus.className = 'key-status-box error';
      keyValidationStatus.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> <span>${escapeHtml(result.message || 'Clave no reconocida por Anthropic')}</span>`;
    }
  } catch (err) {
    keyValidationStatus.className = 'key-status-box error';
    keyValidationStatus.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> <span>Error al comunicarse con el servidor.</span>`;
  }
}

function handleSaveKey() {
  const inputKey = clientApiKeyInput.value.trim();
  if (!inputKey && appMode === 'Client') {
    keyValidationStatus.style.display = 'flex';
    keyValidationStatus.className = 'key-status-box error';
    keyValidationStatus.textContent = 'En Modo Cliente es obligatorio ingresar una clave de Claude.';
    return;
  }

  clientApiKey = inputKey;
  if (clientApiKey) {
    localStorage.setItem('claudezer0_client_key', clientApiKey);
  } else {
    localStorage.removeItem('claudezer0_client_key');
  }

  updateModeUI();
  closeKeyModal();
}

function handleDeleteKey() {
  clientApiKey = '';
  localStorage.removeItem('claudezer0_client_key');
  if (clientApiKeyInput) clientApiKeyInput.value = '';
  if (btnDeleteKey) btnDeleteKey.style.display = 'none';
  if (keyValidationStatus) {
    keyValidationStatus.style.display = 'flex';
    keyValidationStatus.className = 'key-status-box error';
    keyValidationStatus.textContent = 'Clave eliminada de este navegador.';
  }
  updateModeUI();
}

// ==========================================================================
// 9. Mobile Sidebar Controls & Event Listeners
// ==========================================================================
function openMobileSidebar() {
  sidebar.classList.add('open');
  sidebarBackdrop.classList.add('active');
}

function closeMobileSidebar() {
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('active');
}

// ==========================================================================
// 9. Slash Commands Popover UI & Autocomplete
// ==========================================================================
function renderSlashPopup(matches) {
  currentSlashMatches = matches;
  if (!matches || matches.length === 0) {
    hideSlashPopup();
    return;
  }

  slashPopupList.innerHTML = '';
  matches.forEach((cmd, idx) => {
    const item = document.createElement('div');
    item.className = 'slash-item' + (idx === highlightedSlashIndex ? ' selected' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', idx === highlightedSlashIndex ? 'true' : 'false');
    item.setAttribute('data-index', idx);

    item.innerHTML = `
      <div class="slash-item-left">
        <span class="slash-cmd-name">${escapeHtml(cmd.name)}</span>
        ${cmd.hint ? `<span class="slash-cmd-hint" style="color:var(--text-subtle);font-size:0.75rem;margin-left:4px;">${escapeHtml(cmd.hint)}</span>` : ''}
        <span class="slash-cmd-desc" style="margin-left:8px;color:var(--text-muted);font-size:0.8rem;">${escapeHtml(cmd.desc)}</span>
      </div>
      <span class="slash-cmd-badge">${escapeHtml(cmd.badge)}</span>
    `;

    item.addEventListener('mouseenter', () => {
      highlightedSlashIndex = idx;
      updateSlashHighlight();
    });

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      executeSlashCommand(cmd);
    });

    slashPopupList.appendChild(item);
  });

  slashPopup.style.display = 'block';
}

function updateSlashHighlight() {
  const items = slashPopupList.querySelectorAll('.slash-item');
  items.forEach((it, idx) => {
    const isSel = idx === highlightedSlashIndex;
    it.classList.toggle('selected', isSel);
    it.setAttribute('aria-selected', isSel ? 'true' : 'false');
    if (isSel) {
      it.scrollIntoView({ block: 'nearest' });
    }
  });
}

function hideSlashPopup() {
  if (slashPopup) slashPopup.style.display = 'none';
  highlightedSlashIndex = -1;
  currentSlashMatches = [];
}

function executeSlashCommand(cmd, customArg) {
  hideSlashPopup();
  promptInput.value = '';
  adjustTextareaHeight();
  appendUserMsg(cmd.name + (customArg ? ' ' + customArg : ''));
  cmd.action(customArg || '');
}

function handlePromptInputSlash() {
  const val = promptInput.value;
  if (!val.startsWith('/')) {
    hideSlashPopup();
    return;
  }

  if (val.includes(' ')) {
    hideSlashPopup();
    return;
  }

  const query = val.slice(1).toLowerCase();
  const matches = SLASH_COMMANDS.filter(cmd => {
    const nameWithoutSlash = cmd.name.slice(1).toLowerCase();
    return nameWithoutSlash.startsWith(query) || cmd.desc.toLowerCase().includes(query) || cmd.badge.toLowerCase().includes(query);
  });

  if (matches.length > 0) {
    highlightedSlashIndex = 0;
    renderSlashPopup(matches);
  } else {
    hideSlashPopup();
  }
}

// ==========================================================================
// 10. Gestión Dinámica de Modelos
// ==========================================================================
function renderModelDropdown() {
  if (!dynamicModelList) return;
  dynamicModelList.innerHTML = '';

  availableModelsList.forEach(m => {
    const isSelected = selectedModel === m.id || (m.id.includes('sonnet') && selectedModel === 'sonnet') || (m.id.includes('haiku') && selectedModel === 'haiku') || (m.id.includes('opus') && selectedModel === 'opus');
    const item = document.createElement('div');
    item.className = `dropdown-item model-option ${isSelected ? 'selected' : ''}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    item.setAttribute('data-model', m.id);
    item.setAttribute('data-name', m.name);
    item.setAttribute('data-tag', m.tag || 'IA');

    item.innerHTML = `
      <div class="model-option-main">
        <span class="model-option-name">${escapeHtml(m.name)}</span>
        <span class="model-option-tag">${escapeHtml(m.tag || 'IA')}</span>
      </div>
      <div class="model-option-sub" style="display:flex; justify-content:space-between; align-items:center;">
        <span>${escapeHtml(m.desc || m.id)}</span>
        ${m.isCustom ? `<button type="button" class="btn-del-model" data-id="${escapeHtml(m.id)}" title="Eliminar modelo" style="background:none;border:none;color:var(--text-subtle);cursor:pointer;padding:2px 4px;margin-left:6px;"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>` : ''}
      </div>
    `;

    item.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.btn-del-model');
      if (delBtn) {
        e.stopPropagation();
        deleteCustomModel(delBtn.getAttribute('data-id'));
        return;
      }
      e.stopPropagation();
      setModel(m.id, m.name, m.tag);
      closeAllDropdowns();
    });

    dynamicModelList.appendChild(item);
  });

  const currentInfo = getModelInfo(selectedModel);
  if (currentModelName) currentModelName.textContent = currentInfo.name;
  if (currentModelTag) currentModelTag.textContent = currentInfo.tag || 'IA';
}

function setModel(modelId, modelName, modelTag) {
  selectedModel = modelId;
  localStorage.setItem('claudezer0_model', modelId);
  const info = getModelInfo(modelId);
  const displayName = modelName || info.name || modelId;
  const displayTag = modelTag || info.tag || 'IA';
  if (currentModelName) currentModelName.textContent = displayName;
  if (currentModelTag) currentModelTag.textContent = displayTag;

  document.querySelectorAll('.model-option').forEach(opt => {
    const isMatch = opt.getAttribute('data-model') === modelId;
    opt.classList.toggle('selected', isMatch);
    opt.setAttribute('aria-selected', isMatch ? 'true' : 'false');
  });
}

function openCustomModelModal() {
  closeAllDropdowns();
  if (!customModelModal) return;
  customModelModal.style.display = 'flex';
  if (customModelIdInput) customModelIdInput.value = '';
  if (customModelNameInput) customModelNameInput.value = '';
  if (customModelTagInput) customModelTagInput.value = '';
  if (customModelDescInput) customModelDescInput.value = '';
  if (customModelStatus) {
    customModelStatus.style.display = 'none';
    customModelStatus.className = 'key-status-box';
    customModelStatus.textContent = '';
  }
}

function closeCustomModelModal() {
  if (customModelModal) customModelModal.style.display = 'none';
}

async function handleSaveCustomModel() {
  const id = customModelIdInput.value.trim();
  const name = customModelNameInput.value.trim() || id;
  const tag = customModelTagInput.value.trim() || 'Custom';
  const desc = customModelDescInput.value.trim() || 'Modelo personalizado';

  if (!id) {
    customModelStatus.style.display = 'flex';
    customModelStatus.className = 'key-status-box error';
    customModelStatus.textContent = 'El ID del modelo es obligatorio (ej. claude-3-7-sonnet-20250219).';
    return;
  }

  try {
    customModelStatus.style.display = 'flex';
    customModelStatus.className = 'key-status-box checking';
    customModelStatus.textContent = 'Guardando modelo...';

    const res = await authFetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, tag, desc })
    });
    const data = await res.json();
    if (data.success) {
      customModelStatus.className = 'key-status-box success';
      customModelStatus.textContent = 'Modelo guardado correctamente.';
      setModel(id, name, tag);
      await loadModels();
      showToast(`Modelo ${name} añadido`);
      setTimeout(closeCustomModelModal, 400);
    } else {
      customModelStatus.className = 'key-status-box error';
      customModelStatus.textContent = data.error || data.message || 'Error guardando modelo.';
    }
  } catch (err) {
    customModelStatus.className = 'key-status-box error';
    customModelStatus.textContent = 'Error de conexión: ' + err.message;
  }
}

async function deleteCustomModel(id) {
  if (!confirm(`¿Deseas eliminar el modelo ${id}?`)) return;
  try {
    const res = await authFetch(`/api/models/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      if (selectedModel === id) {
        selectedModel = 'claude-3-7-sonnet';
        localStorage.setItem('claudezer0_model', selectedModel);
      }
      await loadModels();
      showToast('Modelo eliminado');
    }
  } catch (err) {
    alert('Error eliminando modelo: ' + err.message);
  }
}

async function handleSyncModels() {
  const btn = btnSyncModels;
  if (btn) {
    btn.disabled = true;
    const span = btn.querySelector('span');
    if (span) span.textContent = 'Sincronizando...';
  }
  try {
    const res = await authFetch('/api/models/sync', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await loadModels();
      showToast(`Modelos sincronizados (${data.models.length} disponibles)`);
    } else {
      showToast(data.message || 'Error sincronizando modelos');
    }
  } catch (err) {
    showToast('Error sincronizando con Anthropic: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      const span = btn.querySelector('span');
      if (span) span.textContent = 'Sincronizar con Anthropic';
    }
    closeAllDropdowns();
  }
}

// ==========================================================================
// 11. Listeners y Dropdown Handlers
// ==========================================================================
function setupEventListeners() {
  btnSend.addEventListener('click', () => sendPrompt());
  btnStop.addEventListener('click', cancelActiveTask);

  promptInput.addEventListener('keydown', (e) => {
    if (slashPopup && slashPopup.style.display === 'block') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (currentSlashMatches.length > 0) {
          highlightedSlashIndex = (highlightedSlashIndex + 1) % currentSlashMatches.length;
          updateSlashHighlight();
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (currentSlashMatches.length > 0) {
          highlightedSlashIndex = (highlightedSlashIndex - 1 + currentSlashMatches.length) % currentSlashMatches.length;
          updateSlashHighlight();
        }
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (highlightedSlashIndex >= 0 && highlightedSlashIndex < currentSlashMatches.length) {
          const cmd = currentSlashMatches[highlightedSlashIndex];
          promptInput.value = cmd.name + (cmd.hint ? ' ' : '');
          hideSlashPopup();
          adjustTextareaHeight();
        }
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (highlightedSlashIndex >= 0 && highlightedSlashIndex < currentSlashMatches.length) {
          const cmd = currentSlashMatches[highlightedSlashIndex];
          executeSlashCommand(cmd);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideSlashPopup();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  promptInput.addEventListener('input', () => {
    adjustTextareaHeight();
    handlePromptInputSlash();
  });

  // New Chat
  btnNewChat.addEventListener('click', newChat);

  // Suggested Prompts
  document.querySelectorAll('.starter-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.getAttribute('data-prompt');
      if (prompt) sendPrompt(prompt);
    });
  });

  // Mobile sidebar
  btnHamburger.addEventListener('click', openMobileSidebar);
  sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  // Workspace modal
  btnOpenWorkspace.addEventListener('click', openWorkspaceModal);
  btnChangeWs.addEventListener('click', openWorkspaceModal);
  inputWsPill.addEventListener('click', openWorkspaceModal);
  btnCloseModal.addEventListener('click', closeWorkspaceModal);
  btnCancelWorkspace.addEventListener('click', closeWorkspaceModal);
  btnSelectWorkspace.addEventListener('click', saveSelectedWorkspace);

  btnDirGo.addEventListener('click', () => {
    const target = customDirInput.value.trim();
    if (target) loadDirectory(target);
  });
  btnCreateFolder.addEventListener('click', createNewFolder);

  // Modo & Key modal listeners
  if (btnModeIndicator) btnModeIndicator.addEventListener('click', openKeyModal);
  if (btnSidebarKey) btnSidebarKey.addEventListener('click', openKeyModal);
  if (btnSidebarUserPill) btnSidebarUserPill.addEventListener('click', openKeyModal);
  if (btnCloseKeyModal) btnCloseKeyModal.addEventListener('click', closeKeyModal);
  if (btnCancelKeyModal) btnCancelKeyModal.addEventListener('click', closeKeyModal);
  if (btnSaveKeyModal) btnSaveKeyModal.addEventListener('click', handleSaveKey);
  if (btnDeleteKey) btnDeleteKey.addEventListener('click', handleDeleteKey);
  if (btnTestKey) btnTestKey.addEventListener('click', handleValidateKey);
  if (btnToggleKeyVis) btnToggleKeyVis.addEventListener('click', toggleKeyVisibility);

  // Custom Model Modal listeners
  if (btnOpenAddModel) btnOpenAddModel.addEventListener('click', openCustomModelModal);
  if (btnSyncModels) btnSyncModels.addEventListener('click', handleSyncModels);
  if (btnCloseCustomModelModal) btnCloseCustomModelModal.addEventListener('click', closeCustomModelModal);
  if (btnCancelCustomModelModal) btnCancelCustomModelModal.addEventListener('click', closeCustomModelModal);
  if (btnSaveCustomModel) btnSaveCustomModel.addEventListener('click', handleSaveCustomModel);

  // Custom Dropdowns (Model & Execution Mode)
  setupDropdowns();
}

function initModelAndMode() {
  const rawModel = localStorage.getItem('claudezer0_model') || 'claude-3-7-sonnet';
  const modelInfo = getModelInfo(rawModel);
  setModel(modelInfo.id, modelInfo.name, modelInfo.tag);
  renderModelDropdown();

  const savedMode = localStorage.getItem('claudezer0_mode') || 'acceptEdits';
  const modeInfo = EXECUTION_MODES[savedMode] || EXECUTION_MODES['acceptEdits'];
  setPermissionMode(savedMode, modeInfo.icon, modeInfo.label);
}

function setPermissionMode(modeValue, modeIcon, modeLabel) {
  localStorage.setItem('claudezer0_mode', modeValue);
  if (permissionMode) permissionMode.value = modeValue;
  const info = EXECUTION_MODES[modeValue] || { icon: modeIcon || '', label: modeLabel || modeValue };
  if (currentModeIcon) currentModeIcon.innerHTML = info.icon;
  if (currentModeLabel) currentModeLabel.textContent = info.label;

  document.querySelectorAll('.mode-option').forEach(opt => {
    const isMatch = opt.getAttribute('data-value') === modeValue;
    opt.classList.toggle('selected', isMatch);
    opt.setAttribute('aria-selected', isMatch ? 'true' : 'false');
  });
}

function closeAllDropdowns() {
  if (dropdownModel) dropdownModel.classList.remove('open');
  if (dropdownMode) dropdownMode.classList.remove('open');
  if (btnModelTrigger) btnModelTrigger.setAttribute('aria-expanded', 'false');
  if (btnModeTrigger) btnModeTrigger.setAttribute('aria-expanded', 'false');
}

function setupDropdowns() {
  if (btnModelTrigger) {
    btnModelTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !dropdownModel.classList.contains('open');
      closeAllDropdowns();
      if (willOpen) {
        dropdownModel.classList.add('open');
        btnModelTrigger.setAttribute('aria-expanded', 'true');
      }
    });
  }

  if (btnModeTrigger) {
    btnModeTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !dropdownMode.classList.contains('open');
      closeAllDropdowns();
      if (willOpen) {
        dropdownMode.classList.add('open');
        btnModeTrigger.setAttribute('aria-expanded', 'true');
      }
    });
  }

  document.querySelectorAll('.mode-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = opt.getAttribute('data-value');
      const label = opt.getAttribute('data-label');
      setPermissionMode(val, null, label);
      closeAllDropdowns();
    });
  });

  document.addEventListener('click', (e) => {
    closeAllDropdowns();
    if (!e.target.closest('#slash-popup') && !e.target.closest('#prompt-input')) {
      hideSlashPopup();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllDropdowns();
      hideSlashPopup();
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Boot check
window.addEventListener('DOMContentLoaded', checkAuth);
