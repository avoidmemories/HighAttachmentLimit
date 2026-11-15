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

## Installation

HighAttachmentLimit is a Vencord **user plugin**, so it requires a Vencord build from source.

1. Follow Vencord's official [build-from-source instructions](https://docs.vencord.dev/installing/).
2. Clone this repository directly into your Vencord user-plugin directory:

   ```powershell
   git clone https://github.com/avoidmemories/HighAttachmentLimit.git .\src\userplugins\HighAttachmentLimit
   ```

   If `src\userplugins` does not exist, create it first.
3. From the root of your Vencord checkout, build it:

   ```powershell
   pnpm build
   ```

4. Install or update the built Vencord client as described by Vencord, then restart Discord.
5. Open **Settings → Plugins**, enable **HighAttachmentLimit**, and configure its clip options if needed.

After pulling an update to this repository, run `pnpm build` again and restart Discord.

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

HighAttachmentLimit is licensed under the [Open Software License 3.0](LICENSE.md), matching the license used by YABDP4Nitro. The bundled FFmpeg files retain their own license in [`ffmpeg/LICENSE.txt`](ffmpeg/LICENSE.txt).
