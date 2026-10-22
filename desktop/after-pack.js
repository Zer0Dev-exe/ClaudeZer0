// Copia el servidor preparado (dist/stage/app, con sus node_modules y los CLIs de Claude, Codex y Gemini)
// dentro de la app como resources/app-server. No se usa `extraResources` porque electron-builder descarta
// siempre node_modules/.bin y los CLIs se buscan ahí. Se ejecuta antes de firmar (macOS).
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  const source = path.resolve(__dirname, '..', 'dist', 'stage', 'app');
  if (!fs.existsSync(path.join(source, 'server', 'index.js'))) {
    throw new Error(`Falta ${source}: ejecuta antes «bash packaging/stage-app.sh dist/stage --no-runtime»`);
  }
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const target = path.join(resources, 'app-server');
  fs.rmSync(target, { recursive: true, force: true });
  // verbatimSymlinks: los enlaces de node_modules/.bin siguen siendo relativos
  fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true });
};
