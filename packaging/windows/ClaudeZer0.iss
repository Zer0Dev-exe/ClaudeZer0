; Instalador de ClaudeZer0 para Windows (Inno Setup 6)
; Compilar: iscc /DAppVersion=1.2.0 /DStageDir=<carpeta de stage-app.sh> /DOutputDir=<salida> ClaudeZer0.iss
; Se instala para el usuario actual (sin permisos de administrador) y los datos quedan en %APPDATA%\ClaudeZer0.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\..\dist\stage"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist"
#endif

[Setup]
AppId={{6E8B7C31-4F0A-4C2D-9B57-5A3E2C1D0F42}
AppName=ClaudeZer0
AppVersion={#AppVersion}
AppVerName=ClaudeZer0 {#AppVersion}
AppPublisher=Zer0Dev-exe
AppPublisherURL=https://github.com/Zer0Dev-exe/ClaudeZer0
AppSupportURL=https://github.com/Zer0Dev-exe/ClaudeZer0/issues
AppUpdatesURL=https://github.com/Zer0Dev-exe/ClaudeZer0/releases
DefaultDirName={localappdata}\Programs\ClaudeZer0
DefaultGroupName=ClaudeZer0
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=ClaudeZer0-Setup-{#AppVersion}-x64
SetupIconFile=claudezer0.ico
UninstallDisplayIcon={app}\claudezer0.ico
LicenseFile={#StageDir}\app\LICENSE
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos:"
Name: "autostart"; Description: "Iniciar ClaudeZer0 al encender el equipo (minimizado)"; GroupDescription: "Arranque:"; Flags: unchecked

[InstallDelete]
; Al actualizar, quitar la versión anterior entera para que no queden dependencias viejas
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"

[Files]
Source: "{#StageDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs
Source: "ClaudeZer0.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "claude-login.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "claudezer0.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\ClaudeZer0"; Filename: "{app}\ClaudeZer0.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\claudezer0.ico"; Comment: "Abrir ClaudeZer0"
Name: "{group}\Vincular cuenta de Claude"; Filename: "{app}\claude-login.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\claudezer0.ico"
Name: "{group}\Configuración (.env)"; Filename: "{win}\notepad.exe"; Parameters: """{userappdata}\ClaudeZer0\.env"""
Name: "{group}\Carpeta de datos"; Filename: "{userappdata}\ClaudeZer0"
Name: "{group}\Desinstalar ClaudeZer0"; Filename: "{uninstallexe}"
Name: "{autodesktop}\ClaudeZer0"; Filename: "{app}\ClaudeZer0.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\claudezer0.ico"; Tasks: desktopicon
Name: "{userstartup}\ClaudeZer0"; Filename: "{app}\ClaudeZer0.cmd"; Parameters: "--background"; WorkingDir: "{app}"; IconFilename: "{app}\claudezer0.ico"; Flags: runminimized; Tasks: autostart

[Run]
; El .env se crea al instalar para que el acceso «Configuración» funcione desde el primer momento
Filename: "{cmd}"; Parameters: "/c if not exist ""{userappdata}\ClaudeZer0"" mkdir ""{userappdata}\ClaudeZer0"" & if not exist ""{userappdata}\ClaudeZer0\.env"" copy /y ""{app}\app\.env.example"" ""{userappdata}\ClaudeZer0\.env"""; Flags: runhidden
Filename: "{app}\claude-login.cmd"; Description: "Vincular mi cuenta de Claude ahora"; Flags: postinstall unchecked shellexec
Filename: "{app}\ClaudeZer0.cmd"; Description: "Abrir ClaudeZer0"; Flags: postinstall nowait skipifsilent shellexec

[UninstallDelete]
; Las conversaciones, usuarios y el .env (en %APPDATA%\ClaudeZer0) se conservan al desinstalar
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"
