#!/usr/bin/env bash
# Instala Zer0Code como servicio de systemd en un servidor Linux (VPS, Raspberry, PC por SSH).
# El servidor arranca solo al encender la máquina y sigue funcionando aunque cierres la sesión SSH.
#
# Uso (desde la carpeta del proyecto, con tu usuario normal, no root):
#   bash deploy/install-linux.sh             # instala o actualiza el servicio
#   bash deploy/install-linux.sh --tailscale # además publica la web por HTTPS en tu red Tailscale
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE=zer0code
RUN_USER="$(id -un)"
USE_TAILSCALE=0
[[ "${1:-}" == "--tailscale" ]] && USE_TAILSCALE=1

say() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] && fail "Ejecútalo con tu usuario normal (se pedirá sudo cuando haga falta). Claude Code guarda la sesión en tu HOME."
command -v systemctl >/dev/null || fail "Este sistema no usa systemd."

# --- Node.js y pnpm -----------------------------------------------------------
NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || fail "No se encuentra Node.js. Instala la versión 18 o superior (https://nodejs.org)."
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 18 )) || fail "Node.js $NODE_MAJOR es demasiado antiguo: hace falta la 18 o superior."

if ! command -v pnpm >/dev/null; then
  say "Activando pnpm con corepack"
  corepack enable --install-directory "$HOME/.local/bin" pnpm 2>/dev/null || sudo corepack enable pnpm
  export PATH="$HOME/.local/bin:$PATH"
fi

say "Instalando dependencias"
cd "$APP_DIR"
pnpm install --frozen-lockfile

# --- .env ---------------------------------------------------------------------
if [[ ! -f .env ]]; then
  cp .env.example .env
  say "Creado .env a partir de .env.example (revísalo cuando termine)"
fi
if (( USE_TAILSCALE )) && ! grep -q '^HOST=' .env; then
  # Con Tailscale solo se entra por HTTPS a través de él, nunca directamente por el puerto
  echo 'HOST=127.0.0.1' >> .env
fi
PORT="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"
PORT="${PORT:-5050}"

# --- Servicio systemd ---------------------------------------------------------
say "Creando el servicio $SERVICE"
# PATH con la carpeta de node (nvm, fnm, etc. no están en el PATH de systemd)
SERVICE_PATH="$(dirname "$NODE_BIN"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
sudo tee "/etc/systemd/system/$SERVICE.service" >/dev/null <<EOF
[Unit]
Description=Zer0Code (Claude Code desde el navegador y el móvil)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PATH=$SERVICE_PATH
ExecStart=$NODE_BIN $APP_DIR/server/index.js
Restart=always
RestartSec=3
# Al parar el servicio, terminar también las tareas de Claude Code que estén en marcha
KillMode=control-group

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE" >/dev/null
sudo systemctl restart "$SERVICE"

# --- HTTPS con Tailscale (certificado válido, sin avisos en el móvil) ---------
if (( USE_TAILSCALE )); then
  command -v tailscale >/dev/null || fail "Tailscale no está instalado: curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up"
  say "Publicando por HTTPS en tu red Tailscale"
  sudo tailscale serve --bg "$PORT"
  TS_NAME="$(tailscale status --json | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')"
fi

# --- Resumen ------------------------------------------------------------------
sleep 1
systemctl is-active --quiet "$SERVICE" || { sudo journalctl -u "$SERVICE" -n 30 --no-pager; fail "El servicio no ha arrancado."; }

echo
say "Zer0Code está en marcha como servicio"
if (( USE_TAILSCALE )); then
  echo "    Abre en el móvil (con Tailscale activo): https://$TS_NAME"
else
  echo "    Abre en el navegador: http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT"
fi
cat <<EOF

    Ver el estado:     systemctl status $SERVICE
    Ver los logs:      journalctl -u $SERVICE -f
    Reiniciar:         sudo systemctl restart $SERVICE

    Si aún no has vinculado tu cuenta de Claude: cd $APP_DIR && pnpm auth:login
EOF
