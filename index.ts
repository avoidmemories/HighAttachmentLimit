import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findByCode, findByProps } from "@webpack";
import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import { FluxDispatcher, Menu, React, SelectedChannelStore, UserStore, showToast } from "@webpack/common";

import { FREE_FILE_LIMIT, cancelFfmpeg, loadFfmpeg, prepareClip, untilAborted } from "./clip";
import { type ClipProgress, showClipProgress } from "./progress";

const LEGACY_FFMPEG_BASE_URL = "https://raw.githubusercontent.com/riolubruh/YABDP4Nitro/main/ffmpeg/";
const DEFAULT_FFMPEG_BASE_URL = "https://raw.githubusercontent.com/avoidmemories/HighAttachmentLimit/main/ffmpeg/";

const settings = definePluginSettings({
	videoClips: {
		type: OptionType.BOOLEAN,
		description: "Send videos between 20 MB and 100 MB as clips",
		default: true,
	},
	audioClips: {
		type: OptionType.BOOLEAN,
		description: "Send audio between 20 MB and 100 MB as clips (embedded cover art is used as the video frame)",
		default: true,
	},
	zipClips: {
		type: OptionType.BOOLEAN,
		description: "Send any other file between 20 MB and 100 MB as a zip wrapped in a clip",
		default: true,
	},
	clipTimestamp: {
		type: OptionType.SELECT,
		description: "Timestamp written into the clip metadata",
		options: [
			{ label: "January 1st, 2015", value: 0, default: true },
			{ label: "Current time", value: 1 },
			{ label: "File last modified date", value: 2 },
		],
	},
	ffmpegBaseUrl: {
		type: OptionType.STRING,
		description: "Folder containing ffmpeg.js, 814.ffmpeg.js, ffmpeg-core.js and ffmpeg-core.wasm",
		default: DEFAULT_FFMPEG_BASE_URL,
	},
	ffmpegLocalPath: {
		type: OptionType.STRING,
		description: "Optional local ffmpeg folder. Its files are used before the FFmpeg base URL.",
		default: "",
	},
});

// Defaults are only used for new settings. Migrate the old upstream URL without overwriting custom mirrors.
if (settings.store.ffmpegBaseUrl === LEGACY_FFMPEG_BASE_URL) {
	settings.store.ffmpegBaseUrl = DEFAULT_FFMPEG_BASE_URL;
}

const Native = VencordNative.pluginHelpers.HighAttachmentLimit as PluginNative<typeof import("./native")>;

interface UploadItem {
	file: File;
	clip?: unknown;
	filename?: string;
}

interface AddFilesArgs {
	channelId: string;
	draftType: unknown;
	files?: UploadItem[];
}

type AddFilesFn = (args: AddFilesArgs) => unknown;

interface UploadModule {
	addFiles: AddFilesFn;
}

const CLIPS_DISABLED_MESSAGE =
	"Clips are disabled: an updated version of the plugin is needed. The Send Clip option still works.";

let uploadModule: UploadModule | undefined;
let originalAddFiles: AddFilesFn | undefined;
let activeController: AbortController | undefined;

function hasAnyClipEnabled() {
	const { videoClips, audioClips, zipClips } = settings.store;
	return videoClips || audioClips || zipClips;
}

function isUploadModule(value: unknown): value is UploadModule {
	return typeof value === "object" && value !== null && typeof (value as UploadModule).addFiles === "function";
}

function findUploadModule(): UploadModule | undefined {
	// The upload actions object defines popFirstFile next to addFiles, and its dispatch string is stable.
	// Looking up by property name is kept as a fallback for builds where the string search misses.
	const actions = findByCode("UPLOAD_ATTACHMENT_ADD_FILES", "popFirstFile") as { A?: unknown } | undefined;
	const exported = actions?.A ?? actions;
	if (isUploadModule(exported)) return exported;

	const byProps = findByProps("addFiles");
	return isUploadModule(byProps) ? byProps : undefined;
}

function isLargeFile(file: File) {
	return file.size >= FREE_FILE_LIMIT;
}

function formatMegabytes(bytes: number) {
	return (bytes / (1024 * 1024)).toFixed(1);
}

async function prepareUploadItems(items: UploadItem[], signal: AbortSignal, progress?: ClipProgress) {
	const userId = UserStore.getCurrentUser().id;
	const clipSettings = settings.store;
	const largeCount = items.filter((item) => isLargeFile(item.file)).length;
	let position = 0;

	// ffmpeg runs as a single instance, so large files are converted one at a time.
	for (const item of items) {
		signal.throwIfAborted();
		if (isLargeFile(item.file)) {
			position++;
			progress?.setStage(
				"Preparing clip",
				`${position}/${largeCount}: ${item.file.name} (${formatMegabytes(item.file.size)} MB)`
			);
			progress?.setRatio(0);
		}
		try {
			const prepared = await prepareClip(item.file, clipSettings, userId, {
				getFfmpeg: () => untilAborted(
					loadFfmpeg(
						clipSettings.ffmpegBaseUrl,
						clipSettings.ffmpegLocalPath,
						filename => Native.readFfmpegFile(clipSettings.ffmpegLocalPath, filename)
					),
					signal
				),
				signal,
				onProgress: (ratio) => progress?.setRatio(ratio),
			});
			item.file = prepared.file;
			item.filename = prepared.file.name;
			item.clip = prepared.clip;
		} catch (err) {
			if (signal.aborted) throw err;
			console.error("[HighAttachmentLimit] Failed to prepare", item.file.name, err);
			showToast(`Could not prepare ${item.file.name} as a clip. Sending it unchanged.`);
		}
	}
	return items;
}

/** Returns the prepared items, or undefined when the user cancelled the conversion. */
async function prepareItemsWithProgress(items: UploadItem[]): Promise<UploadItem[] | undefined> {
	const controller = new AbortController();
	activeController?.abort();
	activeController = controller;

	const hasLarge = items.some((item) => isLargeFile(item.file));
	const progress = hasLarge ? showClipProgress({ onCancel: cancelActiveUpload }) : undefined;
	try {
		const prepared = await prepareUploadItems(items, controller.signal, progress);
		if (hasLarge) showToast("Clip ready. Discord is now uploading it.");
		return prepared;
	} catch (err) {
		if (controller.signal.aborted) return undefined;
		throw err;
	} finally {
		progress?.close();
		if (activeController === controller) activeController = undefined;
	}
}

function cancelActiveUpload() {
	activeController?.abort();
	cancelFfmpeg();
}

function showCancelledToast() {
	showToast("Clip preparation cancelled. Files were not sent.");
}

function dispatchUpload(channelId: string, files: UploadItem[], draftType: unknown) {
	FluxDispatcher.dispatch({
		type: "UPLOAD_ATTACHMENT_ADD_FILES",
		channelId,
		files,
		draftType,
		allowOptimization: false,
	});
}

function sendClipFromPicker(channelId: string, draftType: unknown) {
	const input = document.createElement("input");
	input.type = "file";
	input.multiple = true;
	input.onchange = async () => {
		const files = Array.from(input.files ?? []);
		if (!files.length) return;

		try {
			const items = await prepareItemsWithProgress(files.map((file) => ({ file })));
			if (!items) return showCancelledToast();
			dispatchUpload(channelId, items, draftType);
		} catch (err) {
			console.error("[HighAttachmentLimit] Send Clip failed", err);
			showToast("Send Clip failed. See the console for details.");
		}
	};
	input.click();
}

// Menu patch callbacks receive Discord's untyped menu children and props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attachMenuPatch(children: any[], props: any) {
	if (!hasAnyClipEnabled()) return;

	const channelId: string = props?.channel?.id ?? SelectedChannelStore.getChannelId();
	children.push(
		React.createElement(Menu.MenuItem, {
			id: "high-attachment-limit-send-clip",
			label: "Send Clip",
			action: () => sendClipFromPicker(channelId, props?.draftType ?? 0),
		})
	);
}

export default definePlugin({
	name: "HighAttachmentLimit",
	description: "Upload files up to 100 MB by sending them as Discord clips.",
	authors: [{ name: "HighAttachmentLimit", id: 0n }],
	settings,

	patches: [
		{
			find: 'klass:"photoshop"',
			replacement: {
				match: /(\i)=(\i\.\i)\.getUserMaxFileSize\((\i)\)/,
				replace: "$1=$self.maxFileSize($2.getUserMaxFileSize($3))",
			},
		},
		{
			// Fallback for when the assignment shape changes. Applying it after the primary patch wraps the value twice,
			// which is harmless because maxFileSize takes a maximum.
			find: 'klass:"photoshop"',
			replacement: {
				match: /(\i\.\i)\.getUserMaxFileSize\((\i)\)/,
				replace: "$self.maxFileSize($&)",
			},
		},
	],

	maxFileSize(normal: number) {
		return hasAnyClipEnabled() ? Math.max(100 * 1024 * 1024, normal) : normal;
	},

	start() {
		addContextMenuPatch("channel-attach", attachMenuPatch);

		const target = findUploadModule();
		if (!target) {
			console.warn("[HighAttachmentLimit] Upload module not found. Automatic clip sending is disabled.");
			showToast(CLIPS_DISABLED_MESSAGE);
			return;
		}

		uploadModule = target;
		originalAddFiles = target.addFiles;
		const original = originalAddFiles;
		target.addFiles = (args: AddFilesArgs) => {
			if (!args?.files?.length || !hasAnyClipEnabled()) return original.call(target, args);

			return prepareItemsWithProgress(args.files).then((items) => {
				if (!items) return showCancelledToast();
				dispatchUpload(args.channelId, items, args.draftType);
			});
		};
	},

	stop() {
		cancelActiveUpload();
		removeContextMenuPatch("channel-attach", attachMenuPatch);
		if (uploadModule && originalAddFiles) uploadModule.addFiles = originalAddFiles;
		uploadModule = undefined;
		originalAddFiles = undefined;
	},
});
