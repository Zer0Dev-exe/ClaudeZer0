// Cliente del servidor de Zer0Code: mismo origen que sirve esta página (la app de escritorio carga /desktop/ del servidor).

const TOKEN_KEY = 'zer0code_token';
const USER_KEY = 'zer0code_user';

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  set(token, username) {
    localStorage.setItem(TOKEN_KEY, token);
    if (username) localStorage.setItem(USER_KEY, username);
  },
  clear() { localStorage.removeItem(TOKEN_KEY); }
};

export class AuthError extends Error {}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) throw new AuthError('Sesión caducada');
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.mustChangePassword) throw new AuthError('mustChangePassword');
  return data;
}

/** WebSocket con reconexión. Emite cada mensaje del servidor a `onMessage`. */
export function connectSocket({ onMessage, onState }) {
  let ws = null;
  let closedByUs = false;
  let retry = null;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);
    onState?.('connecting');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: auth.token, visible: document.visibilityState === 'visible' }));
    ws.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      if (data.type === 'auth_success') onState?.('open');
      if (data.type === 'auth_error') onState?.('unauthorized');
      onMessage(data);
    };
    ws.onclose = (e) => {
      onState?.('closed');
      if (e.code === 4001) { onState?.('unauthorized'); return; }
      if (!closedByUs) retry = setTimeout(open, 2500);
    };
  };
  open();

  document.addEventListener('visibilitychange', () => {
    const visible = document.visibilityState === 'visible';
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'visibility', visible }));
    if (visible && ws && ws.readyState >= WebSocket.CLOSING && !closedByUs) { clearTimeout(retry); open(); }
  });

  return {
    send(data) { if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(data)); return true; } return false; },
    get ready() { return ws?.readyState === WebSocket.OPEN; },
    close() { closedByUs = true; clearTimeout(retry); ws?.close(); }
  };
}
