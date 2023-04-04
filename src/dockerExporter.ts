import { promisify } from "node:util";
import { exec } from "node:child_process";

import logger from "./logger";

const execAsync = promisify(exec);

async function isAvailable() {
	try {
		await execAsync("docker -v");
	} catch (e) {
		return false;
	}
	return true;
}

async function load(path: string) {
	logger.info("Loading docker image from tarball...");
	await execAsync(`docker load -i ${path}`);
}

export default {
	isAvailable,
	load,
};
