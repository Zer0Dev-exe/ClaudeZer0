#!/bin/bash
# Arranca el servidor de Zer0Code.app en segundo plano y escribe su PID (lo usa el applet para
# detenerlo al salir). Si ya está en marcha, solo abre el navegador. Datos en ~/Library/Application Support.
RES="$(cd "$(dirname "$0")" && pwd)"
SUP="$HOME/Library/Application Support/Zer0Code"
mkdir -p "$SUP"
[ -f "$SUP/.env" ] || cp "$RES/app/.env.example" "$SUP/.env"

PORT="$(grep -E '^PORT=' "$SUP/.env" | cut -d= -f2 | tr -d '[:space:]')"
PORT="${PORT:-5050}"
if curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/manifest.json"; then
  open "http://localhost:$PORT"
  exit 0
fi

export ZER0CODE_DATA_DIR="$SUP/data" ZER0CODE_ENV_FILE="$SUP/.env" ZER0CODE_OPEN_BROWSER=1
nohup "$RES/runtime/node" "$RES/app/server/index.js" >> "$SUP/zer0code.log" 2>&1 < /dev/null &
echo $!
