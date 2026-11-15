param(
    [string]$VencordDir,
    [switch]$IncludeLocalFfmpeg
)

$ErrorActionPreference = "Stop"
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
$extras = @(".git", ".gitignore", "README.md", "LICENSE.md", "install.ps1")
if (-not $IncludeLocalFfmpeg) { $extras += "ffmpeg" }
foreach ($name in $extras) {
    $extraPath = Join-Path $PluginDir $name
    if (Test-Path $extraPath) { Remove-Item -LiteralPath $extraPath -Recurse -Force }
}

foreach ($name in $PluginFiles) {
    Invoke-WebRequest -UseBasicParsing -Uri "$SourceBaseUrl/$name" -OutFile (Join-Path $PluginDir $name)
}

if ($IncludeLocalFfmpeg) {
    $FfmpegDir = Join-Path $PluginDir "ffmpeg"
    New-Item -ItemType Directory -Force $FfmpegDir | Out-Null
    foreach ($name in $FfmpegFiles) {
        Invoke-WebRequest -UseBasicParsing -Uri "$SourceBaseUrl/ffmpeg/$name" -OutFile (Join-Path $FfmpegDir $name)
    }
    foreach ($name in $FfmpegFiles) {
        if (-not (Test-Path (Join-Path $FfmpegDir $name))) { throw "FFmpeg download failed: $name" }
    }

    $settingsPath = Join-Path $env:APPDATA "Vencord\settings\settings.json"
    if (Test-Path $settingsPath) {
        # Some settings files contain third-party entries that PowerShell cannot parse as JSON.
        # Update only this plugin's existing setting and leave the rest of the file byte-for-byte intact.
        $settingsText = [System.IO.File]::ReadAllText($settingsPath)
        $escapedFfmpegDir = $FfmpegDir.Replace("\", "\\")
        $pattern = '(?s)("HighAttachmentLimit"\s*:\s*\{[^}]*?"ffmpegLocalPath"\s*:\s*")[^"]*(")'
        $updatedSettings = $settingsText -replace $pattern, ('${1}' + $escapedFfmpegDir + '${2}')
        if ($updatedSettings -eq $settingsText) {
            Write-Warning "FFmpeg files were installed, but the Vencord setting could not be updated automatically. Set FFmpeg local path to: $FfmpegDir"
        } else {
            [System.IO.File]::WriteAllText($settingsPath, $updatedSettings, [System.Text.UTF8Encoding]::new($false))
        }
    }
}

Push-Location $VencordDir
try {
    pnpm build
    pnpm inject
} finally {
    Pop-Location
}
