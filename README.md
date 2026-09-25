<p align="center">
  <img src="https://media.discordapp.net/attachments/1405460793998315633/1551872426302771320/image.png?ex=6ab38d52&is=6ab23bd2&hm=2aeb4d6257524a08b9c76369cde7b18472ff7549a895c4636b707d8cf8483ea5&=&format=webp&quality=lossless" alt="ClaudeZer0 Banner" width="100%">
</p>

<p align="center">
  <strong>La interfaz web y móvil definitiva, multiplataforma y elegante para Claude Code</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Plataforma-Windows%20%7C%20Linux%20%7C%20macOS-informational?style=flat-square&logo=linux" alt="Multiplataforma">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-success?style=flat-square&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Claude%20Code-2.1.280-D97757?style=flat-square" alt="Claude Code">
  <img src="https://img.shields.io/badge/Modos-Hoster%20%7C%20Client-orange?style=flat-square" alt="Modos">
  <img src="https://img.shields.io/badge/Licencia-MIT-blue?style=flat-square" alt="Licencia">
</p>

---

## 🌟 ¿Qué es ClaudeZer0?

**ClaudeZer0** transforma el CLI de **Claude Code** en una experiencia web y móvil ultra fluida, inspirada en el diseño visual de **Claude.ai**: paleta cálida con tema claro y oscuro y toques terracota, tipografía editorial *Newsreader Serif*, streaming en tiempo real con razonamiento desplegable (*thinking process*), explorador interactivo de proyectos y ejecución multiplataforma.

<p align="center">
  <img src="dashboard.png" alt="ClaudeZer0: pantalla de inicio con barra lateral, saludo y selector de modelo" width="100%">
</p>

---

## ✨ Características Principales

- 🌐 **100% Multiplataforma**: Funciona de forma idéntica y nativa en **Windows** (CMD/PowerShell), **Linux** (Ubuntu, Debian, Arch, Fedora) y **macOS**.
- 🛡️ **Soporte de Doble Modo (`MODE=Hoster` / `MODE=Client`)**:
  - **`MODE=Hoster`**: El anfitrión comparte su cuenta o suscripción Pro con los usuarios conectados a la red local.
  - **`MODE=Client`**: Aislamiento estricto de credenciales. La cuenta del anfitrión queda 100% blindada y cada cliente usa su propia clave API personal guardada localmente en su navegador.
- 🎨 **Diseño Claude Oficial con SVGs Nativos**: Cero emojis genéricos. Todos los selectores de modelos, modos de ejecución, tarjetas de inicio y diálogos emplean vectores SVG afilados y personalizados.
- ⚡ **Selector de Modelos Claude**:
  - **Claude Fable 5.1**: Para los desafíos más difíciles.
  - **Claude Opus 5.5**: El más capaz para trabajos ambiciosos (por defecto).
  - **Claude Sonnet 5**: Lo más eficiente para las tareas diarias.
  - **Claude Haiku 4.5**: Respuestas inmediatas y máxima velocidad.
- 🎛️ **Modos de Ejecución**:
  - **Aceptar ediciones** (`acceptEdits`): Edita archivos sin preguntar y pide permiso para los comandos.
  - **Autónomo** (`auto`): Flujo continuo sin pausas de confirmación.
  - **Manual** (`manual`): Pide permiso antes de cada acción.
  - **Modo Plan** (`plan`): Análisis y planificación previa antes de aplicar código.
- ✅ **Permisos desde la Web**: Cuando Claude necesita permiso para una herramienta, aparece una tarjeta sobre la caja de texto con **Denegar**, **Permitir siempre en este chat** o **Permitir**, junto con el diff o el comando que quiere ejecutar. Funciona también desde el móvil y las peticiones pendientes reaparecen al reconectar.
- 👥 **Multiusuario**: El administrador crea usuarios con su propia contraseña, carpetas permitidas, modos de ejecución y límite de gasto mensual. Cada uno ve solo sus conversaciones. [Ver más](#-multiusuario).
- 📱 **Diseño Móvil Adaptativo (PWA)**: Accede desde tu smartphone o tablet conectado a la misma red WiFi con soporte PWA, barra de estado translúcida y favicon personalizado.
- 📂 **Explorador Visual de Carpetas**: Cambia el directorio de trabajo activo del agente con un explorador interactivo y accesos directos a directorios raíz (`C:\` en Windows, `/` en Linux).
- 🎙️ **Entrada por Voz**: Dicta prompts directamente mediante reconocimiento de voz integrado en el navegador.

---

## 🚀 Instalación Rápida

### Requisitos Previos
- **Node.js** (versión 18 o superior).
- Gestor de paquetes **pnpm** (recomendado) o **npm**.

### 1. Clonar el Repositorio
```bash
git clone https://github.com/Zer0Dev-exe/ClaudeZer0.git
cd ClaudeZer0
```

### 2. Instalar Dependencias
Con **pnpm**:
```bash
pnpm install
```
O con **npm**:
```bash
npm install
```

### 3. Vincular la Cuenta de Claude del Anfitrión (Solo la primera vez)

Si vas a usar **`MODE=Hoster`** (compartir tu cuenta con los usuarios conectados), tienes dos formas:

- **Opción A: Con tu Suscripción de Claude Pro / Team (Recomendada con `pnpm`)**
  Ejecuta el atajo interactivo en tu terminal:
  ```bash
  pnpm auth:login
  ```
  Se abrirá tu navegador para iniciar sesión con tu cuenta de Anthropic/Claude. La sesión quedará guardada de forma permanente y segura en tu equipo local. Puedes comprobar el estado en cualquier momento con:
  ```bash
  pnpm auth:status
  ```

- **Opción B: Con tu propia API Key de Anthropic (`ANTHROPIC_API_KEY`)**
  Si prefieres usar créditos de [console.anthropic.com](https://console.anthropic.com) o estás en un VPS sin entorno gráfico, simplemente define tu clave en el archivo `.env`:
  ```env
  ANTHROPIC_API_KEY=sk-ant-api03-...
  ```

### 4. Configurar el Archivo `.env`
Edita o crea el archivo `.env` en la raíz del proyecto (puedes basarte en `.env.example`):

```env
# Modo de uso:
# - MODE=Hoster  -> Compartes tu cuenta/suscripción Pro local con los demás.
# - MODE=Client  -> Cada cliente debe configurar su propia Claude API Key.
MODE=Hoster

# Credenciales del administrador (el resto de usuarios se crean desde la web):
CLAUDEZER0_USER=admin
CLAUDEZER0_PASSWORD=claudezer0

# Puerto del servidor web
PORT=5050
```

### 5. Iniciar el Servidor
En modo producción:
```bash
pnpm start
# o: npm start
```

En modo desarrollo con recarga automática:
```bash
pnpm dev
# o: npm run dev
```

### 6. Abrir la Interfaz
- **Desde tu PC**: Visita [http://localhost:5050](http://localhost:5050)
- **Desde tu Móvil u otro equipo en la red**: Visita `http://<TU_IP_LOCAL>:5050` (ejemplo: `http://192.168.1.50:5050`)

---

## 🔒 Comparativa de Modos

| Característica | `MODE=Hoster` | `MODE=Client` |
| :--- | :--- | :--- |
| **Cuenta Utilizada** | La cuenta del host (Suscripción Pro local o variable en `.env`) | Cada cliente usa su propia `ANTHROPIC_API_KEY` (`sk-ant-...`) |
| **Protección del Host** | El anfitrión comparte su cuota de uso | **Blindaje total**: Las credenciales del host son invisibles e inaccesibles |
| **Dónde se Guarda la Key** | Configuración local del servidor | Privadamente en el `localStorage` del navegador del cliente |
| **Ideal para...** | Redes domésticas privadas, talleres o uso familiar | Compartir el servidor con amigos, compañeros o miembros de equipo |

---

## 👥 Multiusuario

ClaudeZer0 admite varios usuarios en el mismo servidor. Es especialmente útil en **`MODE=Hoster`**: cada persona entra con su propia cuenta y el anfitrión decide hasta dónde llega cada una con su suscripción.

### Roles

| | Administrador | Usuario |
| :--- | :--- | :--- |
| **Cómo se crea** | Con `CLAUDEZER0_USER` y `CLAUDEZER0_PASSWORD` del `.env` | Lo crea el administrador desde la web |
| **Carpetas** | Cualquiera del equipo | Solo sus carpetas permitidas (y subcarpetas) |
| **Modos de ejecución** | Todos | Los que le conceda el administrador |
| **Límite de gasto** | Sin límite | Límite mensual opcional |
| **Gestionar usuarios, modelos y gasto** | Sí | No |

### Crear un usuario

1. Entra como administrador.
2. Abre el menú de tu perfil (abajo a la izquierda) → **Usuarios** → **Nuevo usuario**.
3. Rellena:
   - **Usuario** y **contraseña temporal** (mínimo 8 caracteres). Tendrá que cambiarla la primera vez que entre.
   - **Carpetas permitidas**: una ruta por línea. Solo podrá elegir esas carpetas como proyecto.
   - **Modos de ejecución**: por defecto Manual, Aceptar ediciones y Plan.
   - **Límite mensual (USD)**: déjalo vacío para no poner límite.

Desde la misma pantalla puedes editar un usuario, ponerle una contraseña nueva (se cierran sus sesiones abiertas) o eliminarlo (se borran también sus conversaciones).

### Qué queda separado por usuario

- **Conversaciones**: cada uno ve solo las suyas.
- **Carpeta de proyecto**: cada uno tiene la suya.
- **Tareas**: cada usuario puede tener una tarea en marcha a la vez sin bloquear a los demás.
- **Permisos**: las tarjetas de aprobación solo le llegan al dueño de la tarea, en todos sus dispositivos.
- **Gasto**: cada usuario ve su propio uso; el administrador ve el total.

### Límite mensual

Cuenta lo gastado **con la cuenta del anfitrión** en el mes natural, a precio de tarifa de la API (con suscripción es un equivalente, no un cobro real). Si el usuario configura su propia clave de API, ese gasto no cuenta. Al llegar al límite no puede enviar más mensajes hasta que el administrador lo amplíe o empiece el mes siguiente.

### Seguridad

- Las lecturas y ediciones de archivos fuera de las carpetas permitidas **se deniegan automáticamente**, sin preguntar.
- Los **comandos de terminal (Bash)** no se pueden limitar por carpeta. En los modos Manual y Aceptar ediciones siempre pasan por la tarjeta de aprobación, pero en **Autónomo** se ejecutan sin preguntar. Concede ese modo solo a personas de total confianza.
- Si un usuario olvida su contraseña, el administrador puede ponerle una nueva desde **Usuarios**. Si la olvida el administrador, basta con cambiar `CLAUDEZER0_PASSWORD` en el `.env` y reiniciar el servidor.

Los usuarios se guardan en `data/users.json` con las contraseñas cifradas (scrypt). Si actualizas desde una versión anterior, tus conversaciones y sesiones pasan automáticamente al administrador.

---

## 📁 Estructura del Proyecto

```
ClaudeZer0/
├── banner.png                     # Banner de repositorio oficial
├── .env                           # Variables de entorno y modo
├── package.json                   # Dependencias y scripts
├── server/
│   ├── index.js                   # Servidor Express y WebSocket
│   ├── claudeRunner.js            # Runner multiplataforma (Win/Linux/macOS)
│   ├── workspaceManager.js        # Explorador de carpetas del sistema
│   ├── sessionManager.js          # Historial de chats en JSON (por usuario)
│   ├── auth.js                    # Autenticación, sesiones y usuarios
│   ├── accessPolicy.js            # Carpetas y modos permitidos por usuario
│   ├── permissionManager.js       # Peticiones de permiso pendientes
│   ├── permissionMcp.js           # Servidor MCP que pide permisos a la web
│   └── usageManager.js            # Gasto por modelo y límite mensual
└── public/
    ├── favicon.svg                # Favicon oficial estilo Claude
    ├── icon.svg                   # Icono de aplicación / PWA
    ├── manifest.json              # Configuración PWA móvil
    ├── index.html                 # Interfaz SPA Claude.ai
    ├── css/style.css              # Sistema de diseño con variables HSL
    └── js/app.js                  # Lógica del cliente y WebSockets
```

---

## 💻 Compatibilidad Multiplataforma

ClaudeZer0 detecta automáticamente el sistema operativo anfitrión:

| Sistema Operativo | Detección de Binario | Invocación de Procesos | Navegación de Carpetas |
| :--- | :--- | :--- | :--- |
| **Windows** | `node_modules/.bin/claude.cmd` | `spawn('cmd.exe', ['/c', ...])` | `C:\`, `Documents`, `Desktop` |
| **Linux** | `node_modules/.bin/claude` | `spawn(bin, args)` (Shebang nativo) | `/`, `/var/www`, `~` |
| **macOS** | `node_modules/.bin/claude` | `spawn(bin, args)` (Shebang nativo) | `/`, `~/Documents`, `~` |

---

## 📄 Licencia

Este proyecto está bajo la Licencia [MIT](LICENSE).
Inspirado y diseñado para acompañar el ecosistema de [Claude Code](https://claude.ai) de Anthropic.
