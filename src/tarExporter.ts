import * as tar from "tar";
import { promises as fs } from "fs";
import * as fss from "fs";
import * as path from "path";
import { Config, Options, type Manifest } from "./types";
import * as fileutil from "./fileutil";
import logger from "./logger";

const tarDefaultConfig = {
	preservePaths: false,
	portable: true,
	follow: true,
};

async function saveToTar(fromdir: string, tmpdir: string, toPath: string, repoTags: string[], options: Options) {
	logger.info("Creating " + toPath + " ...");

	const targetFolder = path.dirname(toPath);
	await fs.access(targetFolder).catch(async () => await fs.mkdir(targetFolder, { recursive: true }));

	const manifestFile = path.join(fromdir, "manifest.json");
	const manifest = await fileutil.readJson<Manifest>(manifestFile);
	const configFile = path.join(fromdir, manifest.config.digest.split(":")[1] + ".json");
	const config = await fileutil.readJson<Config>(configFile);

	// ensureEmptyDir (not mkdir) so a second export in the same run - e.g.
	// --toDocker together with --toTar - doesn't crash with EEXIST on `totar`.
	const tardir = await fileutil.ensureEmptyDir(path.join(tmpdir, "totar"));
	const layers = await Promise.all(
		manifest.layers
			.map((x) => x.digest.split(":")[1])
			.map(async (x) => {
				const fn = x + (fss.existsSync(path.join(fromdir, x + ".tar.gz")) ? ".tar.gz" : ".tar");
				await fs.copyFile(path.join(fromdir, fn), path.join(tardir, fn));
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
	await tar.create(
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
