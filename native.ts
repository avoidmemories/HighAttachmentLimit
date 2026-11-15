import { readFile, stat } from "fs/promises";
import { basename, resolve } from "path";

const FFMPEG_FILES = new Set([
	"814.ffmpeg.js",
	"ffmpeg.js",
	"ffmpeg-core.js",
	"ffmpeg-core.wasm",
]);
const MAX_FFMPEG_FILE_SIZE = 40 * 1024 * 1024;
const REMOTE_FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;

/** Reads one of the known FFmpeg runtime files from the user-configured local folder. */
export async function readFfmpegFile(_: unknown, folder: string, filename: string): Promise<Uint8Array | null> {
	if (typeof folder !== "string" || typeof filename !== "string" || !FFMPEG_FILES.has(filename)) return null;

	const filePath = resolve(folder, filename);
	if (basename(filePath) !== filename) return null;

	try {
		const info = await stat(filePath);
		if (!info.isFile() || info.size > MAX_FFMPEG_FILE_SIZE) return null;
		return new Uint8Array(await readFile(filePath));
	} catch {
		return null;
	}
}

/**
 * Downloads an FFmpeg runtime asset in Vencord's main process. This mirrors the
 * network approach used by the original implementation and avoids renderer CSP/CORS
 * restrictions that can make a normal browser fetch stall in Discord.
 */
export async function downloadFfmpegFile(_: unknown, url: string): Promise<Uint8Array | null> {
	if (typeof url !== "string" || !url.startsWith("https://")) return null;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REMOTE_FFMPEG_TIMEOUT_MS);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) return null;

		const contentLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(contentLength) && contentLength > MAX_FFMPEG_FILE_SIZE) return null;

		const bytes = new Uint8Array(await response.arrayBuffer());
		return bytes.length <= MAX_FFMPEG_FILE_SIZE ? bytes : null;
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}
