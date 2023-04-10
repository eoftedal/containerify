import tar = require("tar");
import { promises as fs } from "fs";
import * as fse from "fs-extra";
import * as path from "path";
import { Options, type Manifest } from "./types";
import logger from "./logger";

const tarDefaultConfig = {
	preservePaths: false,
	portable: true,
	follow: true,
};

async function saveToTar(fromdir: string, tmpdir: string, toPath: string, repoTags: string[], options: Options) {
	if (options.tarFormat == "oci") {
		return saveToOCITar(fromdir, tmpdir, toPath, repoTags, options);
	}
	return saveToDockerTar(fromdir, tmpdir, toPath, repoTags, options);
}

async function saveToOCITar(fromdir: string, tmpdir: string, toPath: string, repoTags: string[], options: Options) {
	return saveToDockerTar(fromdir, tmpdir, toPath, repoTags, options);
}

async function saveToDockerTar(fromdir: string, tmpdir: string, toPath: string, repoTags: string[], options: Options) {
	logger.info("Creating " + toPath + " ...");

	const targetFolder = path.dirname(toPath);
	await fs.access(targetFolder).catch(async () => await fs.mkdir(targetFolder, { recursive: true }));

	const manifestFile = path.join(fromdir, "manifest.json");
	const manifest = (await fse.readJson(manifestFile)) as Manifest;
	const configFile = path.join(fromdir, manifest.config.digest.split(":")[1] + ".json");
	const config = await fse.readJson(configFile);

	const tardir = path.join(tmpdir, "totar");
	await fs.mkdir(tardir);
	const layers = await Promise.all(
		manifest.layers
			.map((x) => x.digest.split(":")[1])
			.map(async (x) => {
				const fn = x + ((await fse.pathExists(path.join(fromdir, x + ".tar.gz"))) ? ".tar.gz" : ".tar");
				await fse.copy(path.join(fromdir, fn), path.join(tardir, fn));
				return fn;
			}),
	);

	const simpleManifest = [
		{
			config: "config.json",
			repoTags: repoTags,
			layers: layers,
		},
	];
	await fs.writeFile(path.join(tardir, "manifest.json"), JSON.stringify(simpleManifest));
	await fs.writeFile(path.join(tardir, "config.json"), JSON.stringify(config));
	await tar.c(
		{
			...tarDefaultConfig,
			...{
				cwd: tardir,
				file: toPath,
				noMtime: !options.setTimeStamp,
				...(options.setTimeStamp ? { mtime: new Date(options.setTimeStamp) } : {}),
			},
		},
		["config.json", "manifest.json"].concat(layers),
	);
	logger.info("Finished " + toPath);
}

export default {
	saveToTar,
};
