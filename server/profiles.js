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
