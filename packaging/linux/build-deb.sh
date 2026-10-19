#!/usr/bin/env bash
# Construye el paquete .deb a partir de la carpeta de stage-app.sh.
# Uso: bash packaging/linux/build-deb.sh <versión> <arquitectura: amd64|arm64> <carpeta stage> <salida>
set -euo pipefail

VERSION="$1"; ARCH="$2"; STAGE="$3"; OUT="$4"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(mktemp -d)/claudezer0_${VERSION}_${ARCH}"

mkdir -p "$PKG/DEBIAN" "$PKG/opt/claudezer0" "$PKG/usr/bin" "$PKG/lib/systemd/system" \
         "$PKG/usr/share/doc/claudezer0" "$PKG/usr/share/icons/hicolor/512x512/apps"
cp -a "$STAGE/app" "$STAGE/runtime" "$PKG/opt/claudezer0/"
install -m 755 "$HERE/claudezer0" "$PKG/usr/bin/claudezer0"
install -m 644 "$HERE/claudezer0@.service" "$PKG/lib/systemd/system/"
install -m 644 "$HERE/../icon-512.png" "$PKG/usr/share/icons/hicolor/512x512/apps/claudezer0.png"
install -m 644 "$STAGE/app/LICENSE" "$PKG/usr/share/doc/claudezer0/copyright"

cat > "$PKG/DEBIAN/control" <<EOF
Package: claudezer0
Version: $VERSION
Section: devel
Priority: optional
Architecture: $ARCH
Maintainer: Zer0Dev-exe <76405774+Zer0Dev-exe@users.noreply.github.com>
Homepage: https://github.com/Zer0Dev-exe/ClaudeZer0
Installed-Size: $(du -sk "$PKG" | cut -f1)
Description: Claude Code desde el navegador y el móvil
 Interfaz web y app móvil para Claude Code, servida desde tu propio servidor.
 Incluye Node.js y Claude Code: no necesita nada más instalado.
EOF

cat > "$PKG/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "configure" ]; then
  systemctl daemon-reload 2>/dev/null || true
  # Al actualizar, reiniciar los servicios que estuvieran en marcha
  for unit in $(systemctl list-units --plain --no-legend 'claudezer0@*' 2>/dev/null | awk '{print $1}'); do
    systemctl try-restart "$unit" 2>/dev/null || true
  done
  cat <<'MSG'

ClaudeZer0 instalado. Con tu usuario (no root):
  claudezer0 login    vincular tu cuenta de Claude
  claudezer0 enable   dejarlo como servicio (sigue aunque cierres el SSH)
  claudezer0 help     ver todos los comandos

MSG
fi
EOF

cat > "$PKG/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "remove" ]; then
  for unit in $(systemctl list-units --all --plain --no-legend 'claudezer0@*' 2>/dev/null | awk '{print $1}'); do
    systemctl disable --now "$unit" 2>/dev/null || true
  done
fi
EOF

cat > "$PKG/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
systemctl daemon-reload 2>/dev/null || true
EOF
chmod 755 "$PKG/DEBIAN/postinst" "$PKG/DEBIAN/prerm" "$PKG/DEBIAN/postrm"

mkdir -p "$OUT"
dpkg-deb --build --root-owner-group -Zxz "$PKG" "$OUT/claudezer0_${VERSION}_${ARCH}.deb"
echo "Paquete: $OUT/claudezer0_${VERSION}_${ARCH}.deb"
