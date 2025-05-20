#!/usr/bin/env node

import * as os from "os";
import { Command } from "commander";
import * as path from "path";
import * as fse from "fs-extra";
import * as fs from "fs";

import { DEFAULT_DOCKER_REGISTRY, createRegistry, parseFullImageUrl } from "./registry";
import appLayerCreator from "./appLayerCreator";
import dockerExporter from "./dockerExporter";
import tarExporter from "./tarExporter";

import logger from "./logger";
import { InsecureRegistrySupport, Options } from "./types";
import { omit, getPreferredPlatform } from "./utils";
import { ensureEmptyDir } from "./fileutil";
import { VERSION } from "./version";

const program = new Command();

program
	.name("containerify")
	.description("A CLI-tool for creating container images.")
	.option("--from <registry/image:tag>", "Optional: Shorthand to specify fromRegistry and fromImage in one argument")
	.option("--to <registry/image:tag>", "Optional: Shorthand to specify toRegistry and toImage in one argument")
	.option("--fromImage <name:tag>", "Required: Image name of base image - [path/]image:tag")
	.option("--toImage <name:tag>", "Required: Image name of target image - [path/]image:tag")
	.option("--folder <full path>", "Required: Base folder of node application (contains package.json)")
	.option("--file <path>", "Optional: Name of configuration file (defaults to containerify.json if found on path)")
	.option(
		"--doCrossMount",
		"Optional: Cross mount image layers from the base image (only works if fromImage and toImage are in the same registry) (default, false)",
	)
	.option(
		"--fromRegistry <registry url>",
		"Optional: URL of registry to pull base image from - Default, https,//registry-1.docker.io/v2/",
	)
	.option("--fromToken <token>", "Optional: Authentication token for from registry")
	.option(
		"--toRegistry <registry url>",
		"Optional: URL of registry to push base image to - Default, https,//registry-1.docker.io/v2/",
	)
	.option(
		"--optimisticToRegistryCheck",
		"Treat redirects as layer existing in remote registry. Potentially unsafe) but can save bandwidth.",
	)
	.option("--toToken <token>", "Optional: Authentication token for target registry")
	.option("--toTar <path>", "Optional: Export to tar file")
	.option("--toDocker", "Optional: Export to local docker registry")
	.option("--registry <path>", "Optional: Convenience argument for setting both from and to registry")
	.option("--platform <platform>", "Optional: Preferred platform) e.g. linux/amd64 or arm64")
	.option("--token <path>", "Optional: Convenience argument for setting token for both from and to registry")
	.option(
		"--user <user>",
		"Optional: User account to run process in container - default, 1000 (empty for customContent)",
	)
	.option(
		"--workdir <directory>",
		"Optional: Workdir where node app will be added and run from - default, /app (empty for customContent)",
	)
	.option(
		"--entrypoint <entrypoint>",
		"Optional: Entrypoint when starting container - default, npm start (empty for customContent)",
	)
	.option("--label, --labels <labels...>", "Optional: Comma-separated list of key value pairs to use as labels")
	.option(
		"--env, --envs <envs...>",
		"Optional: Comma-separated list of key value pairs to use av environment variables.",
	)
	.option(
		"--preserveTimeStamp",
		"Optional: Preserve timestamps on files in the added layers. This might help with cache invalidation.",
	)
	.option(
		"--setTimeStamp <timestamp>",
		"Optional: Set a specific ISO 8601 timestamp on all entries (e.g. git commit hash). Default, 1970 in tar files) and current time on manifest/config",
	)
	.option("--verbose", "Verbose logging")
	.option("--allowInsecureRegistries", "Allow insecure registries (with self-signed/untrusted cert)")
	.option("--allowNoPushAuth", "Allow pushing images without a authentication/token to registries that allow it")
	.option(
		"--customContent <dirs/files...>",
		"Optional: Skip normal node_modules and applayer and include specified root folder files/directories instead. You can specify as local-path,absolute-container-path if you want to place it in a specific location",
	)
	.option(
		"--extraContent <dirs/files...>",
		"Optional: Add specific content. Specify as local-path,absolute-container-path)local-path2,absolute-container-path2 etc",
	)
	.option("--layerOwner <gid:uid>", "Optional: Set specific gid and uid on files in the added layers")
	.option("--buildFolder <path>", "Optional: Use a specific build folder when creating the image")
	.option("--layerCacheFolder <path>", "Optional: Folder to cache base layers between builds")
	.option("--writeDigestTo <path>", "Optional: Write the resulting image digest to the file path provided")
	.version(VERSION, "--version", "Get containerify version");

program.parse(process.argv);

function setKeyValue(target: Record<string, string>, keyValue: string, separator = "=", defaultValue?: string) {
	const [k, v] = keyValue.split(separator, 2);
	target[k.trim()] = v?.trim() ?? defaultValue;
}

const cliOptions = program.opts();
const keys = program.options.map((x) => x.long?.replace("--", ""));

const defaultOptions = {
	workdir: "/app",
	user: "1000",
	entrypoint: "npm start",
	doCrossMount: false,
};

if (cliOptions.file && !fs.existsSync(cliOptions.file)) {
	logger.error(`Config file '${cliOptions.file}' not found`);
	process.exit(1);
}

if (!cliOptions.file && fs.existsSync(`${cliOptions.folder}/containerify.json`)) {
	cliOptions.file = "containerify.json";
}

const configFromFile = cliOptions.file ? JSON.parse(fs.readFileSync(cliOptions.file, "utf-8")) : {};
Object.keys(configFromFile).forEach((k) => {
	if (!keys.includes(k)) {
		logger.error(`Unknown option in config-file '${cliOptions.file}': ${k}`);
		process.exit(1);
	}
});

const labelsOpt: Record<string, string> = {};
cliOptions.labels?.forEach((labels: string) =>
	labels.split(",").forEach((label: string) => setKeyValue(labelsOpt, label)),
);
const labels = { ...configFromFile.labels, ...labelsOpt }; //Let cli arguments override file

const envOpt: Record<string, string> = {};
cliOptions.envs?.forEach((envs: string) => envs.split(",").forEach((env: string) => setKeyValue(envOpt, env)));
const envs = { ...configFromFile.envs, ...envOpt }; //Let cli arguments override file

const customContent: Record<string, string> = {};
configFromFile.customContent?.forEach((c: string) => setKeyValue(customContent, c, ":", c));
cliOptions.customContent?.forEach((contents: string) =>
	contents.split(",").forEach((content: string) => setKeyValue(customContent, content, ":", content)),
);

const cliExtraContent: Record<string, string> = {};
cliOptions.extraContent?.forEach((extras: string) =>
	extras.split(",").forEach((extra: string) => setKeyValue(cliExtraContent, extra, ":")),
);

const extraContent = { ...configFromFile.extraContent, ...cliExtraContent };

const cliParams: Record<string, string> = omit(cliOptions, [
	"label",
	"labels",
	"env",
	"envs",
	"customContent",
	"extraContent",
]);

const setOptions: Options = {
	...configFromFile,
	...cliParams,
	customContent,
	extraContent,
	labels,
	envs: Object.entries(envs).map(([k, v]) => `${k}=${v}`),
};

const options: Options = {
	...defaultOptions,
	...setOptions,
	nonDefaults: {
		user: setOptions.user,
		workdir: setOptions.workdir,
		entrypoint: setOptions.entrypoint,
	},
	writeDigestTo: cliOptions.writeDigestTo,
};

function exitWithErrorIf(check: boolean, error: string) {
	if (check) {
		logger.error("ERROR: " + error);
		program.help({ error: true });
	}
}

if (options.verbose) logger.enableDebug();

exitWithErrorIf(
	!!options.setTimeStamp && !!options.preserveTimeStamp,
	"Do not set both --preserveTimeStamp and --setTimeStamp",
);

exitWithErrorIf(!!options.registry && !!options.fromRegistry, "Do not set both --registry and --fromRegistry");
exitWithErrorIf(!!options.from && !!options.fromRegistry, "Do not set both --from and --fromRegistry");
exitWithErrorIf(!!options.registry && !!options.from, "Do not set both --registry and --from");

exitWithErrorIf(!!options.registry && !!options.toRegistry, "Do not set both --registry and --toRegistry");
exitWithErrorIf(!!options.to && !!options.toRegistry, "Do not set both --toRegistry and --to");
exitWithErrorIf(!!options.registry && !!options.to, "Do not set both --registry and --to");
if (options.from) {
	const { registry, image } = parseFullImageUrl(options.from);
	options.fromRegistry = registry;
	options.fromImage = image;
}
if (options.to) {
	const { registry, image } = parseFullImageUrl(options.to);
	options.toRegistry = registry;
	options.toImage = image;
}

exitWithErrorIf(!!options.token && !!options.fromToken, "Do not set both --token and --fromToken");
exitWithErrorIf(!!options.token && !!options.toToken, "Do not set both --token and --toToken");

exitWithErrorIf(
	!!options.doCrossMount && options.toRegistry != options.fromRegistry,
	`Cross mounting only works if fromRegistry and toRegistry are the same (${options.fromRegistry} != ${options.toRegistry})`,
);

if (options.setTimeStamp) {
	try {
		options.setTimeStamp = new Date(options.setTimeStamp).toISOString();
	} catch (e) {
		exitWithErrorIf(true, "Failed to parse date: " + e);
	}
	logger.info("Setting all dates to: " + options.setTimeStamp);
}

if (options.layerOwner) {
	if (!options.layerOwner.match("^[0-9]+:[0-9]+$")) {
		exitWithErrorIf(
			true,
			"layerOwner should be on format <number>:<number> (e.g. 1000:1000) but was: " + options.layerOwner,
		);
	}
}

if (options.registry) {
	options.fromRegistry = options.registry;
	options.toRegistry = options.registry;
}
if (options.token) {
	options.fromToken = options.token;
	options.toToken = options.token;
}

exitWithErrorIf(!options.folder, "--folder must be specified");
exitWithErrorIf(!options.fromImage, "--fromImage must be specified");
exitWithErrorIf(!options.toImage, "--toImage must be specified");
exitWithErrorIf(
	!options.toRegistry && !options.toTar && !options.toDocker,
	"Must specify either --toTar, --toRegistry or --toDocker",
);
exitWithErrorIf(
	!!options.toRegistry && !options.toToken && !options.allowNoPushAuth,
	"A token must be provided when uploading images",
);

if (options.toRegistry && !options.toRegistry.endsWith("/")) options.toRegistry += "/";
if (options.fromRegistry && !options.fromRegistry.endsWith("/")) options.fromRegistry += "/";

if (!options.fromRegistry && !options.fromImage?.split(":")?.[0]?.includes("/")) {
	options.fromImage = "library/" + options.fromImage;
}

Object.keys(options.customContent).forEach((p) => {
	exitWithErrorIf(!fs.existsSync(p), `Could not find ${p} in the base folder ${options.folder}`);
});

if (options.layerCacheFolder) {
	if (!fs.existsSync(options.layerCacheFolder)) {
		try {
			logger.info(`Layer cache folder does not exist. Creating ${options.layerCacheFolder} ...`);
			fs.mkdirSync(options.layerCacheFolder, { recursive: true });
		} catch (e) {
			exitWithErrorIf(true, `Failed to create layer cache folder ${e}`);
		}
	}
	if (!options.layerCacheFolder.endsWith("/")) {
		options.layerCacheFolder += "/";
	}
}

Object.keys(options.extraContent).forEach((k) => {
	exitWithErrorIf(!fs.existsSync(options.folder + k), `Could not find '${k}' in the folder ${options.folder}`);
});

async function run(options: Options) {
	if (!(await fse.pathExists(options.folder))) throw new Error(`No such folder: ${options.folder}`);

	const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "containerify-"));
	logger.debug("Using " + tmpdir);
	const fromdir = await ensureEmptyDir(path.join(tmpdir, "from"));
	const todir = await ensureEmptyDir(path.join(tmpdir, "to"));
	const allowInsecure = options.allowInsecureRegistries ? InsecureRegistrySupport.YES : InsecureRegistrySupport.NO;
	const fromRegistryUrl = options.fromRegistry ?? DEFAULT_DOCKER_REGISTRY;
	const fromRegistry = await createRegistry(fromRegistryUrl, options.fromImage, allowInsecure, options.fromToken);
	const originalManifest = await fromRegistry.download(
		options.fromImage,
		fromdir,
		getPreferredPlatform(options.platform),
		options.layerCacheFolder,
	);

	const manifestDescriptor = await appLayerCreator.addLayers(tmpdir, fromdir, todir, options);

	if (options.toDocker) {
		if (!(await dockerExporter.isAvailable())) {
			throw new Error("Docker executable not found on path. Unable to export to local docker registry.");
		}
		const dockerDir = path.join(tmpdir, "toDocker");
		await tarExporter.saveToTar(todir, tmpdir, dockerDir, [options.toImage], options);
		await dockerExporter.load(dockerDir);
	}
	if (options.toTar) {
		await tarExporter.saveToTar(todir, tmpdir, options.toTar, [options.toImage], options);
	}
	if (options.toRegistry) {
		const toRegistry = await createRegistry(
			options.toRegistry,
			options.toImage,
			allowInsecure,
			options.toToken,
			options.optimisticToRegistryCheck,
		);
		await toRegistry.upload(options.toImage, todir, options.doCrossMount, originalManifest, options.fromImage);
	}
	logger.debug(`Deleting ${tmpdir} ...`);
	await fse.remove(tmpdir);
	logger.debug("Done");
	if (options.writeDigestTo) {
		logger.debug(`Writing digest ${manifestDescriptor.digest} to ${options.writeDigestTo}`);
		fs.writeFileSync(options.writeDigestTo, manifestDescriptor.digest);
	}
}

logger.debug("Running with config:", options);

run(options as Options)
	.then(() => {
		logger.info("Done!");
		process.exit(0);
	})
	.catch((error) => {
		logger.error(error);
		process.exit(1);
	});
