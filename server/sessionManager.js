import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let sessions = {};

try {
  if (fs.existsSync(SESSIONS_FILE)) {
    sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
  }
} catch (e) {
  console.warn('Error reading sessions:', e.message);
  sessions = {};
}

function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch (e) {
    console.error('Error saving sessions:', e.message);
  }
}

export function getAllSessions() {
  return Object.values(sessions)
    .map(s => ({
      id: s.id,
      title: s.title || 'Nueva conversación',
      workspace: s.workspace,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages ? s.messages.length : 0
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id) {
  return sessions[id] || null;
}

export function createSession(title = 'Nueva conversación', workspace = '') {
  const id = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const now = Date.now();
  const newSession = {
    id,
    title,
    workspace,
    claudeSessionId: null,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  sessions[id] = newSession;
  saveSessions();
  return newSession;
}

export function updateSessionTitle(id, title) {
  if (sessions[id]) {
    sessions[id].title = title;
    sessions[id].updatedAt = Date.now();
    saveSessions();
    return sessions[id];
  }
  return null;
}

export function setClaudeSessionId(id, claudeSessionId) {
  if (sessions[id]) {
    sessions[id].claudeSessionId = claudeSessionId;
    sessions[id].updatedAt = Date.now();
    saveSessions();
  }
}

export function addMessageToSession(id, message) {
  if (!sessions[id]) {
    createSession('Nueva conversación');
  }
  const s = sessions[id];
  s.messages.push(message);
  s.updatedAt = Date.now();

  // Auto-generate title from first user message if still default
  if (s.title === 'Nueva conversación' && message.role === 'user' && message.text) {
    const clean = message.text.trim().replace(/[\r\n]+/g, ' ');
    s.title = clean.length > 36 ? clean.slice(0, 36) + '...' : clean;
  }

  saveSessions();
  return s;
}

export function deleteSession(id) {
  if (sessions[id]) {
    delete sessions[id];
    saveSessions();
    return true;
  }
  return false;
}
