param(
    [string]$SteamVrPath = "${env:ProgramFiles(x86)}\Steam\steamapps\common\SteamVR",
    [switch]$EnableExperimentalHmdDisplay
)

$driverPath = Join-Path $PSScriptRoot "..\native\build-vs2022\camvr"
$driverPath = [System.IO.Path]::GetFullPath($driverPath)
$registrar = Join-Path $SteamVrPath "bin\win64\vrpathreg.exe"
$manifest = Join-Path $driverPath "driver.vrdrivermanifest"
$driverDll = Join-Path $driverPath "bin\win64\driver_camvr.dll"

if (-not $EnableExperimentalHmdDisplay) {
    throw "Registro do HMD virtual bloqueado por seguranca. O driver CamVR causou artefatos graficos no SteamVR. Nao o registre novamente ate a causa ser investigada."
}

if (-not (Test-Path $registrar)) {
    throw "SteamVR nao encontrado em '$SteamVrPath'. Instale o SteamVR ou informe o caminho correto."
}
if (-not (Test-Path $manifest) -or -not (Test-Path $driverDll)) {
    throw "Driver nao compilado. Instale o Visual Studio 2022 com C++, depois execute 'npm.cmd run build:driver'. Se a compilacao falhar, resolva o erro antes de instalar."
}

& $registrar adddriver $driverPath
if ($LASTEXITCODE -ne 0) {
    throw "O SteamVR nao conseguiu registrar o driver CamVR (codigo $LASTEXITCODE)."
}

Write-Host "Driver CamVR registrado. Reinicie o SteamVR para carregar os dispositivos."
