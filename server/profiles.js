import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './paths.js';

// Perfiles por usuario: saludo de bienvenida e instrucciones extra para el asistente.
// Viven en data/profiles.json (fuera de git), así cada instalación personaliza a sus usuarios
// sin tocar el código. Formato: { "usuario": { "greeting": "...", "systemPrompt": "..." } }
const profilesPath = path.join(DATA_DIR, 'profiles.json');

function getProfile(username) {
  try {
    if (!fs.existsSync(profilesPath)) return null;
    const profile = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'))?.[username];
    return profile && typeof profile === 'object' ? profile : null;
  } catch (err) {
    console.warn('Error leyendo profiles.json:', err.message);
    return null;
  }
}

// Lo que necesita la web (el prompt del sistema nunca sale del servidor)
export function getPublicProfile(username) {
  const greeting = getProfile(username)?.greeting;
  return typeof greeting === 'string' && greeting.trim() ? { greeting: greeting.trim() } : null;
}

export function getProfilePrompt(username) {
  const prompt = getProfile(username)?.systemPrompt;
  return typeof prompt === 'string' ? prompt.trim() : '';
}

export function getProfileIdentity(username) {
  const profile = getProfile(username);
  return profile ? { email: profile.email, displayName: profile.displayName } : null;
}

export function setProfileDisplayName(username, displayName) {
  if (typeof displayName !== 'string') throw new TypeError('El nombre visible debe ser texto.');
  const name = displayName.trim();
  if (name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw new RangeError('Usa un nombre de hasta 40 caracteres sin caracteres de control.');
  const profiles = fs.existsSync(profilesPath) ? JSON.parse(fs.readFileSync(profilesPath, 'utf8')) : {};
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) throw new Error('El archivo de perfiles no es válido.');
  const previous = Object.hasOwn(profiles, username) ? profiles[username] : {};
  const profile = { ...previous, displayName: name };
  const updated = { ...profiles, [username]: profile };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryPath = `${profilesPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(updated, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryPath, profilesPath);
  return { email: profile.email, displayName: profile.displayName };
}
