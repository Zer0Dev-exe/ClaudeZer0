#!/usr/bin/env bash
# Construye ClaudeZer0.app y el .dmg en macOS a partir de la carpeta de stage-app.sh.
# Uso: bash packaging/macos/build-dmg.sh <versión> <carpeta stage> <salida>
set -euo pipefail

VERSION="$1"; STAGE="$2"; OUT="$3"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCH="$(uname -m)"
WORK="$(mktemp -d)"
APP="$WORK/ClaudeZer0.app"

# Applet que se queda abierto (-s) para poder detener el servidor al salir
osacompile -s -o "$APP" "$HERE/ClaudeZer0.applescript"
RES="$APP/Contents/Resources"
cp -a "$STAGE/app" "$STAGE/runtime" "$RES/"
install -m 755 "$HERE/start.sh" "$RES/start.sh"

# Icono
ICONSET="$WORK/applet.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$HERE/../icon-512.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  if [ $double -le 512 ]; then
    sips -z $double $double "$HERE/../icon-512.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  fi
done
iconutil -c icns "$ICONSET" -o "$RES/applet.icns"

PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName ClaudeZer0" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string ClaudeZer0" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string es.zer0dev.claudezer0" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier es.zer0dev.claudezer0" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $VERSION" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :LSMinimumSystemVersion string 12.0" "$PLIST" 2>/dev/null || true

# Firma ad hoc del paquete (en Apple Silicon todo el código debe ir firmado; Node y Claude ya traen la suya)
codesign --force --sign - "$APP"

# Disco con la app y el acceso directo a Aplicaciones
DMG_DIR="$WORK/dmg"
mkdir -p "$DMG_DIR"
mv "$APP" "$DMG_DIR/"
ln -s /Applications "$DMG_DIR/Aplicaciones"
mkdir -p "$OUT"
hdiutil create -volname "ClaudeZer0 $VERSION" -srcfolder "$DMG_DIR" -ov -format UDZO "$OUT/ClaudeZer0-${VERSION}-${ARCH}.dmg"
echo "Disco: $OUT/ClaudeZer0-${VERSION}-${ARCH}.dmg"
