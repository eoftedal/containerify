import { promises as fs } from "fs";
import * as fse from "fs-extra";
import * as fss from "fs";

export async function sizeOf(file: string) {
	return (await fs.lstat(file)).size;
}

export async function ensureEmptyDir(path: string) {
	if (fss.existsSync(path)) await fse.remove(path);
	await fs.mkdir(path);
	return path;
}
export default {
	sizeOf,
	ensureEmptyDir,
};
