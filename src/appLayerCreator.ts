import * as tar from "tar";
import type { WriteEntry } from "tar";
import { promises as fs } from "fs";
import * as fss from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { createGunzip } from "node:zlib";

import * as fileutil from "./fileutil";
import logger from "./logger";
import { Config, HealthCheck, Layer, Manifest, ManifestDescriptor, Options } from "./types";
import { getManifestLayerType, getLayerTypeFileEnding, getHash, unique } from "./utils";
import { VERSION } from "./version";

const depLayerPossibles = ["package.json", "package-lock.json", "node_modules"];

const ignore = [".git", ".gitignore", ".npmrc", ".DS_Store", "npm-debug.log", ".svn", ".hg", "CVS"];

function createOnWriteEntry(options: Options) {
	if (!options.layerOwner) return undefined;
	// Format is already validated in cli.ts to be "gid:uid"
	const parts = options.layerOwner.split(":");
	const gid = parseInt(parts[0], 10);
	const uid = parseInt(parts[1], 10);
	// node-tar builds the entry header from `entry.stat` (onWriteEntry runs before
	// entry.header exists), so we mutate the stat here. With layerOwner set the
	// archive is non-portable, which means atime/ctime get written (into a PAX
	// header) from the file's real - and therefore non-deterministic - stat. Pin
	// atime/ctime/mtime so builds stay reproducible, while honoring the timestamp
	// options for mtime instead of unconditionally forcing epoch (which used to
	// silently discard --setTimeStamp / --preserveTimeStamp).
	const stamp = options.setTimeStamp ? new Date(options.setTimeStamp) : undefined;
	const forceEpoch = !options.setTimeStamp && !options.preserveTimeStamp;
	return (entry: WriteEntry) => {
		if (!entry.stat) return;
		entry.stat.uid = uid;
		entry.stat.gid = gid;
		entry.myuser = ""; // force an empty uname regardless of the building user
		if (forceEpoch) {
			const epoch = new Date(0);
			entry.mtime = epoch;
			entry.stat.mtime = epoch;
			entry.stat.atime = epoch;
			entry.stat.ctime = epoch;
		} else if (stamp) {
			entry.mtime = stamp;
			entry.stat.mtime = stamp;
			entry.stat.atime = stamp;
			entry.stat.ctime = stamp;
		} else {
			// --preserveTimeStamp: keep the original mtime, but pin atime/ctime to it
			// so the (non-portable) archive stays reproducible.
			entry.stat.atime = entry.stat.mtime;
			entry.stat.ctime = entry.stat.mtime;
		}
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

function copySync(src: string, dest: string, preserveTimestamps: boolean) {
	logger.debug(`Copying ${src} to ${dest}`);
	fss.mkdirSync(path.dirname(dest), { recursive: true });
	fss.cpSync(src, dest, { recursive: true, dereference: true, force: true, preserveTimestamps });
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
		const gunzip = createGunzip();
		gunzip.on("data", (chunk) => hash.update(chunk));
		gunzip.on("end", () => resolve(hash.digest("hex")));
		gunzip.on("error", (err) => reject(err));
		fss
			.createReadStream(file)
			.on("error", (err) => reject(err))
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
				onWriteEntry: createOnWriteEntry(options),
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
	const fhash = await fileutil.calculateHash(layerFile);
	const finalName = path.join(todir, fhash + ".tar.gz");
	await fs.rename(layerFile, finalName);
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
			const file = getHash(layer.digest) + getLayerTypeFileEnding(layer);
			await fs.copyFile(path.join(fromdir, file), path.join(todir, file));
		}),
	);
}

function parseCommandLineToParts(entrypoint: string) {
	return entrypoint
		.split('"')
		.map((p, i) => (i % 2 == 1 ? [p] : p.split(" ")))
		.flat()
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
		await addExposeLayer(options, config);
		await addHealthcheckLayer(options, config);
		await addDataLayer(tmpdir, todir, options, config, manifest, Object.entries(options.customContent), "custom");
	} else {
		await addWorkdirLayer(options, config, options.workdir);
		await addEntrypointLayer(options, config, options.entrypoint);
		await addUserLayer(options, config, options.user);
		await addEnvsLayer(options, config);
		await addLabelsLayer(options, config);
		await addExposeLayer(options, config);
		await addHealthcheckLayer(options, config);
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

async function addExposeLayer(options: Options, config: Config) {
	if (options.expose && options.expose.length > 0) {
		const exposedPorts: Record<string, Record<string, never>> = {};
		for (const port of options.expose) {
			const portKey = port.includes("/") ? port : `${port}/tcp`;
			exposedPorts[portKey] = {};
		}
		addEmptyLayer(config, options, `EXPOSE ${options.expose.join(" ")}`, (config) => {
			config.config.ExposedPorts = { ...(config.config.ExposedPorts ?? {}), ...exposedPorts };
		});
	}
}

function parseDuration(duration: string): number {
	const match = duration.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
	if (!match) return 0;
	const hours = parseInt(match[1] || "0", 10);
	const minutes = parseInt(match[2] || "0", 10);
	const seconds = parseInt(match[3] || "0", 10);
	return (hours * 3600 + minutes * 60 + seconds) * 1_000_000_000;
}

async function addHealthcheckLayer(options: Options, config: Config) {
	if (!options.healthcheckCmd) return;
	const healthcheck: HealthCheck = {
		Test: ["CMD-SHELL", options.healthcheckCmd],
	};
	if (options.healthcheckInterval) healthcheck.Interval = parseDuration(options.healthcheckInterval);
	if (options.healthcheckTimeout) healthcheck.Timeout = parseDuration(options.healthcheckTimeout);
	if (options.healthcheckStartPeriod) healthcheck.StartPeriod = parseDuration(options.healthcheckStartPeriod);
	if (options.healthcheckStartInterval) healthcheck.StartInterval = parseDuration(options.healthcheckStartInterval);
	if (options.healthcheckRetries) healthcheck.Retries = parseInt(options.healthcheckRetries, 10);
	addEmptyLayer(config, options, `HEALTHCHECK CMD ${options.healthcheckCmd}`, (config) => {
		config.config.Healthcheck = healthcheck;
	});
}

async function addEnvsLayer(options: Options, config: Config) {
	if (options.envs.length > 0) {
		// Keep old environment variables. Compute the merged list once from the
		// base Env (which may be missing on some base configs) and assign it to
		// both config and container_config.
		const mergedEnv = unique([...(config.config.Env ?? []), ...options.envs]);
		addEmptyLayer(config, options, `ENV ${JSON.stringify(options.envs)}`, (config) => {
			config.config.Env = mergedEnv;
			config.container_config.Env = mergedEnv;
		});
	}
}

async function addLayers(
	tmpdir: string,
	fromdir: string,
	todir: string,
	options: Options,
): Promise<ManifestDescriptor> {
	logger.info("Parsing image ...");
	const manifest = await fileutil.readJson<Manifest>(path.join(fromdir, "manifest.json"));
	const config = await fileutil.readJson<Config>(path.join(fromdir, "config.json"));
	config.container_config = config.container_config || ({} as Config["container_config"]);
	config.config = config.config || ({} as Config["config"]);
	config.history = config.history || [];

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
	const manifestJson = JSON.stringify(manifest);
	await fs.writeFile(path.join(todir, "manifest.json"), manifestJson);
	const manifestBuffer = Buffer.from(manifestJson, "utf-8");
	return {
		mediaType: manifest.mediaType,
		// Return the digest with the sha256: prefix, consistent with Descriptor
		// everywhere else. The legacy --writeDigestTo strips it at the write site.
		digest: "sha256:" + calculateHashOfBuffer(manifestBuffer),
		size: manifestBuffer.byteLength,
	};
}

export default {
	addLayers,
};
