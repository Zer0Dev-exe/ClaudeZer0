import fs from 'fs';
import path from 'path';
import os from 'os';
import { isRestricted, isPathAllowed } from './accessPolicy.js';

const CONFIG_FILE = path.join(os.homedir(), '.claudezer0_config.json');

// Default initial workspace
let defaultWorkspace = path.join(os.homedir(), 'Documents');
if (!fs.existsSync(defaultWorkspace)) {
  defaultWorkspace = os.homedir();
}

// Carpeta activa del admin (`currentWorkspace`, compatible con versiones anteriores) y de cada usuario
let config = { currentWorkspace: defaultWorkspace, users: {} };

// Load persisted workspace if available
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    if (data.currentWorkspace && fs.existsSync(data.currentWorkspace)) {
      config.currentWorkspace = data.currentWorkspace;
    }
    if (data.users && typeof data.users === 'object') config.users = data.users;
  }
} catch (e) {
  console.warn('Could not read config file:', e.message);
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Error saving config:', e.message);
  }
}

function assertAllowed(user, target) {
  if (!isPathAllowed(user, target)) {
    throw new Error('No tienes acceso a esa carpeta');
  }
}

export function getCurrentWorkspace(user) {
  if (!isRestricted(user)) return config.currentWorkspace;
  const saved = config.users[user.username];
  if (saved && fs.existsSync(saved) && isPathAllowed(user, saved)) return saved;
  // Sin carpeta guardada (o ya no permitida): la primera carpeta permitida
  return user.roots.find(r => fs.existsSync(r)) || user.roots[0] || null;
}

export function setWorkspace(user, newPath) {
  const resolved = path.resolve(newPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`La ruta no existe: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`La ruta no es un directorio: ${resolved}`);
  }
  assertAllowed(user, resolved);

  if (isRestricted(user)) config.users[user.username] = resolved;
  else config.currentWorkspace = resolved;
  saveConfig();

  return resolved;
}

export function forgetUserWorkspace(username) {
  if (config.users[username]) {
    delete config.users[username];
    saveConfig();
  }
}

export function listDirectory(user, dirPath) {
  const targetPath = dirPath ? path.resolve(dirPath) : getCurrentWorkspace(user);
  if (!targetPath || !fs.existsSync(targetPath)) {
    throw new Error(`El directorio no existe: ${targetPath}`);
  }
  assertAllowed(user, targetPath);

  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  const folders = [];
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.git') continue;
    if (entry.name === 'node_modules') continue;

    try {
      if (entry.isDirectory()) {
        folders.push({
          name: entry.name,
          path: path.join(targetPath, entry.name),
          type: 'directory'
        });
      } else {
        files.push({
          name: entry.name,
          path: path.join(targetPath, entry.name),
          type: 'file'
        });
      }
    } catch (e) {
      // Ignore permission denied or inaccessible paths
    }
  }

  const parent = path.dirname(targetPath) !== targetPath ? path.dirname(targetPath) : null;
  return {
    current: targetPath,
    parent: parent && isPathAllowed(user, parent) ? parent : null,
    folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
    files: files.slice(0, 50).sort((a, b) => a.name.localeCompare(b.name))
  };
}

export function createDirectory(user, parentPath, folderName) {
  const safeName = folderName.replace(/[<>:"/\\|?*]/g, '_').trim();
  if (!safeName) throw new Error('Nombre de carpeta inválido');
  assertAllowed(user, parentPath);
  const target = path.join(parentPath, safeName);
  if (fs.existsSync(target)) {
    throw new Error('La carpeta ya existe');
  }
  fs.mkdirSync(target, { recursive: true });
  return target;
}

export function getQuickLocations(user) {
  // Los usuarios con restricciones solo ven sus carpetas permitidas
  if (isRestricted(user)) {
    return user.roots
      .filter(r => fs.existsSync(r))
      .map(r => ({ name: path.basename(r) || r, path: r }));
  }

  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const list = [
    { name: 'Documents', path: path.join(home, 'Documents') },
    { name: 'Desktop', path: path.join(home, 'Desktop') },
    { name: 'Home', path: home }
  ];

  // Rutas raíz según el sistema operativo
  if (isWin) {
    list.push({ name: 'C:\\', path: 'C:\\' });
  } else {
    list.push({ name: 'Raíz (/)', path: '/' });
    const wwwFolder = '/var/www';
    if (fs.existsSync(wwwFolder)) list.push({ name: 'www', path: wwwFolder });
  }

  // Carpetas comunes de desarrollo si existen
  const codeFolder = path.join(home, 'Code');
  const projectsFolder = path.join(home, 'Projects');
  const devFolder = path.join(home, 'Documents', 'J.A.R.V.I.S');

  if (fs.existsSync(codeFolder)) list.push({ name: 'Code', path: codeFolder });
  if (fs.existsSync(projectsFolder)) list.push({ name: 'Projects', path: projectsFolder });
  if (fs.existsSync(devFolder)) list.push({ name: 'J.A.R.V.I.S', path: devFolder });

  return list.filter(item => fs.existsSync(item.path));
}
