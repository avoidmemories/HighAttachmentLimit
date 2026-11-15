# HighAttachmentLimit

A private [Vencord](https://github.com/Vendicated/Vencord) user plugin that prepares files between Discord's free upload limit (20 MiB) and 100 MiB as Discord Clips before upload.

> **Disclaimer:** Vencord and Discord client modifications may violate Discord's Terms of Service. Use this plugin at your own risk. HighAttachmentLimit is not affiliated with Discord Inc.

## What it does

- **Video clips:** remuxes supported video files to an `isom`-branded MP4 without re-encoding when possible.
- **Audio clips:** places supported audio in an MP4 container with a black video track.
- **Zip clips:** wraps other files in an uncompressed ZIP archive (or preserves an existing archive) and appends it to a short MP4 clip.
- **Progress and cancellation:** shows conversion progress and lets you stop a pending conversion.
- **Upload menu:** adds a **Send Clip** item to the channel attachment menu.

The prepared upload is marked with the metadata Discord expects for a Clip. The plugin does not change Discord's server-side limits, and files over 100 MiB are not converted.

## Installation

HighAttachmentLimit is a Vencord **user plugin**. User plugins are TypeScript source files, so they only work with a Vencord build from source; they cannot be dropped into a normal prebuilt Vencord installation.

### Requirements

Install the following before continuing:

- [Node.js LTS](https://nodejs.org/)
- [Git](https://git-scm.com/downloads)
- [pnpm](https://pnpm.io/installation)

Ensure all three are available in PowerShell:

```powershell
git --version
node --version
pnpm --version
```

### One-command installation or update

Fully close Discord, including its system-tray process. Then, for an existing Vencord source checkout, paste this into PowerShell:

```powershell
irm https://raw.githubusercontent.com/avoidmemories/HighAttachmentLimit/main/install.ps1 | iex
```

The installer checks the current folder, `C:\Users\<you>\Vencord`, and `Documents\Vencord`. If it cannot find Vencord, it opens a folder picker; select the folder that contains `src` and `package.json`. It downloads only the four required TypeScript files into `src\userplugins\HighAttachmentLimit`, runs `pnpm build`, and opens the Vencord installer (`pnpm inject`).

After the installer finishes, fully close Discord (including its system-tray process), start it again, and enable **HighAttachmentLimit** in **Settings → Plugins**.

### One-command installation with local FFmpeg

Use this version to install the plugin with its FFmpeg WebAssembly files stored locally. It downloads an additional ~32 MB, configures the local FFmpeg path automatically, and avoids downloading FFmpeg from GitHub during clip preparation:

```powershell
irm https://raw.githubusercontent.com/avoidmemories/HighAttachmentLimit/main/install-with-ffmpeg.ps1 | iex
```

### Set up a Vencord source checkout

Use this route to create a local Vencord checkout for HighAttachmentLimit. You do not need to uninstall an existing Vencord installation; `pnpm inject` will apply your own build to Discord.

1. Clone Vencord and install its dependencies:

   ```powershell
   $VencordParent = Read-Host "Paste the folder where Vencord should be created"
   if (-not (Test-Path $VencordParent)) { throw 'The selected parent folder does not exist.' }
   $VencordDir = Join-Path $VencordParent "Vencord"
   Set-Location (Split-Path $VencordDir -Parent)
   git clone https://github.com/Vendicated/Vencord.git
   Set-Location $VencordDir
   pnpm install --frozen-lockfile
   ```

2. Run the one-command installer from the previous section:

   ```powershell
   irm https://raw.githubusercontent.com/avoidmemories/HighAttachmentLimit/main/install.ps1 | iex
   ```

   If Vencord is not found automatically, select the `Vencord` folder you just cloned in the folder picker. Select the Discord installation you use when the Vencord installer opens.
3. Fully close Discord (including the system-tray process), then open it again. Enable **HighAttachmentLimit** in **Settings → Plugins**.

## Configure local FFmpeg (optional)

### FFmpeg assets

The `ffmpeg/` directory is committed to this repository and contains the FFmpeg WebAssembly runtime. Keep all four required runtime files together: `ffmpeg.js`, `814.ffmpeg.js`, `ffmpeg-core.js`, and `ffmpeg-core.wasm`.

HighAttachmentLimit uses a **local first, remote fallback** loading order: when **FFmpeg local path** is set, the plugin reads the runtime files from that folder first; any missing or unreadable file is downloaded from **FFmpeg base URL** instead.

To use the bundled files from disk instead of downloading them from GitHub, set **FFmpeg local path** to:

```text
<your Vencord folder>\src\userplugins\HighAttachmentLimit\ffmpeg
```

The regular one-command installer is the remote-only mode: it removes any local FFmpeg folder and clears **FFmpeg local path**. Use **One-command installation with local FFmpeg** above to download, repair, and configure the local runtime automatically.

### Updating

Run the same one-command installer again, then restart Discord. For Vencord-specific troubleshooting or platforms other than Windows, see the official [Vencord source-build guide](https://docs.vencord.dev/installing/) and [custom-plugin instructions](https://docs.vencord.dev/installing/custom-plugins/).

## Development

The plugin is intentionally structured as one Vencord user-plugin directory:

```
HighAttachmentLimit/
├── index.ts       # plugin entry point and upload interception
├── clip.ts        # FFmpeg loading and clip preparation
├── progress.ts    # conversion-progress UI
└── ffmpeg/        # bundled FFmpeg WebAssembly runtime
```

For iterative work, place this repository at `Vencord/src/userplugins/HighAttachmentLimit` and run `pnpm watch` from the Vencord root. Rebuild/restart when testing requires it.

## Attribution

The clip-preparation approach and bundled FFmpeg layout were adapted from [YABDP4Nitro](https://github.com/riolubruh/YABDP4Nitro), especially its Clip/FFmpeg implementation. This repository is an independent Vencord user plugin; it is not affiliated with that project or its authors.

## License

HighAttachmentLimit is licensed under the [Open Software License 3.0](LICENSE.md). The bundled FFmpeg files retain their own license in [`ffmpeg/LICENSE.txt`](ffmpeg/LICENSE.txt).
