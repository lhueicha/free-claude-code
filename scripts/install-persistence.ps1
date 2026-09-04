# install-persistence.ps1 - Activa la persistencia automatica de Enrutador al iniciar Windows
param(
    [string]$ProjectDir = "C:\Users\lhueicha\Desktop\ENRUTADOR",
    [string]$UvPath = "C:\Users\lhueicha\.local\bin\uv.exe"
)

$ErrorActionPreference = "Stop"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "   Configurando Persistencia de Enrutador en Windows " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# 1. Verificar existencia de uv.exe
if (-not (Test-Path $UvPath)) {
    $uvCmd = Get-Command uv -ErrorAction SilentlyContinue
    if ($uvCmd) {
        $UvPath = $uvCmd.Source
    } else {
        Write-Error "No se encontro uv.exe en $UvPath ni en el PATH del sistema."
    }
}
Write-Host "[OK] uv detectado en: $UvPath" -ForegroundColor Green

# 2. Verificar existencia del directorio del proyecto
if (-not (Test-Path $ProjectDir)) {
    $ProjectDir = (Get-Location).Path
}
Write-Host "[OK] Directorio del proyecto: $ProjectDir" -ForegroundColor Green

# 3. Crear script VBS para ejecucion 100% silenciosa en segundo plano (sin ventana de consola negra)
$vbsDir = Join-Path $ProjectDir "scripts"
if (-not (Test-Path $vbsDir)) {
    New-Item -ItemType Directory -Path $vbsDir -Force | Out-Null
}
$localVbsPath = Join-Path $vbsDir "start-enrutador-background.vbs"

$lines = @(
    "' Lanzador silencioso en segundo plano para Enrutador FCC",
    "Set WshShell = CreateObject(`"WScript.Shell`")",
    "WshShell.CurrentDirectory = `"$ProjectDir`"",
    "WshShell.Run `"powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"`"`"& '$UvPath' run fcc-server`"`"`"`", 0, False"
)
[System.IO.File]::WriteAllLines($localVbsPath, $lines)
Write-Host "[OK] Script VBS generado en: $localVbsPath" -ForegroundColor Green

# 4. Instalar en la carpeta de Inicio de Windows (Startup de Usuario)
$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$startupVbs = Join-Path $startupDir "Enrutador_AutoStart.vbs"
Copy-Item -Path $localVbsPath -Destination $startupVbs -Force
Write-Host "[OK] Lanzador instalado en carpeta Startup de Windows: $startupVbs" -ForegroundColor Green

Write-Host "`n====================================================" -ForegroundColor Cyan
Write-Host "   PERSISTENCIA ACTIVADA EXITOSAMENTE               " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Al apagar y encender tu computador, Enrutador se iniciara automaticamente en segundo plano en http://localhost:8082" -ForegroundColor Green
