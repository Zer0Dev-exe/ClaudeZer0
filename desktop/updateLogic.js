// Lógica pura de las actualizaciones (sin Electron): comparar versiones y elegir el instalador de cada sistema.

/** '1.3.10' -> [1, 3, 10]; null si no es una versión */
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** >0 si a es más nueva que b (0 si alguna no es una versión válida) */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * El instalador de la app de escritorio para este sistema entre los archivos de un release (o null).
 * Linux: el AppImage se reemplaza solo; si se instaló con el .deb se baja el .deb.
 */
function pickAsset(assets, { platform = process.platform, arch = process.arch, appImage = !!process.env.APPIMAGE } = {}) {
  const wantArch = arch === 'arm64' ? /(arm64|aarch64)/i : /(x86_64|amd64|x64)/i;
  const desktop = assets.filter(a => /^Zer0Code-Desktop-/.test(a.name));
  const named = (re, ext) => desktop.find(a => re.test(a.name) && a.name.toLowerCase().endsWith(ext));
  if (platform === 'win32') return named(/-win-/i, '.exe') || null;
  if (platform === 'darwin') return named(/-mac-/i, '.dmg') || null;
  if (platform !== 'linux') return null;
  const ext = appImage ? '.appimage' : '.deb';
  return desktop.find(a => /-linux-/i.test(a.name) && wantArch.test(a.name) && a.name.toLowerCase().endsWith(ext)) || null;
}

module.exports = { parseVersion, compareVersions, pickAsset };
