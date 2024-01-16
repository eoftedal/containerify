#!/usr/bin/env node

import * as os from "os";
import { program } from "commander";
import * as path from "path";
import * as fse from "fs-extra";
import * as fs from "fs";

import { DEFAULT_DOCKER_REGISTRY, createRegistry, processToken, parseFullImageUrl } from "./registry";
import appLayerCreator from "./appLayerCreator";
import dockerExporter from "./dockerExporter";
import tarExporter from "./tarExporter";

import logger from "./logger";
import { InsecureRegistrySupport, Options } from "./types";
import { omit, getPreferredPlatform } from "./utils";
import { ensureEmptyDir } from "./fileutil";
import { VERSION } from "./version";

const possibleArgs = {
	"--from <registry/image:tag>": "Optional: Shorthand to specify fromRegistry and fromImage in one argument",
	"--to <registry/image:tag>": "Optional: Shorthand to specify toRegistry and toImage in one argument",
	"--fromImage <name:tag>": "Required: Image name of base image - [path/]image:tag",
	"--toImage <name:tag>": "Required: Image name of target image - [path/]image:tag",
	"--folder <full path>": "Required: Base folder of node application (contains package.json)",
	"--file <path>": "Optional: Name of configuration file (defaults to containerify.json if found on path)",
	"--doCrossMount <true/false>":
		"Optional: Cross mount image layers from the base image (only works if fromImage and toImage are in the same registry) (default: false)",
	"--fromRegistry <registry url>":
		"Optional: URL of registry to pull base image from - Default: https://registry-1.docker.io/v2/",
	"--fromToken <token>": "Optional: Authentication token for from registry",
	"--toRegistry <registry url>":
		"Optional: URL of registry to push base image to - Default: https://registry-1.docker.io/v2/",
	"--optimisticToRegistryCheck":
		"Treat redirects as layer existing in remote registry. Potentially unsafe, but can save bandwidth.",
	"--toToken <token>": "Optional: Authentication token for target registry",
	"--toTar <path>": "Optional: Export to tar file",
	"--toDocker": "Optional: Export to local docker registry",
	"--registry <path>": "Optional: Convenience argument for setting both from and to registry",
	"--platform <platform>": "Optional: Preferred platform, e.g. linux/amd64 or arm64",
	"--token <path>": "Optional: Convenience argument for setting token for both from and to registry",
	"--user <user>": "Optional: User account to run process in container - default: 1000 (empty for customContent)",
	"--workdir <directory>":
		"Optional: Workdir where node app will be added and run from - default: /app (empty for customContent)",
	"--entrypoint <entrypoint>":
		"Optional: Entrypoint when starting container - default: npm start (empty for customContent)",
	"--labels <labels>": "Optional: Comma-separated list of key value pairs to use as labels",
	"--label <label>": "Optional: Single label (name=value). This option can be used multiple times.",
	"--envs <envs>": "Optional: Comma-separated list of key value pairs to use av environment variables.",
	"--env <env>": "Optional: Single environment variable (name=value). This option can be used multiple times.",
	"--setTimeStamp <timestamp>":
		"Optional: Set a specific ISO 8601 timestamp on all entries (e.g. git commit hash). Default: 1970 in tar files, and current time on manifest/config",
	"--verbose": "Verbose logging",
	"--allowInsecureRegistries": "Allow insecure registries (with self-signed/untrusted cert)",
	"--customContent <dirs/files>":
		"Optional: Skip normal node_modules and applayer and include specified root folder files/directories instead. You can specify as local-path:absolute-container-path if you want to place it in a specific location",
	"--extraContent <dirs/files>":
		"Optional: Add specific content. Specify as local-path:absolute-container-path,local-path2:absolute-container-path2 etc",
	"--layerOwner <gid:uid>": "Optional: Set specific gid and uid on files in the added layers",
	"--buildFolder <path>": "Optional: Use a specific build folder when creating the image",
	"--layerCacheFolder <path>": "Optional: Folder to cache base layers between builds",
	"--version": "Get containerify version",
} as const;

function setKeyValue(target: Record<string, string>, keyValue: string, separator = "=", defaultValue?: string) {
	const [k, v] = keyValue.split(separator, 2);
	target[k.trim()] = v?.trim() ?? defaultValue;
}

const cliLabels: Record<string, string> = {};
program.on("option:label", (ops: string) => {
	setKeyValue(cliLabels, ops);
});

const cliEnv: Record<string, string> = {};
program.on("option:env", (ops: string) => {
	setKeyValue(cliEnv, ops);
});

const cliOptions = Object.entries(possibleArgs)
	.reduce((program, [k, v]) => {
		program.option(k, v);
		return program;
	}, program)
	.parse()
	.opts();

if (cliOptions.version) {
	console.log(`containerify v${VERSION}`);
	process.exit(0);
}

const keys = Object.keys(possibleArgs).map((k) => k.split(" ")[0].replace("--", ""));

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
cliOptions.labels?.split(",")?.forEach((x: string) => setKeyValue(labelsOpt, x));
Object.keys(labelsOpt)
	.filter((l) => Object.keys(cliLabels).includes(l))
	.forEach((l) => {
		exitWithErrorIf(true, `Label ${l} specified both with --labels and --label`);
	});

const labels = { ...configFromFile.labels, ...labelsOpt, ...cliLabels }; //Let cli arguments override file

const envOpt: Record<string, string> = {};
cliOptions.envs?.split(",")?.forEach((x: string) => setKeyValue(envOpt, x));
Object.keys(envOpt)
	.filter((l) => Object.keys(cliEnv).includes(l))
	.forEach((l) => {
		exitWithErrorIf(true, `Env ${l} specified both with --envs and --env`);
	});

const envs = { ...configFromFile.envs, ...envOpt, ...cliEnv }; //Let cli arguments override file

const customContent: Record<string, string> = {};
configFromFile.customContent?.forEach((c: string) => setKeyValue(customContent, c, ":", c));
cliOptions.customContent?.split(",").forEach((c: string) => setKeyValue(customContent, c, ":", c));

const cliExtraContent: Record<string, string> = {};
cliOptions.extraContent?.split(",").forEach((x: string) => setKeyValue(cliExtraContent, x, ":"));

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
};

function exitWithErrorIf(check: boolean, error: string) {
	if (check) {
		logger.error("ERROR: " + error);
		program.help({ error: true });
	}
}

if (options.verbose) logger.enableDebug();

exitWithErrorIf(!!options.registry && !!options.fromRegistry, "Do not set both --registry and --fromRegistry");
exitWithErrorIf(!!options.from && !!options.fromRegistry, "Do not set both --from and --fromRegistry");
exitWithErrorIf(!!options.registry && !!options.from, "Do not set both --registry and --from");

exitWithErrorIf(!!options.registry && !!options.toRegistry, "Do not set both --registry and --toRegistry");
exitWithErrorIf(!!options.to && !!options.toRegistry, "Do not set both --toRegistry and --to");
exitWithErrorIf(!!options.registry && !!options.to, "Do not set both --registry and --to");
console.log(options);
console.log("MOADHAO", options.from, options.to);
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
exitWithErrorIf(!!options.toRegistry && !options.toToken, "A token must be given when uploading to docker hub");

if (options.toRegistry && !options.toRegistry.endsWith("/")) options.toRegistry += "/";
if (options.fromRegistry && !options.fromRegistry.endsWith("/")) options.fromRegistry += "/";

if (!options.fromRegistry && !options.fromImage?.split(":")?.[0]?.includes("/")) {
	options.fromImage = "library/" + options.fromImage;
}

Object.keys(options.customContent).forEach((p) => {
	exitWithErrorIf(!fs.existsSync(p), "Could not find " + p + " in the base folder " + options.folder);
});

if (options.layerCacheFolder) {
	if (!fs.existsSync(options.layerCacheFolder)) {
		try {
			logger.info(`Layer cache folder does not exist. Creating ${options.layerCacheFolder} ...`);
			fs.mkdirSync(options.layerCacheFolder, { recursive: true });
		} catch (e) {
			exitWithErrorIf(true, "Failed to create layer cache folder");
		}
	}
	if (!options.layerCacheFolder.endsWith("/")) {
		options.layerCacheFolder += "/";
	}
}

Object.keys(options.extraContent).forEach((k) => {
	exitWithErrorIf(!fs.existsSync(options.folder + k), "Could not find `" + k + "` in the folder " + options.folder);
});

async function run(options: Options) {
	if (!(await fse.pathExists(options.folder))) throw new Error("No such folder: " + options.folder);

	const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "containerify-"));
	logger.debug("Using " + tmpdir);
	const fromdir = await ensureEmptyDir(path.join(tmpdir, "from"));
	const todir = await ensureEmptyDir(path.join(tmpdir, "to"));
	const allowInsecure = options.allowInsecureRegistries ? InsecureRegistrySupport.YES : InsecureRegistrySupport.NO;
	const fromRegistryUrl = options.fromRegistry ?? DEFAULT_DOCKER_REGISTRY;
	const fromRegistry = createRegistry(
		fromRegistryUrl,
		await processToken(fromRegistryUrl, allowInsecure, options.fromImage, options.fromToken),
		allowInsecure,
	);
	const originalManifest = await fromRegistry.download(
		options.fromImage,
		fromdir,
		getPreferredPlatform(options.platform),
		options.layerCacheFolder,
	);

	await appLayerCreator.addLayers(tmpdir, fromdir, todir, options);

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
		const toRegistry = createRegistry(
			options.toRegistry,
			await processToken(options.toRegistry, allowInsecure, options.toImage, options.toToken),
			allowInsecure,
			options.optimisticToRegistryCheck,
		);
		await toRegistry.upload(options.toImage, todir, options.doCrossMount, originalManifest, options.fromImage);
	}
	logger.debug("Deleting " + tmpdir + " ...");
	await fse.remove(tmpdir);
	logger.debug("Done");
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
