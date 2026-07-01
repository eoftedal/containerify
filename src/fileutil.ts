import { promises as fs } from "fs";
import * as fss from "fs";
import * as crypto from "crypto";

export async function sizeOf(file: string) {
	return (await fs.lstat(file)).size;
}

export async function ensureEmptyDir(path: string) {
	await fs.rm(path, { recursive: true, force: true });
	await fs.mkdir(path, { recursive: true });
	return path;
}

export async function readJson<T>(file: string): Promise<T> {
	return JSON.parse(await fs.readFile(file, "utf-8")) as T;
}

export function calculateHash(file: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash("sha256");
		const stream = fss.createReadStream(file);
		stream.on("error", (err) => reject(err));
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve(hash.digest("hex")));
	});
}

export default {
	sizeOf,
	ensureEmptyDir,
	readJson,
	calculateHash,
};
