import path from 'path';

// Reglas de acceso por usuario: el admin no tiene restricciones; el resto solo puede
// trabajar dentro de sus carpetas permitidas y con los modos de ejecución concedidos.

const isWin = process.platform === 'win32';

function normalize(p) {
  const resolved = path.resolve(String(p || ''));
  return isWin ? resolved.toLowerCase() : resolved;
}

function isInside(child, root) {
  const rel = path.relative(normalize(root), normalize(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function isRestricted(user) {
  return !!user && user.role !== 'admin';
}

export function isPathAllowed(user, target) {
  if (!isRestricted(user)) return true;
  if (!target) return false;
  return (user.roots || []).some(root => isInside(target, root));
}

export function isModeAllowed(user, mode) {
  return (user?.allowedModes || []).includes(mode);
}

/**
 * Motivo para denegar una herramienta sin preguntar (o null): rutas de archivo fuera de las carpetas permitidas
 */
export function toolPathViolation(user, tool, input, cwd) {
  if (!isRestricted(user)) return null;
  const candidates = [input?.file_path, input?.notebook_path, input?.path].filter(v => typeof v === 'string' && v);
  for (const p of candidates) {
    const abs = path.isAbsolute(p) ? p : path.resolve(cwd || '.', p);
    if (!isPathAllowed(user, abs)) {
      return `${tool} intenta acceder a ${abs}, que está fuera de las carpetas permitidas para tu usuario.`;
    }
  }
  return null;
}
