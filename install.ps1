param(
    [string]$VencordDir,
    [switch]$IncludeLocalFfmpeg
)

$ErrorActionPreference = "Stop"
# PowerShell 5 renders an extremely slow progress bar for every web request.
# Suppressing it is especially important for the 32 MB WebAssembly file.
$ProgressPreference = "SilentlyContinue"
$SourceBaseUrl = "https://raw.githubusercontent.com/avoidmemories/HighAttachmentLimit/main"
$PluginName = "HighAttachmentLimit"
$PluginFiles = @("index.ts", "clip.ts", "progress.ts", "native.ts")
$FfmpegFiles = @("ffmpeg.js", "814.ffmpeg.js", "ffmpeg-core.js", "ffmpeg-core.wasm")

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

# A Vencord user plugin needs only its TypeScript files. Keep repository metadata and documentation out.
# Do not remove ffmpeg here: a normal plugin update must preserve a previously
# installed local runtime.
$extras = @(".git", ".gitignore", "README.md", "LICENSE.md", "install.ps1")
foreach ($name in $extras) {
    $extraPath = Join-Path $PluginDir $name
    if (Test-Path $extraPath) { Remove-Item -LiteralPath $extraPath -Recurse -Force }
}

foreach ($name in $PluginFiles) {
    Invoke-WebRequest -UseBasicParsing -Uri "$SourceBaseUrl/$name" -OutFile (Join-Path $PluginDir $name)
}

if ($IncludeLocalFfmpeg) {
    $FfmpegDir = Join-Path $PluginDir "ffmpeg"
    $FfmpegDownloadDir = "$FfmpegDir.download"
    if (Test-Path $FfmpegDownloadDir) { Remove-Item -LiteralPath $FfmpegDownloadDir -Recurse -Force }
    New-Item -ItemType Directory -Force $FfmpegDownloadDir | Out-Null
    foreach ($name in $FfmpegFiles) {
        $destination = Join-Path $FfmpegDownloadDir $name
        Invoke-WebRequest -UseBasicParsing -Uri "$SourceBaseUrl/ffmpeg/$name" -OutFile $destination -TimeoutSec 180
    }
    foreach ($name in $FfmpegFiles) {
        $file = Get-Item -LiteralPath (Join-Path $FfmpegDownloadDir $name) -ErrorAction SilentlyContinue
        if (-not $file -or $file.Length -eq 0) { throw "FFmpeg download failed: $name" }
    }
    if (Test-Path $FfmpegDir) { Remove-Item -LiteralPath $FfmpegDir -Recurse -Force }
    Move-Item -LiteralPath $FfmpegDownloadDir -Destination $FfmpegDir

    $settingsPath = Join-Path $env:APPDATA "Vencord\settings\settings.json"
    if (Test-Path $settingsPath) {
        # Some settings files contain third-party entries that PowerShell cannot parse as JSON.
        # Update only this plugin's setting and leave every unrelated entry intact.
        $settingsText = [System.IO.File]::ReadAllText($settingsPath)
        $escapedFfmpegDir = $FfmpegDir.Replace("\", "\\")
        $existingPathPattern = '(?s)("HighAttachmentLimit"\s*:\s*\{[^}]*?"ffmpegLocalPath"\s*:\s*")[^"]*(")'
        if ($settingsText -match $existingPathPattern) {
            $updatedSettings = $settingsText -replace $existingPathPattern, ('${1}' + $escapedFfmpegDir + '${2}')
        } elseif ($settingsText -match '(?s)"HighAttachmentLimit"\s*:\s*\{([^}]*)\}') {
            $updatedSettings = $settingsText -replace '(?s)("HighAttachmentLimit"\s*:\s*\{)([^}]*)(\})', ('${1}${2},' + "`n            " + '"ffmpegLocalPath": "' + $escapedFfmpegDir + '"${3}')
        } elseif ($settingsText -match '"plugins"\s*:\s*\{') {
            $updatedSettings = $settingsText -replace '("plugins"\s*:\s*\{)', ('${1}' + "`n        " + '"HighAttachmentLimit": { "ffmpegLocalPath": "' + $escapedFfmpegDir + '" },')
        } else {
            throw "Could not locate the plugins section in Vencord settings."
        }
        [System.IO.File]::WriteAllText($settingsPath, $updatedSettings, [System.Text.UTF8Encoding]::new($false))
    }
    Write-Host "Local FFmpeg installed and configured: $FfmpegDir"
}

Push-Location $VencordDir
try {
    pnpm build
    pnpm inject
} finally {
    Pop-Location
}
