$ErrorActionPreference = "Stop"

foreach ($tool in @("cmake", "git")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool nao encontrado no PATH. Instale-o e abra um novo terminal antes de compilar o driver."
    }
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
    throw "Visual Studio 2022 nao encontrado. Instale o Visual Studio 2022 ou Build Tools 2022 com a carga 'Desenvolvimento para desktop com C++'."
}

$vsInstallPath = & $vswhere -latest -products "*" -version "[17.0,18.0)" `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $vsInstallPath) {
    throw "Compilador C++ do Visual Studio 2022 nao encontrado. Abra o Visual Studio Installer, escolha Modificar e instale a carga 'Desenvolvimento para desktop com C++'."
}

$buildPath = Join-Path $PSScriptRoot "..\native\build-vs2022"
$buildPath = [System.IO.Path]::GetFullPath($buildPath)
$sourcePath = Join-Path $PSScriptRoot "..\native"
$sourcePath = [System.IO.Path]::GetFullPath($sourcePath)
$null = New-Item -ItemType Directory -Path $buildPath -Force
$lockPath = Join-Path $buildPath "camvr-build.lock"

try {
    $buildLock = [System.IO.File]::Open(
        $lockPath,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
} catch [System.IO.IOException] {
    throw "Outra compilacao do CamVR ja esta usando esta pasta. Aguarde ela terminar antes de tentar novamente."
}

try {
    & cmake -S $sourcePath -B $buildPath -G "Visual Studio 17 2022" -A x64
    if ($LASTEXITCODE -ne 0) {
        throw "Configuracao do CMake falhou. Confira os erros acima."
    }

    & cmake --build $buildPath --config Release
    if ($LASTEXITCODE -ne 0) {
        throw "Compilacao do driver falhou. Confira os erros acima."
    }

    Write-Host "Driver CamVR compilado com sucesso."
} finally {
    $buildLock.Dispose()
}
