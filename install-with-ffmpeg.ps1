Write-Host "Starting HighAttachmentLimit installation with local FFmpeg..." -ForegroundColor Cyan
$cacheBuster = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
& ([scriptblock]::Create((Invoke-RestMethod "https://raw.githubusercontent.com/avoidmemories/HighAttachmentLimit/main/install.ps1?cache=$cacheBuster"))) -IncludeLocalFfmpeg
