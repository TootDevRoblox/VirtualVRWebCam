param(
    [string]$SteamVrPath = "${env:ProgramFiles(x86)}\Steam\steamapps\common\SteamVR"
)

$driverPath = Join-Path $PSScriptRoot "..\native\build-vs2022\camvr"
$driverPath = [System.IO.Path]::GetFullPath($driverPath)
$registrar = Join-Path $SteamVrPath "bin\win64\vrpathreg.exe"

if (-not (Test-Path $registrar)) {
    throw "SteamVR nao encontrado em '$SteamVrPath'. Informe o caminho correto com -SteamVrPath."
}

& $registrar removedriver $driverPath
if ($LASTEXITCODE -ne 0) {
    throw "O SteamVR nao conseguiu remover o driver CamVR (codigo $LASTEXITCODE)."
}

Write-Host "Driver CamVR removido do SteamVR. Feche e abra o SteamVR."
