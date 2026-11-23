$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
    python -m venv .venv
}
& "$projectRoot/.venv/Scripts/python.exe" -m pip install -r services/api/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
Push-Location -LiteralPath "$projectRoot/apps/web"
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
} finally { Pop-Location }
Push-Location -LiteralPath "$projectRoot/apps/admin"
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Admin dependency installation failed.' }
} finally { Pop-Location }
$apiProcess = Start-Process -FilePath "$projectRoot/.venv/Scripts/python.exe" -ArgumentList '-m','uvicorn','services.api.main:app','--host','127.0.0.1','--port','8000' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$adminProcess = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory "$projectRoot/apps/admin" -WindowStyle Hidden -PassThru
try {
    Set-Location -LiteralPath "$projectRoot/apps/web"
    npm run dev
} finally {
    if (-not $apiProcess.HasExited) { Stop-Process -Id $apiProcess.Id }
    if (-not $adminProcess.HasExited) { Stop-Process -Id $adminProcess.Id }
}
