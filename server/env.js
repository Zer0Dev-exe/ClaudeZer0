// Se importa antes que nada en index.js: el resto de módulos leen process.env al cargarse
import dotenv from 'dotenv';
import { ENV_FILE } from './paths.js';

dotenv.config({ path: ENV_FILE, quiet: true });
