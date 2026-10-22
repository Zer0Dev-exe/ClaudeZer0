; Instalador de Zer0Code para Windows (Inno Setup 6)
; Compilar: iscc /DAppVersion=1.3.1 /DStageDir=<carpeta de stage-app.sh> /DOutputDir=<salida> Zer0Code.iss
; Se instala para el usuario actual (sin permisos de administrador) y los datos quedan en %APPDATA%\Zer0Code.

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
AppName=Zer0Code
AppVersion={#AppVersion}
AppVerName=Zer0Code {#AppVersion}
AppPublisher=Zer0Dev-exe
AppPublisherURL=https://github.com/Zer0Dev-exe/Zer0Code
AppSupportURL=https://github.com/Zer0Dev-exe/Zer0Code/issues
AppUpdatesURL=https://github.com/Zer0Dev-exe/Zer0Code/releases
DefaultDirName={localappdata}\Programs\Zer0Code
DefaultGroupName=Zer0Code
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=Zer0Code-Setup-{#AppVersion}-x64
SetupIconFile=zer0code.ico
UninstallDisplayIcon={app}\zer0code.ico
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
Name: "autostart"; Description: "Iniciar Zer0Code al encender el equipo (minimizado)"; GroupDescription: "Arranque:"; Flags: unchecked

[InstallDelete]
; Al actualizar, quitar la versión anterior entera para que no queden dependencias viejas
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"

[Files]
Source: "{#StageDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs
Source: "Zer0Code.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "claude-login.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "zer0code.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Zer0Code"; Filename: "{app}\Zer0Code.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\zer0code.ico"; Comment: "Abrir Zer0Code"
Name: "{group}\Vincular cuenta de Claude"; Filename: "{app}\claude-login.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\zer0code.ico"
Name: "{group}\Configuración (.env)"; Filename: "{win}\notepad.exe"; Parameters: """{userappdata}\Zer0Code\.env"""
Name: "{group}\Carpeta de datos"; Filename: "{userappdata}\Zer0Code"
Name: "{group}\Desinstalar Zer0Code"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Zer0Code"; Filename: "{app}\Zer0Code.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\zer0code.ico"; Tasks: desktopicon
Name: "{userstartup}\Zer0Code"; Filename: "{app}\Zer0Code.cmd"; Parameters: "--background"; WorkingDir: "{app}"; IconFilename: "{app}\zer0code.ico"; Flags: runminimized; Tasks: autostart

[Run]
; El .env se crea al instalar para que el acceso «Configuración» funcione desde el primer momento
Filename: "{cmd}"; Parameters: "/c if not exist ""{userappdata}\Zer0Code"" mkdir ""{userappdata}\Zer0Code"" & if not exist ""{userappdata}\Zer0Code\.env"" copy /y ""{app}\app\.env.example"" ""{userappdata}\Zer0Code\.env"""; Flags: runhidden
Filename: "{app}\claude-login.cmd"; Description: "Vincular mi cuenta de Claude ahora"; Flags: postinstall unchecked shellexec
Filename: "{app}\Zer0Code.cmd"; Description: "Abrir Zer0Code"; Flags: postinstall nowait skipifsilent shellexec

[UninstallDelete]
; Las conversaciones, usuarios y el .env (en %APPDATA%\Zer0Code) se conservan al desinstalar
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"
