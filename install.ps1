param([string]$VencordDir)

$ErrorActionPreference = "Stop"
$PluginRepository = "https://github.com/avoidmemories/HighAttachmentLimit.git"
$PluginName = "HighAttachmentLimit"

function Test-VencordSource([string]$Path) {
    return (Test-Path (Join-Path $Path "src\plugins")) -and (Test-Path (Join-Path $Path "package.json"))
}

if (-not $VencordDir) {
    $candidates = @((Get-Location).Path, (Join-Path $HOME "Vencord"), (Join-Path $HOME "Documents\Vencord")) | Select-Object -Unique
    $VencordDir = $candidates | Where-Object { Test-VencordSource $_ } | Select-Object -First 1
}

if (-not $VencordDir -or -not (Test-VencordSource $VencordDir)) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Select your Vencord source folder (the folder containing src and package.json)"
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw "No Vencord source folder was selected." }
    $VencordDir = $dialog.SelectedPath
}

if (-not (Test-VencordSource $VencordDir)) { throw "The selected folder is not a Vencord source checkout: $VencordDir" }

$PluginDir = Join-Path $VencordDir "src\userplugins\$PluginName"
New-Item -ItemType Directory -Force (Split-Path $PluginDir -Parent) | Out-Null
if (Test-Path (Join-Path $PluginDir ".git")) {
    git -C $PluginDir pull --ff-only
} elseif (Test-Path $PluginDir) {
    throw "Plugin folder already exists but is not a Git checkout: $PluginDir"
} else {
    git clone $PluginRepository $PluginDir
}

Push-Location $VencordDir
try {
    pnpm build
    pnpm inject
} finally {
    Pop-Location
}
