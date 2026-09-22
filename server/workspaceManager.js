import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_FILE = path.join(os.homedir(), '.claudezer0_config.json');

// Default initial workspace
let currentWorkspace = path.join(os.homedir(), 'Documents');
if (!fs.existsSync(currentWorkspace)) {
  currentWorkspace = os.homedir();
}

// Load persisted workspace if available
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    if (data.currentWorkspace && fs.existsSync(data.currentWorkspace)) {
      currentWorkspace = data.currentWorkspace;
    }
  }
} catch (e) {
  console.warn('Could not read config file:', e.message);
}

export function getCurrentWorkspace() {
  return currentWorkspace;
}

export function setWorkspace(newPath) {
  const resolved = path.resolve(newPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`La ruta no existe: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`La ruta no es un directorio: ${resolved}`);
  }
  currentWorkspace = resolved;
  
  // Persist
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ currentWorkspace }, null, 2));
  } catch (e) {
    console.error('Error saving config:', e.message);
  }

  return currentWorkspace;
}

export function listDirectory(dirPath) {
  const targetPath = dirPath ? path.resolve(dirPath) : currentWorkspace;
  if (!fs.existsSync(targetPath)) {
    throw new Error(`El directorio no existe: ${targetPath}`);
  }

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

  return {
    current: targetPath,
    parent: path.dirname(targetPath) !== targetPath ? path.dirname(targetPath) : null,
    folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
    files: files.slice(0, 50).sort((a, b) => a.name.localeCompare(b.name))
  };
}

export function createDirectory(parentPath, folderName) {
  const safeName = folderName.replace(/[<>:"/\\|?*]/g, '_').trim();
  if (!safeName) throw new Error('Nombre de carpeta inválido');
  const target = path.join(parentPath, safeName);
  if (fs.existsSync(target)) {
    throw new Error('La carpeta ya existe');
  }
  fs.mkdirSync(target, { recursive: true });
  return target;
}

export function getQuickLocations() {
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
