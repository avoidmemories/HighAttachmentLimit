Write-Host "Starting HighAttachmentLimit installation with local FFmpeg..." -ForegroundColor Cyan
& ([scriptblock]::Create((Invoke-RestMethod "https://raw.githubusercontent.com/avoidmemories/HighAttachmentLimit/main/install.ps1"))) -IncludeLocalFfmpeg
