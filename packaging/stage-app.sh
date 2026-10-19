#!/usr/bin/env bash
# Prepara la aplicación lista para empaquetar en <destino>:
#   <destino>/app      -> servidor, web y dependencias de producción (sin enlaces simbólicos)
#   <destino>/runtime  -> el ejecutable de Node con el que se ha instalado (mismo sistema y arquitectura)
# Se ejecuta en el mismo sistema para el que se empaqueta: Claude Code trae un binario nativo por plataforma.
# Uso: bash packaging/stage-app.sh <destino>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:?Uso: stage-app.sh <destino>}"

rm -rf "$DEST"
mkdir -p "$DEST/app" "$DEST/runtime"
cd "$ROOT"
cp -R server public package.json pnpm-lock.yaml pnpm-workspace.yaml .env.example LICENSE "$DEST/app/"

# node-linker=hoisted: node_modules plano, sin enlaces de pnpm (Inno Setup y algunos zip no los soportan)
(cd "$DEST/app" && pnpm install --prod --frozen-lockfile --config.node-linker=hoisted)

# Claude Code copia su binario nativo (~280 MB) del paquete de plataforma a bin/ al instalarse:
# el paquete de plataforma sobra y duplicaría el tamaño del instalador
CLAUDE_BIN="$DEST/app/node_modules/@anthropic-ai/claude-code/bin/claude.exe"
if [ "$(wc -c < "$CLAUDE_BIN")" -gt 1000000 ]; then
  rm -rf "$DEST/app/node_modules/@anthropic-ai/"claude-code-*
else
  echo "Claude Code no ha instalado su binario nativo (¿se ha saltado su postinstall?)" >&2
  exit 1
fi

NODE_BIN="$(node -p 'process.execPath')"
cp "$NODE_BIN" "$DEST/runtime/"
echo "App preparada en $DEST (Node $(node -v), $(node -p 'process.platform + "-" + process.arch'))"
