-- ClaudeZer0.app: arranca el servidor al abrirla y lo detiene al salir (Dock -> Salir o Cmd+Q).
property serverPid : ""

on run
	set resDir to POSIX path of (path to me) & "Contents/Resources/"
	set serverPid to do shell script "/bin/bash " & quoted form of (resDir & "start.sh")
	if serverPid is "" then quit
end run

on reopen
	-- Clic en el icono del Dock con la app ya abierta: volver a abrir la web
	set resDir to POSIX path of (path to me) & "Contents/Resources/"
	do shell script "/bin/bash " & quoted form of (resDir & "start.sh")
end reopen

on quit
	if serverPid is not "" then
		do shell script "kill " & serverPid & " 2>/dev/null || true"
	end if
	continue quit
end quit
