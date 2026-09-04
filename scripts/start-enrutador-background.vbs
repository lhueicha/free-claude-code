' Lanzador silencioso en segundo plano para Enrutador FCC
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\lhueicha\Desktop\ENRUTADOR"
WshShell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command """& 'C:\Users\lhueicha\.local\bin\uv.exe' run fcc-server"""", 0, False
