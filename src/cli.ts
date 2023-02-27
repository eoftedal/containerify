#!/usr/bin/env node

import * as os from "os";
import { program } from "commander";
import * as path from "path";
import * as fse from "fs-extra";
import * as fs from "fs";

import { createRegistry, createDockerRegistry } from "./registry";
import appLayerCreator from "./appLayerCreator";
import tarExporter from "./tarExporter";

import logger from "./logger";
import { Options } from "./types";
import { omit } from "./utils";
import { ensureEmptyDir } from "./fileutil";

const possibleArgs = {
	"--fromImage <name:tag>": "Required: Image name of base image - [path/]image:tag",
	"--toImage <name:tag>": "Required: Image name of target image - [path/]image:tag",
	"--folder <full path>": "Required: Base folder of node application (contains package.json)",
	"--file <path>": "Optional: Name of configuration file (defaults to doqr.json if found on path)",
	"--fromRegistry <registry url>":
		"Optional: URL of registry to pull base image from - Default: https://registry-1.docker.io/v2/",
	"--fromToken <token>": "Optional: Authentication token for from registry",
	"--toRegistry <registry url>":
		"Optional: URL of registry to push base image to - Default: https://registry-1.docker.io/v2/",
	"--toToken <token>": "Optional: Authentication token for target registry",
	"--toTar <path>": "Optional: Export to tar file",
	"--registry <path>": "Optional: Convenience argument for setting both from and to registry",
	"--token <path>": "Optional: Convenience argument for setting token for both from and to registry",
	"--user <user>": "Optional: User account to run process in container - default: 1000",
	"--workdir <directory>": "Optional: Workdir where node app will be added and run from - default: /app",
	"--entrypoint <entrypoint>": "Optional: Entrypoint when starting container - default: npm start",
	"--labels <labels>": "Optional: Comma-separated list of key value pairs to use as labels",
	"--label <label>": "Optional: Single label (name=value). This option can be used multiple times.",
	"--envs <envs>": "Optional: Comma-separated list of key value pairs to use av environment variables.",
	"--env <env>": "Optional: Single environment variable (name=value). This option can be used multiple times.",
	"--setTimeStamp <timestamp>":
		"Optional: Set a specific ISO 8601 timestamp on all entries (e.g. git commit hash). Default: 1970 in tar files, and current time on manifest/config",
	"--verbose": "Verbose logging",
	"--allowInsecureRegistries": "Allow insecure registries (with self-signed/untrusted cert)",
	"--customContent <dirs/files>":
		"Optional: Skip normal node_modules and applayer and include specified root folder files/directories instead",
	"--extraContent <dirs/files>":
		"Optional: Add specific content. Specify as local-path:absolute-container-path,local-path2:absolute-container-path2 etc",
	"--layerOwner <gid:uid>": "Optional: Set specific gid and uid on files in the added layers",
	"--buildFolder <path>": "Optional: Use a specific build folder when creating the image",
} as const;

function setKeyValue(target: Record<string, string>, keyValue: string) {
	const [k, v] = keyValue.split("=", 2);
	target[k] = v;
}

const cliLabels = {} as Record<string, string>;
program.on("option:label", (ops: string) => {
	setKeyValue(cliLabels, ops.trim());
});

const cliEnv = {} as Record<string, string>;
program.on("option:env", (ops: string) => {
	setKeyValue(cliEnv, ops.trim());
});

const cliOptions = Object.entries(possibleArgs)
	.reduce((program, [k, v]) => {
		program.option(k, v);
		return program;
	}, program)
	.parse()
	.opts();

const keys = Object.keys(possibleArgs).map((k) => k.split(" ")[0].replace("--", ""));

const defaultOptions = {
	workdir: "/app",
	user: "1000",
	entrypoint: "npm start",
};

if (cliOptions.file && !fs.existsSync(cliOptions.file)) {
	logger.error(`Config file '${cliOptions.file}' not found`);
	process.exit(1);
}

if (!cliOptions.file && fs.existsSync(`${cliOptions.folder}/doqr.json`)) {
	cliOptions.file = "doqr.json";
}

const configFromFile = cliOptions.file ? JSON.parse(fs.readFileSync(cliOptions.file, "utf-8")) : {};
Object.keys(configFromFile).forEach((k) => {
	if (!keys.includes(k)) {
		logger.error(`Unknown option in config-file '${cliOptions.file}': ${k}`);
		process.exit(1);
	}
});

const labelsOpt: Record<string, string> = {};
cliOptions.labels?.split(",")?.forEach((x: string) => setKeyValue(labelsOpt, x.trim()));
Object.keys(labelsOpt)
	.filter((l) => Object.keys(cliLabels).includes(l))
	.forEach((l) => {
		exitWithErrorIf(true, `Label ${l} specified both with --labels and --label`);
	});

const labels = { ...configFromFile.labels, ...labelsOpt, ...cliLabels }; //Let cli arguments override file

const envOpt: Record<string, string> = {};
cliOptions.envs?.split(",")?.forEach((x: string) => setKeyValue(envOpt, x.trim()));
Object.keys(envOpt)
	.filter((l) => Object.keys(cliEnv).includes(l))
	.forEach((l) => {
		exitWithErrorIf(true, `Env ${l} specified both with --envs and --env`);
	});

const envs = { ...configFromFile.envs, ...envOpt, ...cliEnv }; //Let cli arguments overide file

const cliParams: Record<string, string> = omit(cliOptions, [
	"label",
	"labels",
	"env",
	"envs",
	"customContent",
	"extraContent",
]);
cliParams.customContent = cliOptions.customContent?.split(",");
cliParams.extraContent = cliOptions.extraContent?.split(",").map((x: string) => x.split(":"));

const options: Partial<Options> = {
	...defaultOptions,
	...configFromFile,
	...cliParams,
	labels,
	envs: Object.entries(envs).map(([k, v]) => `${k}=${v}`),
};

function exitWithErrorIf(check: boolean, error: string) {
	if (check) {
		logger.error("ERROR: " + error);
		program.help({ error: true });
	}
}

if (options.verbose) logger.enableDebug();
if (options.allowInsecureRegistries) process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

exitWithErrorIf(!!options.registry && !!options.fromRegistry, "Do not set both --registry and --fromRegistry");
exitWithErrorIf(!!options.registry && !!options.toRegistry, "Do not set both --registry and --toRegistry");
exitWithErrorIf(!!options.token && !!options.fromToken, "Do not set both --token and --fromToken");
exitWithErrorIf(!!options.token && !!options.toToken, "Do not set both --token and --toToken");

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
exitWithErrorIf(!options.toRegistry && !options.toTar, "Must specify either --toTar or --toRegistry");
exitWithErrorIf(
	!options.toRegistry && !options.toToken && !options.toTar,
	"A token must be given when uploading to docker hub",
);

if (options.toRegistry && !options.toRegistry.endsWith("/")) options.toRegistry += "/";
if (options.fromRegistry && !options.fromRegistry.endsWith("/")) options.fromRegistry += "/";

if (!options.fromRegistry && !options.fromImage?.split(":")?.[0]?.includes("/")) {
	options.fromImage = "library/" + options.fromImage;
}

if (options.customContent) {
	options.customContent.forEach((p) => {
		exitWithErrorIf(!fs.existsSync(p), "Could not find " + p + " in the base folder " + options.folder);
	});
}

if (options.extraContent) {
	options.extraContent.forEach((p) => {
		exitWithErrorIf(
			p.length != 2,
			"Invalid extraContent - use comma between files/dirs, and : to separate local path and container path",
		);
		exitWithErrorIf(!fs.existsSync(p[0]), "Could not find " + p[0] + " in the base folder " + options.folder);
	});
}

async function run(options: Options) {
	if (!(await fse.pathExists(options.folder))) throw new Error("No such folder: " + options.folder);

	const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "doqr-"));
	logger.debug("Using " + tmpdir);
	const fromdir = await ensureEmptyDir(path.join(tmpdir, "from"));
	const todir = await ensureEmptyDir(path.join(tmpdir, "to"));

	const fromRegistry = options.fromRegistry
		? createRegistry(options.fromRegistry, options.fromToken ?? "")
		: createDockerRegistry(options.fromToken);
	await fromRegistry.download(options.fromImage, fromdir);

	await appLayerCreator.addLayers(tmpdir, fromdir, todir, options);

	if (options.toTar) {
		await tarExporter.saveToTar(todir, tmpdir, options.toTar, [options.toImage], options);
	}
	if (options.toRegistry) {
		const toRegistry = createRegistry(options.toRegistry, options.toToken ?? "");
		await toRegistry.upload(options.toImage, todir);
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
