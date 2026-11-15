import { readFile, stat } from "fs/promises";
import { basename, resolve } from "path";

const FFMPEG_FILES = new Set([
	"814.ffmpeg.js",
	"ffmpeg.js",
	"ffmpeg-core.js",
	"ffmpeg-core.wasm",
]);
const MAX_FFMPEG_FILE_SIZE = 40 * 1024 * 1024;

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
