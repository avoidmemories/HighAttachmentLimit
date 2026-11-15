param([string]$VencordDir)

$ErrorActionPreference = "Stop"
$SourceBaseUrl = "https://raw.githubusercontent.com/avoidmemories/HighAttachmentLimit/main"
$PluginName = "HighAttachmentLimit"
$PluginFiles = @("index.ts", "clip.ts", "progress.ts", "native.ts")

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
New-Item -ItemType Directory -Force $PluginDir | Out-Null

# A Vencord user plugin needs only its TypeScript files. Keep repository metadata, docs, and optional FFmpeg assets out.
foreach ($name in @(".git", ".gitignore", "README.md", "LICENSE.md", "install.ps1", "ffmpeg")) {
    $extraPath = Join-Path $PluginDir $name
    if (Test-Path $extraPath) { Remove-Item -LiteralPath $extraPath -Recurse -Force }
}

foreach ($name in $PluginFiles) {
    Invoke-WebRequest -UseBasicParsing -Uri "$SourceBaseUrl/$name" -OutFile (Join-Path $PluginDir $name)
}

Push-Location $VencordDir
try {
    pnpm build
    pnpm inject
} finally {
    Pop-Location
}
