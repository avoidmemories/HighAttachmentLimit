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

## FFmpeg assets

The `ffmpeg/` directory is committed to this repository so the plugin loads its own FFmpeg WebAssembly files from:

```
https://raw.githubusercontent.com/avoidmemories/HighAttachmentLimit/main/ffmpeg/
```

The default can be changed in the plugin settings (`FFmpeg base URL`) if you maintain a mirror. Keep all four required runtime files together: `ffmpeg.js`, `814.ffmpeg.js`, `ffmpeg-core.js`, and `ffmpeg-core.wasm`.

### Loading FFmpeg from disk

HighAttachmentLimit uses a **local first, remote fallback** loading order:

1. If **FFmpeg local path** is set, the plugin attempts to read the four runtime files from that folder.
2. A file that is not present or cannot be read is downloaded from **FFmpeg base URL** instead.

Vencord compiles user plugins into its build, so it does not expose the source plugin folder automatically at runtime. Set the local path once as shown in the installation steps; after that, FFmpeg is read from disk before the GitHub fallback is used.

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

### I already have a Vencord source build

Use this route if your Vencord folder already contains `src\userplugins` or you have previously run `pnpm build` there.

1. Open PowerShell in the root of your Vencord source folder.
2. Create the user-plugin folder if necessary, then clone the plugin:

   ```powershell
   New-Item -ItemType Directory -Force .\src\userplugins
   git clone https://github.com/avoidmemories/HighAttachmentLimit.git .\src\userplugins\HighAttachmentLimit
   ```

3. Build Vencord and install/update it in Discord:

   ```powershell
   pnpm build
   pnpm inject
   ```

4. Fully close Discord (including the system-tray process), then open it again. Enable **HighAttachmentLimit** in **Settings → Plugins**.

### I only have the regular Vencord installation

Use this route if you installed Vencord with its normal installer and do not have a Vencord source folder. You do not need to uninstall the existing installation; `pnpm inject` will apply your own build to Discord.

1. Clone Vencord and install its dependencies:

   ```powershell
   cd $HOME\Documents
   git clone https://github.com/Vendicated/Vencord.git
   cd Vencord
   pnpm install --frozen-lockfile
   ```

2. Add HighAttachmentLimit as a user plugin:

   ```powershell
   New-Item -ItemType Directory -Force .\src\userplugins
   git clone https://github.com/avoidmemories/HighAttachmentLimit.git .\src\userplugins\HighAttachmentLimit
   ```

3. Build Vencord and patch your installed Discord client:

   ```powershell
   pnpm build
   pnpm inject
   ```

   Select the Discord installation you use when the Vencord installer opens.
4. Fully close Discord (including the system-tray process), then open it again. Enable **HighAttachmentLimit** in **Settings → Plugins**.

### Configure local FFmpeg (optional)

To use the bundled files from disk instead of downloading them from GitHub, set **FFmpeg local path** to:

```text
<your Vencord folder>\src\userplugins\HighAttachmentLimit\ffmpeg
```

### Updating

From the Vencord source folder, run:

```powershell
git -C .\src\userplugins\HighAttachmentLimit pull
pnpm build
pnpm inject
```

Then restart Discord. For Vencord-specific troubleshooting or platforms other than Windows, see the official [Vencord source-build guide](https://docs.vencord.dev/installing/) and [custom-plugin instructions](https://docs.vencord.dev/installing/custom-plugins/).

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
