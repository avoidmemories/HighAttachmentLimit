export const FREE_FILE_LIMIT = 20 * 1024 * 1024;
export const CLIP_FILE_LIMIT = 100 * 1024 * 1024;
const DISCORD_CLIP_EPOCH = 1420070400000;

const SKIPPED_MIME_TYPES = new Set([
	"video/3gp", "video/asf", "video/ivf", "video/mpeg",
	"audio/mid", "audio/basic", "audio/mpegurl", "audio/3gp",
]);
const MOV_MIME_TYPES = new Set([
	"video/flv", "video/ogg", "video/wmv", "video/mov",
	"audio/wav", "audio/aiff", "audio/x-ms-wma", "audio/mpeg",
]);
const ARCHIVE_MIME_SUBTYPES = new Set([
	"x-7z-compressed", "x-bzip", "x-bzip2", "x-rar-compressed", "x-tar",
	"gzip", "x-gzip", "zip", "x-zip-compressed",
]);

// Box that Discord's API checks for to accept a file as a clip.
const CLIP_TAG = Uint8Array.from(atob("AAAuLnV1aWShyFKZM0ZNuIjwg/V6daXv"), (c) => c.charCodeAt(0));

export interface ClipSettings {
	videoClips: boolean;
	audioClips: boolean;
	zipClips: boolean;
	clipTimestamp: number;
	ffmpegBaseUrl: string;
	ffmpegLocalPath: string;
}

export interface ClipMetadata {
	id: bigint;
	createdAt: number;
	version: 3;
	applicationName: string;
	applicationId: string;
	users: string[];
	clipMethod: string;
	length: number;
	thumbnail: string;
	filepath: string;
	name: string;
}

export interface PreparedFile {
	file: File;
	clip?: ClipMetadata;
}

export interface FFmpegProgressEvent {
	progress: number;
}

export interface FFmpegInstance {
	load(urls: { coreURL: string; wasmURL: string }): Promise<unknown>;
	writeFile(name: string, data: Uint8Array): Promise<unknown>;
	readFile(name: string): Promise<Uint8Array | string>;
	deleteFile(name: string): Promise<unknown>;
	exec(args: string[]): Promise<unknown>;
	on(event: "log", callback: (event: { message: string }) => void): void;
	on(event: "progress", callback: (event: FFmpegProgressEvent) => void): void;
	off(event: "progress", callback: (event: FFmpegProgressEvent) => void): void;
	terminate(): void;
}

export interface PrepareOptions {
	getFfmpeg: () => Promise<FFmpegInstance>;
	signal: AbortSignal;
	/** Conversion ratio from 0 to 1, or undefined when ffmpeg cannot report one. */
	onProgress: (ratio: number | undefined) => void;
}

declare global {
	interface Window {
		FFmpegWASM?: { FFmpeg: new () => FFmpegInstance };
	}
}

const FFMPEG_WORKER_FILE = "814.ffmpeg.js";
const FFMPEG_SCRIPT_FILE = "ffmpeg.js";
const FFMPEG_CORE_FILE = "ffmpeg-core.js";
const FFMPEG_WASM_FILE = "ffmpeg-core.wasm";
const FFMPEG_FETCH_TIMEOUT_MS = 60_000;

let ffmpegPromise: Promise<FFmpegInstance> | undefined;
type LocalAssetReader = (filename: string) => Promise<Uint8Array | null>;

async function fetchAsset(url: string): Promise<ArrayBuffer> {
	// Chromium's fetch has no useful default deadline. Without one, a stalled
	// raw.githubusercontent.com request leaves Discord's upload UI waiting forever.
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FFMPEG_FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: controller.signal });
		if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
		return await res.arrayBuffer();
	} catch (err) {
		if (controller.signal.aborted) {
			throw new Error(`Timed out after ${FFMPEG_FETCH_TIMEOUT_MS / 1000} seconds while fetching ${url}`);
		}
		throw err;
	} finally {
		clearTimeout(timeout);
	}
}

async function loadAsset(
	baseUrl: string,
	localPath: string,
	filename: string,
	type: string,
	readLocalAsset?: LocalAssetReader
): Promise<Blob> {
	// Match YABDP4Nitro's behavior: use a local file first and download it only when unavailable.
	if (localPath && readLocalAsset) {
		const localFile = await readLocalAsset(filename);
		if (localFile) return new Blob([localFile], { type });
	}

	return new Blob([await fetchAsset(baseUrl + filename)], { type });
}

async function toBlobUrl(
	baseUrl: string,
	localPath: string,
	filename: string,
	type: string,
	readLocalAsset?: LocalAssetReader
): Promise<string> {
	return URL.createObjectURL(await loadAsset(baseUrl, localPath, filename, type, readLocalAsset));
}

function injectScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.id = "highAttachmentLimitFfmpegScript";
		script.src = src;
		script.onload = () => resolve();
		script.onerror = reject;
		document.head.appendChild(script);
	});
}

export function loadFfmpeg(
	baseUrl: string,
	localPath: string,
	readLocalAsset?: LocalAssetReader
): Promise<FFmpegInstance> {
	ffmpegPromise ??= (async () => {
		const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";

		const workerUrl = await toBlobUrl(base, localPath, FFMPEG_WORKER_FILE, "text/javascript", readLocalAsset);
		// ffmpeg.js resolves its worker relative to its own URL, which does not work from a blob.
		const scriptSource = await (await loadAsset(base, localPath, FFMPEG_SCRIPT_FILE, "text/javascript", readLocalAsset)).text();
		const patchedScriptSource = scriptSource.replace(
			"new URL(e.p+e.u(814),e.b)",
			JSON.stringify(workerUrl)
		);
		const scriptUrl = URL.createObjectURL(new Blob([patchedScriptSource], { type: "text/javascript" }));

		// ffmpeg.js picks AMD over globals when `define` exists, so hide it while it loads.
		const w = window as Window & { define?: unknown };
		const savedDefine = w.define;
		w.define = undefined;
		try {
			await injectScript(scriptUrl);
		} finally {
			w.define = savedDefine;
		}

		const coreUrl = await toBlobUrl(base, localPath, FFMPEG_CORE_FILE, "text/javascript", readLocalAsset);
		const wasmUrl = await toBlobUrl(base, localPath, FFMPEG_WASM_FILE, "application/wasm", readLocalAsset);

		const FFmpegCtor = window.FFmpegWASM?.FFmpeg;
		if (!FFmpegCtor) throw new Error("FFmpegWASM did not register after loading ffmpeg.js");

		const ffmpeg = new FFmpegCtor();
		await ffmpeg.load({ coreURL: coreUrl, wasmURL: wasmUrl });
		return ffmpeg;
	})().catch((err) => {
		ffmpegPromise = undefined;
		throw err;
	});
	return ffmpegPromise;
}

/** Stops the running ffmpeg worker. The next conversion loads a fresh instance. */
export function cancelFfmpeg() {
	const pending = ffmpegPromise;
	ffmpegPromise = undefined;
	pending?.then((ffmpeg) => ffmpeg.terminate(), () => {});
}

function abortError() {
	return new DOMException("Clip preparation was cancelled", "AbortError");
}

/**
 * ffmpeg.wasm calls cannot be interrupted, so cancellation is observed by racing each call against the signal.
 */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(abortError());
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(abortError());
		signal.addEventListener("abort", onAbort, { once: true });
		promise
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", onAbort));
	});
}

async function runFfmpeg(
	ffmpeg: FFmpegInstance,
	input: { name: string; data: Uint8Array } | undefined,
	args: string[],
	outputName: string,
	{ signal, onProgress }: PrepareOptions
): Promise<Uint8Array> {
	const reportProgress = ({ progress }: FFmpegProgressEvent) =>
		onProgress(Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : undefined);

	ffmpeg.on("progress", reportProgress);
	try {
		if (input) await untilAborted(ffmpeg.writeFile(input.name, input.data), signal);
		await untilAborted(ffmpeg.exec(args), signal);
		const output = await untilAborted(ffmpeg.readFile(outputName), signal);
		if (typeof output === "string" || output.byteLength === 0) {
			throw new Error("FFmpeg produced an empty output file");
		}
		return output;
	} finally {
		ffmpeg.off("progress", reportProgress);
		// After a cancel the worker is terminated, so cleanup calls would never resolve.
		if (!signal.aborted) {
			if (input) await ffmpeg.deleteFile(input.name).catch(() => {});
			await ffmpeg.deleteFile(outputName).catch(() => {});
		}
	}
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	return out;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/** Builds a single-entry, uncompressed zip. Compression is skipped because it would be too slow in-browser. */
function createStoredZip(entryName: string, data: Uint8Array): Uint8Array {
	const nameBytes = new TextEncoder().encode(entryName);
	const checksum = crc32(data);
	const UTF8_FLAG = 0x0800;

	const localHeader = new DataView(new ArrayBuffer(30));
	localHeader.setUint32(0, 0x04034b50, true);
	localHeader.setUint16(4, 20, true);
	localHeader.setUint16(6, UTF8_FLAG, true);
	localHeader.setUint32(14, checksum, true);
	localHeader.setUint32(18, data.byteLength, true);
	localHeader.setUint32(22, data.byteLength, true);
	localHeader.setUint16(26, nameBytes.byteLength, true);

	const centralHeader = new DataView(new ArrayBuffer(46));
	centralHeader.setUint32(0, 0x02014b50, true);
	centralHeader.setUint16(4, 20, true);
	centralHeader.setUint16(6, 20, true);
	centralHeader.setUint16(8, UTF8_FLAG, true);
	centralHeader.setUint32(16, checksum, true);
	centralHeader.setUint32(20, data.byteLength, true);
	centralHeader.setUint32(24, data.byteLength, true);
	centralHeader.setUint16(28, nameBytes.byteLength, true);
	centralHeader.setUint32(42, 0, true);

	const localSize = 30 + nameBytes.byteLength + data.byteLength;
	const centralSize = 46 + nameBytes.byteLength;

	const endRecord = new DataView(new ArrayBuffer(22));
	endRecord.setUint32(0, 0x06054b50, true);
	endRecord.setUint16(8, 1, true);
	endRecord.setUint16(10, 1, true);
	endRecord.setUint32(12, centralSize, true);
	endRecord.setUint32(16, localSize, true);

	return concatBytes(
		new Uint8Array(localHeader.buffer),
		nameBytes,
		data,
		new Uint8Array(centralHeader.buffer),
		nameBytes,
		new Uint8Array(endRecord.buffer)
	);
}

function getExtension(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot) : "";
}

function getStem(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

function buildClipMetadata(
	file: File,
	name: string,
	userId: string,
	timestampMode: number
): ClipMetadata {
	let id = 0n;
	let createdAt = DISCORD_CLIP_EPOCH;

	if (timestampMode === 1) {
		createdAt = Date.now();
		id = (BigInt(createdAt) - BigInt(DISCORD_CLIP_EPOCH)) << 22n;
	} else if (timestampMode === 2) {
		createdAt = file.lastModified;
		id = (BigInt(createdAt) - BigInt(DISCORD_CLIP_EPOCH)) << 22n;
	}

	return {
		id,
		createdAt,
		version: 3,
		applicationName: "",
		applicationId: "1301689862256066560",
		users: [userId],
		clipMethod: "manual",
		length: file.size,
		thumbnail: "",
		filepath: "",
		name,
	};
}

function toMp4File(bytes: Uint8Array, name: string): File {
	return new File([new Blob([bytes as BlobPart], { type: "video/mp4" })], name, { type: "video/mp4" });
}

function videoClipArgs(inputName: string, outputName: string): string[] {
	return [
		"-i", inputName, "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text", "-dn",
		"-brand", "isom/avc1", "-movflags", "+faststart", "-map", "0", "-map_metadata", "-1",
		"-map_chapters", "-1", "-map", "-0:t", "-strict", "-2", outputName,
	];
}

function audioClipArgs(inputName: string, outputName: string): string[] {
	return [
		"-i", inputName, "-f", "lavfi", "-i", "color=c=black:s=300x100", "-shortest", "-fflags", "+shortest",
		"-map", "0:v?", "-map", "1:v", "-map", "0:a", "-disposition:v", "default", "-brand", "isom/avc1",
		"-movflags", "+faststart", "-map_metadata", "-1", "-dn", "-map_chapters", "-1", "-preset", "ultrafast",
		"-c:v", "libx264", "-c:a", "copy", "-strict", "-2", "-tune", "stillimage", "-r", "5", "-pix_fmt", "yuv420p",
		"-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2", "-max_interleave_delta", "1", outputName,
	];
}

const ZIP_HEADER_ARGS = [
	"-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:duration=1", "-shortest", "-fflags", "+shortest",
	"-brand", "isom/avc1", "-movflags", "+faststart", "-map_metadata", "-1", "-preset", "ultrafast", "output.mp4",
];

/**
 * Converts a file into a Discord clip upload when its size is between the free limit and the clip limit.
 * Returns the original file unchanged when no conversion applies.
 */
export async function prepareClip(
	file: File,
	settings: ClipSettings,
	userId: string,
	options: PrepareOptions
): Promise<PreparedFile> {
	if (SKIPPED_MIME_TYPES.has(file.type)) return { file };
	if (file.size < FREE_FILE_LIMIT || file.size > CLIP_FILE_LIMIT) return { file };
	options.signal.throwIfAborted();

	const stem = getStem(file.name);
	const extension = getExtension(file.name);
	const inputName = `input${extension || ".bin"}`;
	const outputName = MOV_MIME_TYPES.has(file.type) ? "output.mov" : "output.mp4";
	const inputBytes = () => file.arrayBuffer().then((buf) => new Uint8Array(buf));

	if (settings.videoClips && file.size > FREE_FILE_LIMIT && file.type.startsWith("video/")) {
		const ffmpeg = await options.getFfmpeg();
		const transmuxed = await runFfmpeg(
			ffmpeg,
			{ name: inputName, data: await inputBytes() },
			videoClipArgs(inputName, outputName),
			outputName,
			options
		);
		const name = `${stem}.mp4`;
		return {
			file: toMp4File(concatBytes(transmuxed, CLIP_TAG), name),
			clip: buildClipMetadata(file, stem, userId, settings.clipTimestamp),
		};
	}

	if (settings.audioClips && file.size > FREE_FILE_LIMIT && file.type.startsWith("audio/")) {
		const ffmpeg = await options.getFfmpeg();
		const transmuxed = await runFfmpeg(
			ffmpeg,
			{ name: inputName, data: await inputBytes() },
			audioClipArgs(inputName, outputName),
			outputName,
			options
		);
		const name = `${stem}.mp4`;
		return {
			file: toMp4File(concatBytes(transmuxed, CLIP_TAG), name),
			clip: buildClipMetadata(file, stem, userId, settings.clipTimestamp),
		};
	}

	if (settings.zipClips) {
		const ffmpeg = await options.getFfmpeg();
		const header = concatBytes(
			await runFfmpeg(ffmpeg, undefined, ZIP_HEADER_ARGS, "output.mp4", options),
			CLIP_TAG
		);
		const isArchive = file.type.startsWith("application/") &&
			ARCHIVE_MIME_SUBTYPES.has(file.type.slice("application/".length));

		if (isArchive) {
			return {
				file: toMp4File(concatBytes(header, await inputBytes()), `${file.name}.mp4`),
				clip: buildClipMetadata(file, file.name, userId, settings.clipTimestamp),
			};
		}

		const zipped = createStoredZip(file.name, await inputBytes());
		const name = `${stem}.zip`;
		return {
			file: toMp4File(concatBytes(header, zipped), `${name}.mp4`),
			clip: buildClipMetadata(file, name, userId, settings.clipTimestamp),
		};
	}

	return { file };
}
