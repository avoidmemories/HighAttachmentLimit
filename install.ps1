param(
    [string]$VencordDir,
    [switch]$IncludeLocalFfmpeg
)

$ErrorActionPreference = "Stop"
$SourceBaseUrl = "https://raw.githubusercontent.com/avoidmemories/HighAttachmentLimit/main"
$PluginName = "HighAttachmentLimit"
$PluginFiles = @("index.ts", "clip.ts", "progress.ts", "native.ts")
$FfmpegFiles = @("ffmpeg.js", "814.ffmpeg.js", "ffmpeg-core.js", "ffmpeg-core.wasm")

function Write-Stage([int]$Current, [int]$Total, [string]$Status) {
    $percent = [math]::Floor(($Current - 1) / $Total * 100)
    Write-Progress -Id 1 -Activity "HighAttachmentLimit installer" -Status "$Status ($Current/$Total)" -PercentComplete $percent
    Write-Host "[$Current/$Total] $Status" -ForegroundColor Cyan
}

function Format-Size([long]$Bytes) {
    if ($Bytes -ge 1MB) { return "{0:N1} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N1} KB" -f ($Bytes / 1KB) }
    return "$Bytes bytes"
}

function Download-File([string]$Uri, [string]$Destination, [string]$Name, [int]$Current, [int]$Total) {
    # WebClient is available in both old Windows PowerShell and PowerShell 7.
    # HttpClient is not reliably available in some Windows PowerShell installs.
    $client = New-Object System.Net.WebClient
    $input = $null
    $output = $null
    try {
        $input = $client.OpenRead($Uri)
        [long]$length = 0
        if ($client.ResponseHeaders["Content-Length"]) { $length = [long]$client.ResponseHeaders["Content-Length"] }
        $output = [System.IO.File]::Open($Destination, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
        $buffer = New-Object byte[] 131072
        [long]$received = 0
        while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $output.Write($buffer, 0, $read)
            $received += $read
            if ($length -and $length -gt 0) {
                $filePercent = [math]::Min(100, [math]::Floor($received / $length * 100))
                $overall = [math]::Floor((($Current - 1) + ($filePercent / 100)) / $Total * 100)
                Write-Progress -Id 1 -Activity "HighAttachmentLimit installer" -Status "Downloading $Name - $(Format-Size $received) / $(Format-Size $length)" -PercentComplete $overall
                $downloadStatus = "{0} ({1} percent)" -f $Name, $filePercent
                Write-Progress -Id 2 -ParentId 1 -Activity "Current download" -Status $downloadStatus -PercentComplete $filePercent
            }
        }
        if ($received -eq 0) { throw "Downloaded file is empty: $Name" }
    } finally {
        if ($output) { $output.Dispose() }
        if ($input) { $input.Dispose() }
        $client.Dispose()
        Write-Progress -Id 2 -Activity "Current download" -Completed
    }
}

function Test-VencordSource([string]$Path) {
    return (Test-Path (Join-Path $Path "src\plugins")) -and (Test-Path (Join-Path $Path "package.json"))
}

function Get-DiscordPatcherLinks {
    $links = @()
    $discordNames = @("Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment")
    foreach ($discordName in $discordNames) {
        $discordRoot = Join-Path $env:LOCALAPPDATA $discordName
        if (-not (Test-Path -LiteralPath $discordRoot)) { continue }

        foreach ($appDirectory in Get-ChildItem -LiteralPath $discordRoot -Directory -Filter "app-*") {
            $appAsar = Join-Path $appDirectory.FullName "resources\app.asar"
            if (-not (Test-Path -LiteralPath $appAsar)) { continue }

            # app.asar is a small JavaScript loader after Vencord has patched Discord.
            $appAsarText = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($appAsar))
            $match = [regex]::Match($appAsarText, 'require\("([^"]*patcher\.js)"\)')
            if (-not $match.Success) { continue }

            $patcherPath = $match.Groups[1].Value.Replace("\\", "\").Replace("/", "\")
            $links += [PSCustomObject]@{
                Discord = $discordName
                AppAsar = $appAsar
                Patcher = [System.IO.Path]::GetFullPath($patcherPath)
            }
        }
    }
    return $links
}

function Assert-DiscordUsesSourceBuild([string]$SourceDirectory) {
    $expectedPatcher = [System.IO.Path]::GetFullPath((Join-Path $SourceDirectory "dist\patcher.js"))
    $links = @(Get-DiscordPatcherLinks)
    $activeLink = $links | Where-Object { $_.Patcher -ieq $expectedPatcher } | Select-Object -First 1
    if ($activeLink) {
        Write-Host "Discord is linked to this Vencord source build: $($activeLink.Discord)" -ForegroundColor Green
        return
    }

    $foundLinks = if ($links.Count) {
        ($links | ForEach-Object { "$($_.Discord): $($_.Patcher)" }) -join "`n"
    } else {
        "No patched Discord installation was found under $env:LOCALAPPDATA."
    }

    throw "Vencord was built, but Discord was not linked to this source folder. Expected: $expectedPatcher`nFound:`n$foundLinks`nRun the installer again, and when Vencord asks which Discord installation to patch, choose the installation you actually launch."
}

function Write-VencordLoader([string]$AppAsar, [string]$PatcherPath) {
    # app.asar is an ASAR archive, not a plain text file. Rebuild the small
    # Vencord loader instead of doing a length-changing text replacement.
    $packageJson = "{`n  `"name`": `"discord`",`n  `"main`": `"index.js`"`n}"
    $indexJs = "require(" + ($PatcherPath | ConvertTo-Json -Compress) + ")"
    $encoding = [System.Text.Encoding]::UTF8
    $indexSize = $encoding.GetByteCount($indexJs)
    $packageSize = $encoding.GetByteCount($packageJson)
    $header = '{"files":{"index.js":{"size":' + $indexSize + ',"offset":"0"},"package.json":{"size":' + $packageSize + ',"offset":"' + $indexSize + '"}}}'
    $headerSize = $encoding.GetByteCount($header)
    $alignedHeaderSize = [int]([math]::Ceiling($headerSize / 4.0) * 4)
    $paddedHeader = $header + ('0' * ($alignedHeaderSize - $headerSize))

    $stream = $null
    $writer = $null
    try {
        $stream = [System.IO.File]::Open($AppAsar, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $writer = New-Object System.IO.BinaryWriter($stream, $encoding)
        $writer.Write([int]4)
        $writer.Write([int]($alignedHeaderSize + 8))
        $writer.Write([int]($alignedHeaderSize + 4))
        $writer.Write([int]$headerSize)
        $writer.Write($encoding.GetBytes($paddedHeader))
        $writer.Write($encoding.GetBytes($indexJs))
        $writer.Write($encoding.GetBytes($packageJson))
    } finally {
        if ($writer) { $writer.Dispose() }
        elseif ($stream) { $stream.Dispose() }
    }
}

function Repair-DiscordSourceBuildLink([string]$SourceDirectory) {
    $links = @(Get-DiscordPatcherLinks)
    if ($links.Count -ne 1) { return $false }

    $appAsar = $links[0].AppAsar
    $originalAppAsar = Join-Path (Split-Path $appAsar -Parent) "_app.asar"
    if (-not (Test-Path -LiteralPath $originalAppAsar)) {
        throw "Discord is not in a safe already-patched state, so its loader was not changed automatically: $appAsar"
    }

    $sourcePatcher = [System.IO.Path]::GetFullPath((Join-Path $SourceDirectory "dist\patcher.js"))
    Write-Host "Repairing the Discord loader so it uses this Vencord source build..." -ForegroundColor Yellow
    Write-VencordLoader $appAsar $sourcePatcher
    return $true
}

function Set-LocalFfmpegPath([string]$Path) {
    $settingsPath = Join-Path $env:APPDATA "Vencord\settings\settings.json"
    if (-not (Test-Path $settingsPath)) {
        Write-Warning "Vencord settings were not found, so the FFmpeg local path could not be updated automatically."
        return
    }

    # Do not parse the whole file: third-party entries can make ConvertFrom-Json fail.
    $settingsText = [System.IO.File]::ReadAllText($settingsPath)
    $escapedPath = $Path.Replace("\", "\\")
    $existingPathPattern = '(?s)("HighAttachmentLimit"\s*:\s*\{[^}]*?"ffmpegLocalPath"\s*:\s*")[^"]*(")'
    if ($settingsText -match $existingPathPattern) {
        $updatedSettings = $settingsText -replace $existingPathPattern, ('${1}' + $escapedPath + '${2}')
    } elseif ($settingsText -match '(?s)"HighAttachmentLimit"\s*:\s*\{([^}]*)\}') {
        $updatedSettings = $settingsText -replace '(?s)("HighAttachmentLimit"\s*:\s*\{)([^}]*)(\})', ('${1}${2},' + "`n            " + '"ffmpegLocalPath": "' + $escapedPath + '"${3}')
    } elseif ($settingsText -match '"plugins"\s*:\s*\{') {
        $updatedSettings = $settingsText -replace '("plugins"\s*:\s*\{)', ('${1}' + "`n        " + '"HighAttachmentLimit": { "ffmpegLocalPath": "' + $escapedPath + '" },')
    } else {
        throw "Could not locate the plugins section in Vencord settings."
    }
    [System.IO.File]::WriteAllText($settingsPath, $updatedSettings, [System.Text.UTF8Encoding]::new($false))
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

if (Get-Process -Name Discord -ErrorAction SilentlyContinue) {
    Write-Host "Discord is currently running. Fully close it, including the tray icon, then run this command again." -ForegroundColor Yellow
    throw "Installation stopped before changing files or settings."
}

$totalSteps = if ($IncludeLocalFfmpeg) { 11 } else { 8 }
$PluginDir = Join-Path $VencordDir "src\userplugins\$PluginName"
$FfmpegDir = Join-Path $PluginDir "ffmpeg"
New-Item -ItemType Directory -Force $PluginDir | Out-Null
Write-Host "`nInstalling HighAttachmentLimit into: $PluginDir`n" -ForegroundColor Green

# A Vencord user plugin needs only its TypeScript files.
$extras = @(".git", ".gitignore", "README.md", "LICENSE.md", "install.ps1")
foreach ($name in $extras) {
    $extraPath = Join-Path $PluginDir $name
    if (Test-Path $extraPath) { Remove-Item -LiteralPath $extraPath -Recurse -Force }
}

$step = 0
foreach ($name in $PluginFiles) {
    $step++
    Write-Stage $step $totalSteps "Downloading plugin file: $name"
    Download-File "$SourceBaseUrl/$name" (Join-Path $PluginDir $name) $name $step $totalSteps
}

if ($IncludeLocalFfmpeg) {
    # Download into a staging folder so a partial runtime can never be used.
    $FfmpegDownloadDir = "$FfmpegDir.download-$PID"
    New-Item -ItemType Directory -Force $FfmpegDownloadDir | Out-Null
    foreach ($name in $FfmpegFiles) {
        $step++
        Write-Stage $step $totalSteps "Downloading local FFmpeg: $name"
        Download-File "$SourceBaseUrl/ffmpeg/$name" (Join-Path $FfmpegDownloadDir $name) $name $step $totalSteps
    }
    foreach ($name in $FfmpegFiles) {
        $file = Get-Item -LiteralPath (Join-Path $FfmpegDownloadDir $name) -ErrorAction SilentlyContinue
        if (-not $file -or $file.Length -eq 0) { throw "FFmpeg download failed: $name" }
    }
    if (Test-Path $FfmpegDir) { Remove-Item -LiteralPath $FfmpegDir -Recurse -Force }
    Move-Item -LiteralPath $FfmpegDownloadDir -Destination $FfmpegDir
    Set-LocalFfmpegPath $FfmpegDir
    Write-Host "Local FFmpeg is ready: $FfmpegDir" -ForegroundColor Green
} else {
    # The normal installer is deliberately the remote-only mode.
    if (Test-Path $FfmpegDir) { Remove-Item -LiteralPath $FfmpegDir -Recurse -Force }
    Set-LocalFfmpegPath ""
    $step++
    Write-Stage $step $totalSteps "Remote FFmpeg mode selected (local path cleared)"
    Write-Host "Local FFmpeg path was cleared. FFmpeg will be loaded from GitHub when needed." -ForegroundColor Yellow
}

Push-Location $VencordDir
try {
    $step++
    Write-Stage $step $totalSteps "Building Vencord"
    pnpm build
    $step++
    Write-Stage $step $totalSteps "Applying the Vencord build to Discord"
    pnpm inject
    $step++
    Write-Stage $step $totalSteps "Verifying that Discord uses this Vencord build"
    try {
        Assert-DiscordUsesSourceBuild $VencordDir
    } catch {
        if (-not (Repair-DiscordSourceBuildLink $VencordDir)) { throw }
        Assert-DiscordUsesSourceBuild $VencordDir
    }
} finally {
    Pop-Location
    Write-Progress -Id 1 -Activity "HighAttachmentLimit installer" -Completed
}

Write-Host "`nDone. Fully close Discord (including its tray icon), then start it again." -ForegroundColor Green
