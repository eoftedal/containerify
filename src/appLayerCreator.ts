import * as tar from "tar";
import { promises as fs } from "fs";
import * as fse from "fs-extra";
import * as fss from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Gunzip } from "minizlib";

import * as fileutil from "./fileutil";
import logger from "./logger";
import { Config, Layer, Manifest, Options } from "./types";
import { getManifestLayerType, getLayerTypeFileEnding, unique } from "./utils";
import { VERSION } from "./version";

const depLayerPossibles = ["package.json", "package-lock.json", "node_modules"];

const ignore = [".git", ".gitignore", ".npmrc", ".DS_Store", "npm-debug.log", ".svn", ".hg", "CVS"];

function statCache(layerOwner?: string) {
	if (!layerOwner) return null;
	// We use the stat cache to overwrite uid and gid in image.
	// A bit hacky
	const statCacheMap = new Map();
	const a = layerOwner.split(":");
	const gid = parseInt(a[0]);
	const uid = parseInt(a[1]);
	return {
		get: function (name: string) {
			if (statCacheMap.has(name)) return statCacheMap.get(name);
			const stat = fss.statSync(name);
			stat.uid = uid;
			stat.gid = gid;
			stat.atime = new Date(0);
			stat.mtime = new Date(0);
			stat.ctime = new Date(0);
			stat.birthtime = new Date(0);
			stat.atimeMs = 0;
			stat.mtimeMs = 0;
			stat.ctimeMs = 0;
			stat.birthtimeMs = 0;
			statCacheMap.set(name, stat);
			return stat;
		},
		set: function (name: string, stat: ReturnType<(typeof fss)["statSync"]>) {
			statCacheMap.set(name, stat);
		},
		has: function () {
			return true;
		},
	};
}

const tarDefaultConfig = {
	preservePaths: false,
	follow: true,
};

function calculateHashOfBuffer(buf: Buffer): string {
	const hash = crypto.createHash("sha256");
	hash.update(buf);
	return hash.digest("hex");
}

function calculateHash(path: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash("sha256");
		const stream = fss.createReadStream(path);
		stream.on("error", (err) => reject(err));
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve(hash.digest("hex")));
	});
}

function copySync(src: string, dest: string, preserveTimestamps: boolean) {
	const copyOptions = { overwrite: true, dereference: true, preserveTimestamps: preserveTimestamps};
	const destFolder = dest.substring(0, dest.lastIndexOf("/"));
	logger.debug(`Copying ${src} to ${dest}`);
	fse.ensureDirSync(destFolder);
	fse.copySync(src, dest, copyOptions);
}

function addEmptyLayer(config: Config, options: Options, operation: string, action: (config: Config) => void) {
	logger.info(`Applying ${operation}`);
	config.history.push({
		created: options.setTimeStamp || new Date().toISOString(),
		created_by: "/bin/sh -c #(nop) " + operation,
		empty_layer: true,
	});
	action(config);
}

async function getHashOfUncompressed(file: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash("sha256");
		const gunzip = new Gunzip({});
		gunzip.on("data", (chunk) => hash.update(chunk));
		gunzip.on("end", () => resolve(hash.digest("hex")));
		gunzip.on("error", (err) => reject(err));
		fss
			.createReadStream(file)
			.pipe(gunzip)
			.on("error", (err) => reject(err));
	});
}

async function addDataLayer(
	tmpdir: string,
	todir: string,
	options: Options,
	config: Config,
	manifest: Manifest,
	files: Array<string | Array<string>>,
	comment: string,
) {
	logger.info("Adding layer for " + comment + " ...");
	const buildDir = await fileutil.ensureEmptyDir(path.join(tmpdir, "build"));
	files.map((f) => {
		if (Array.isArray(f)) {
			copySync(path.join(options.folder, f[0]), path.join(buildDir, f[1]), !!options.preserveTimeStamp);
		} else {
			copySync(path.join(options.folder, f), path.join(buildDir, options.workdir, f), !!options.preserveTimeStamp);
		}
	});
	const layerFile = path.join(todir, "layer.tar.gz");
	if (options.layerOwner) logger.info("Setting file ownership to: " + options.layerOwner);
	const filesToTar = fss.readdirSync(buildDir);
	if (filesToTar.length == 0) {
		throw new Error(
			"No files found for layer: " +
				comment +
				(comment == "dependencies" ? ". Did you forget to run npm install?" : ""),
		);
	}
	await tar.create(
		{
			...tarDefaultConfig,
			...{
				statCache: statCache(options.layerOwner),
				portable: !options.layerOwner,
				prefix: "/",
				cwd: buildDir,
				file: layerFile,
				gzip: true,
				noMtime: !(options.setTimeStamp || options.preserveTimeStamp),
				...(options.setTimeStamp ? { mtime: new Date(options.setTimeStamp) } : {}),
			},
		},
		filesToTar,
	);
	const fhash = await calculateHash(layerFile);
	const finalName = path.join(todir, fhash + ".tar.gz");
	await fse.move(layerFile, finalName);
	manifest.layers.push({
		mediaType: getManifestLayerType(manifest),
		size: await fileutil.sizeOf(finalName),
		digest: "sha256:" + fhash,
	});
	const dhash = await getHashOfUncompressed(finalName);
	config.rootfs.diff_ids.push("sha256:" + dhash);
	config.history.push({
		created: options.setTimeStamp || new Date().toISOString(),
		created_by: `containerify:${VERSION}`,
		comment: comment,
	});
}

async function copyLayers(fromdir: string, todir: string, layers: Array<Layer>) {
	await Promise.all(
		layers.map(async (layer) => {
			const file = layer.digest.split(":")[1] + getLayerTypeFileEnding(layer);
			await fse.copy(path.join(fromdir, file), path.join(todir, file));
		}),
	);
}

function parseCommandLineToParts(entrypoint: string) {
	return entrypoint
		.split('"')
		.map((p, i) => {
			if (i % 2 == 1) return [p];
			return p.split(" ");
		})
		.reduce((a, b) => a.concat(b), [])
		.filter((a) => a != "");
}

async function addAppLayers(options: Options, config: Config, todir: string, manifest: Manifest, tmpdir: string) {
	if (Object.entries(options.customContent).length > 0) {
		// We only add these layers if they have been explicitely set for customContent. This allows customContent
		// to be used to add compiled frontend code to an nginx container without also modifying the entrypoint, user,
		// and workdir.
		if (options.nonDefaults.workdir) await addWorkdirLayer(options, config, options.nonDefaults.workdir);
		if (options.nonDefaults.entrypoint) await addEntrypointLayer(options, config, options.nonDefaults.entrypoint);
		if (options.nonDefaults.user) await addUserLayer(options, config, options.nonDefaults.user);
		await addEnvsLayer(options, config);
		await addLabelsLayer(options, config);
		await addDataLayer(tmpdir, todir, options, config, manifest, Object.entries(options.customContent), "custom");
	} else {
		await addWorkdirLayer(options, config, options.workdir);
		await addEntrypointLayer(options, config, options.entrypoint);
		await addUserLayer(options, config, options.user);
		await addEnvsLayer(options, config);
		await addLabelsLayer(options, config);
		const appFiles = (await fs.readdir(options.folder)).filter((l) => !ignore.includes(l));
		const depLayerContent = appFiles.filter((l) => depLayerPossibles.includes(l));
		const appLayerContent = appFiles.filter((l) => !depLayerPossibles.includes(l));

		await addDataLayer(tmpdir, todir, options, config, manifest, depLayerContent, "dependencies");
		await addDataLayer(tmpdir, todir, options, config, manifest, appLayerContent, "app");
	}
	for (const extraContent of Object.entries(options.extraContent)) {
		await addDataLayer(tmpdir, todir, options, config, manifest, [extraContent], "extra");
	}
}
async function addWorkdirLayer(options: Options, config: Config, workdir: string) {
	addEmptyLayer(config, options, `WORKDIR ${workdir}`, (config) => (config.config.WorkingDir = workdir));
}
async function addEntrypointLayer(options: Options, config: Config, entrypoint: string) {
	const entrypointParts = parseCommandLineToParts(entrypoint);
	addEmptyLayer(
		config,
		options,
		`ENTRYPOINT ${JSON.stringify(entrypoint)}`,
		(config) => (config.config.Entrypoint = entrypointParts),
	);
}
async function addUserLayer(options: Options, config: Config, user: string) {
	addEmptyLayer(config, options, `USER ${user}`, (config) => {
		config.config.User = user;
		config.container_config.User = user;
	});
}

async function addLabelsLayer(options: Options, config: Config) {
	if (Object.keys(options.labels).length > 0) {
		addEmptyLayer(config, options, `LABELS ${JSON.stringify(options.labels)}`, (config) => {
			config.config.Labels = options.labels;
			config.container_config.Labels = options.labels;
		});
	}
}

async function addEnvsLayer(options: Options, config: Config) {
	if (options.envs.length > 0) {
		addEmptyLayer(config, options, `ENV ${JSON.stringify(options.envs)}`, (config) => {
			// Keep old environment variables
			config.config.Env = unique([...config.config.Env, ...options.envs]);
			config.container_config.Env = unique([...config.config.Env, ...options.envs]);
		});
	}
}

async function addLayers(tmpdir: string, fromdir: string, todir: string, options: Options) {
	logger.info("Parsing image ...");
	const manifest = await fse.readJson(path.join(fromdir, "manifest.json"));
	const config = await fse.readJson(path.join(fromdir, "config.json"));
	config.container_config = config.container_config || {};

	logger.info("Adding new layers...");
	await copyLayers(fromdir, todir, manifest.layers);
	await addAppLayers(options, config, todir, manifest, tmpdir);

	logger.info("Writing final image...");
	const configContent = Buffer.from(JSON.stringify(config));
	const configHash = calculateHashOfBuffer(configContent);
	const configFile = path.join(todir, configHash + ".json");
	await fs.writeFile(configFile, configContent);
	manifest.config.digest = "sha256:" + configHash;
	manifest.config.size = await fileutil.sizeOf(configFile);
	await fs.writeFile(path.join(todir, "manifest.json"), JSON.stringify(manifest));
}

export default {
	addLayers,
};
