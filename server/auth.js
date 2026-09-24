import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '..', 'data');
const credentialsPath = path.join(dataDir, 'auth.json');
const sessionsPath = path.join(dataDir, 'auth-sessions.json');

const DEFAULT_USER = 'admin';
const DEFAULT_PASSWORD = 'claudezer0';
const MIN_PASSWORD_LENGTH = 8;

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // caducan tras 30 días sin uso
const SESSION_TOUCH_MS = 60 * 60 * 1000; // guardar el último uso como mucho una vez por hora

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// --------------------------------------------------------------------------
// Utilidades
// --------------------------------------------------------------------------
function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.warn(`Error leyendo ${path.basename(file)}:`, err.message);
  }
  return fallback;
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    console.error(`Error guardando ${path.basename(file)}:`, err.message);
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  const candidate = Buffer.from(hashPassword(password, stored.salt).hash, 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// Comparación en tiempo constante de dos textos de cualquier longitud
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// --------------------------------------------------------------------------
// Credenciales: el .env solo siembra la contraseña inicial; después se guarda cifrada.
// Si cambias CLAUDEZER0_PASSWORD en el .env, esa pasa a ser la contraseña (sirve para recuperarla).
// --------------------------------------------------------------------------
let credentials = loadCredentials();

function envPassword() {
  return process.env.CLAUDEZER0_PASSWORD || DEFAULT_PASSWORD;
}

function loadCredentials() {
  const stored = readJson(credentialsPath, null);
  const envPass = envPassword();
  if (stored?.password && stored?.seed && verifyPassword(envPass, stored.seed)) {
    return stored;
  }
  // Primera ejecución o la contraseña del .env ha cambiado: sembrar desde el .env
  const seeded = {
    username: process.env.CLAUDEZER0_USER || DEFAULT_USER,
    password: hashPassword(envPass),
    seed: hashPassword(envPass),
    mustChangePassword: envPass === DEFAULT_PASSWORD || envPass.length < MIN_PASSWORD_LENGTH,
    updatedAt: Date.now()
  };
  writeJson(credentialsPath, seeded);
  return seeded;
}

export function getUsername() {
  return credentials.username;
}

export function isUsingDefaultPassword() {
  return !!credentials.mustChangePassword;
}

// --------------------------------------------------------------------------
// Sesiones persistentes (se guarda el hash del token, nunca el token)
// --------------------------------------------------------------------------
let sessions = readJson(sessionsPath, {});
pruneSessions();

function pruneSessions() {
  const now = Date.now();
  let changed = false;
  for (const [key, s] of Object.entries(sessions)) {
    if (!s || now - (s.lastUsed || 0) > SESSION_TTL_MS) {
      delete sessions[key];
      changed = true;
    }
  }
  if (changed) writeJson(sessionsPath, sessions);
}

function createSessionToken(req) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[hashToken(token)] = {
    createdAt: Date.now(),
    lastUsed: Date.now(),
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 200)
  };
  writeJson(sessionsPath, sessions);
  return token;
}

function getSessionFor(token) {
  if (!token) return null;
  const key = hashToken(token);
  const s = sessions[key];
  if (!s) return null;
  const now = Date.now();
  if (now - s.lastUsed > SESSION_TTL_MS) {
    delete sessions[key];
    writeJson(sessionsPath, sessions);
    return null;
  }
  if (now - s.lastUsed > SESSION_TOUCH_MS) {
    s.lastUsed = now;
    writeJson(sessionsPath, sessions);
  }
  return s;
}

// --------------------------------------------------------------------------
// Límite de intentos por IP
// --------------------------------------------------------------------------
const failedLogins = new Map();

function lockoutFor(ip) {
  const entry = failedLogins.get(ip);
  if (entry?.lockedUntil && Date.now() < entry.lockedUntil) return entry.lockedUntil;
  if (entry?.lockedUntil) failedLogins.delete(ip);
  return null;
}

function registerFailure(ip) {
  const entry = failedLogins.get(ip) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= MAX_FAILED_LOGINS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
    console.warn(`[seguridad] Demasiados intentos fallidos desde ${ip}: bloqueada 15 min`);
  }
  failedLogins.set(ip, entry);
  return entry;
}

// --------------------------------------------------------------------------
// API
// --------------------------------------------------------------------------
export function login(username, password, req) {
  const ip = req?.ip || 'desconocida';
  const lockedUntil = lockoutFor(ip);
  if (lockedUntil) {
    const minutes = Math.ceil((lockedUntil - Date.now()) / 60000);
    return { success: false, locked: true, message: `Demasiados intentos fallidos. Vuelve a probar en ${minutes} min.` };
  }

  const userOk = safeEqual(username ?? '', credentials.username);
  const passOk = verifyPassword(password ?? '', credentials.password);
  if (userOk && passOk) {
    failedLogins.delete(ip);
    const token = createSessionToken(req);
    return { success: true, token, username: credentials.username, mustChangePassword: isUsingDefaultPassword() };
  }

  const entry = registerFailure(ip);
  const left = MAX_FAILED_LOGINS - entry.count;
  return {
    success: false,
    message: entry.lockedUntil
      ? 'Demasiados intentos fallidos. Vuelve a probar en 15 min.'
      : `Usuario o contraseña incorrectos${left <= 2 ? ` (te quedan ${left} intentos)` : ''}`
  };
}

export function changePassword(currentToken, currentPassword, newPassword) {
  if (!verifyPassword(currentPassword ?? '', credentials.password)) {
    return { success: false, message: 'La contraseña actual no es correcta' };
  }
  const next = String(newPassword ?? '');
  if (next.length < MIN_PASSWORD_LENGTH) {
    return { success: false, message: `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres` };
  }
  if (next === DEFAULT_PASSWORD || verifyPassword(next, credentials.password)) {
    return { success: false, message: 'Elige una contraseña distinta de la actual' };
  }

  credentials = { ...credentials, password: hashPassword(next), mustChangePassword: false, updatedAt: Date.now() };
  writeJson(credentialsPath, credentials);

  // Cerrar el resto de sesiones: quien tuviera la contraseña antigua deja de tener acceso
  logoutAll(currentToken);
  return { success: true };
}

export function validateToken(token) {
  return !!getSessionFor(token);
}

export function logout(token) {
  if (token) {
    delete sessions[hashToken(token)];
    writeJson(sessionsPath, sessions);
  }
  return { success: true };
}

/**
 * Cerrar todas las sesiones abiertas (menos `exceptToken`, si se indica)
 */
export function logoutAll(exceptToken = null) {
  const keep = exceptToken ? hashToken(exceptToken) : null;
  sessions = keep && sessions[keep] ? { [keep]: sessions[keep] } : {};
  writeJson(sessionsPath, sessions);
  return { success: true };
}

function tokenFromRequest(req) {
  const authHeader = req.headers['authorization'];
  return authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

/**
 * Exige sesión válida. Mientras siga la contraseña por defecto solo se permite cambiarla.
 */
export function requireAuth(req, res, next) {
  const token = tokenFromRequest(req);
  if (!validateToken(token)) {
    return res.status(401).json({ success: false, error: 'Acceso no autorizado. Inicia sesión.' });
  }
  req.userToken = token;
  if (isUsingDefaultPassword() && !req.allowWithDefaultPassword) {
    return res.status(403).json({ success: false, mustChangePassword: true, error: 'Cambia la contraseña por defecto para continuar.' });
  }
  return next();
}

// Variante para las rutas que deben funcionar aunque haya que cambiar la contraseña
export function requireAuthAllowDefault(req, res, next) {
  req.allowWithDefaultPassword = true;
  return requireAuth(req, res, next);
}

export { tokenFromRequest };
