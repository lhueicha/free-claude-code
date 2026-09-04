# uninstall-persistence.ps1 - Desactiva el inicio automatico de Enrutador al iniciar Windows
Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

Write-Host "====================================================" -ForegroundColor Yellow
Write-Host "   Desactivando Persistencia de Enrutador en Windows " -ForegroundColor Yellow
Write-Host "====================================================" -ForegroundColor Yellow

$startupDir = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
$startupVbs = Join-Path $startupDir "Enrutador_AutoStart.vbs"

if (Test-Path $startupVbs) {
    Remove-Item -Path $startupVbs -Force
    Write-Host "[✓] Eliminado lanzador de Inicio: $startupVbs" -ForegroundColor Green
}

$taskName = "Enrutador_FreeClaudeCode_AutoStart"
try {
    schtasks /Delete /TN $taskName /F | Out-Null
    Write-Host "[✓] Tarea programada eliminada: $taskName" -ForegroundColor Green
} catch {
    Write-Host "No se encontro tarea programada $taskName o ya fue eliminada."
}

Write-Host "`n[✓] Persistencia desactivada exitosamente." -ForegroundColor Green
