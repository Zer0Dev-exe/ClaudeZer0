import path from 'path';
import { fileURLToPath } from 'url';

// Rutas de la aplicación. Instalada (exe, deb, dmg), el programa va en una carpeta y los datos
// del usuario en otra, para que las actualizaciones no los toquen:
//   CLAUDEZER0_DATA_DIR -> conversaciones, usuarios, claves (por defecto <proyecto>/data)
//   CLAUDEZER0_ENV_FILE -> archivo .env (por defecto <proyecto>/.env)
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.CLAUDEZER0_DATA_DIR || path.join(projectRoot, 'data'));
export const ENV_FILE = path.resolve(process.env.CLAUDEZER0_ENV_FILE || path.join(projectRoot, '.env'));
