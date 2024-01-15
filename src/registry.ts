import * as https from "https";
import * as http from "http";
import * as URL from "url";
import * as fss from "fs";
import { promises as fs } from "fs";
import * as path from "path";
import * as fse from "fs-extra";

import * as fileutil from "./fileutil";
import logger from "./logger";
import {
	Config,
	Image,
	Index,
	IndexManifest,
	InsecureRegistrySupport,
	Layer,
	Manifest,
	PartialManifestConfig,
	Platform,
} from "./types";
import { DockerV2, OCI } from "./MIMETypes";
import { getLayerTypeFileEnding } from "./utils";

type Headers = Record<string, string>;

const redirectCodes = [308, 307, 303, 302, 301];

function request(
	options: https.RequestOptions,
	allowInsecure: InsecureRegistrySupport,
	callback: (res: http.IncomingMessage) => void,
) {
	if (allowInsecure == InsecureRegistrySupport.YES) options.rejectUnauthorized = false;
	return (options.protocol == "https:" ? https : http).request(options, (res) => {
		callback(res);
	});
}

function isOk(httpStatus: number) {
	return httpStatus >= 200 && httpStatus < 300;
}

function getHash(digest: string): string {
	return digest.split(":")[1];
}

function parseImage(imageStr: string) {
	const ar = imageStr.split(":");
	const tag = ar[1] || "latest";
	const ipath = ar[0];
	return { path: ipath, tag: tag };
}

function toError(res: http.IncomingMessage) {
	return `Unexpected HTTP status ${res.statusCode} : ${res.statusMessage}`;
}

function dl(uri: string, headers: Headers, allowInsecure: InsecureRegistrySupport): Promise<string> {
	logger.debug("dl", uri);
	return new Promise((resolve, reject) => {
		followRedirects(uri, headers, allowInsecure, (result) => {
			if ("error" in result) return reject(result.error);
			const { res } = result;
			logger.debug(res.statusCode, res.statusMessage, res.headers["content-type"], res.headers["content-length"]);
			if (!isOk(res.statusCode ?? 0)) return reject(toError(res));
			const data: string[] = [];
			res
				.on("data", (chunk) => data.push(chunk.toString()))
				.on("end", () => {
					resolve(data.reduce((a, b) => a.concat(b)));
				});
		});
	});
}

async function dlJson<T>(uri: string, headers: Headers, allowInsecure: InsecureRegistrySupport): Promise<T> {
	const data = await dl(uri, headers, allowInsecure);
	return JSON.parse(Buffer.from(data).toString("utf-8"));
}

function dlToFile(
	uri: string,
	file: string,
	headers: Headers,
	allowInsecure: InsecureRegistrySupport,
	cacheFolder?: string,
	skipCache = false,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const [filename] = file.split("/").slice(-1);
		if (cacheFolder && !skipCache) {
			fss
				.createReadStream(cacheFolder + filename)
				.on("error", () => {
					logger.debug("Not found in layer cache " + cacheFolder + filename + " - Downloading...");
					dlToFile(uri, file, headers, allowInsecure, cacheFolder, true).then(() => resolve());
				})
				.pipe(fss.createWriteStream(file))
				.on("finish", () => {
					logger.debug("Found in layer cache " + cacheFolder + filename);
					resolve();
				});
			return;
		}
		followRedirects(uri, headers, allowInsecure, (result) => {
			if ("error" in result) return reject(result.error);
			const { res } = result;
			logger.debug(res.statusCode, res.statusMessage, res.headers["content-type"], res.headers["content-length"]);
			if (!isOk(res.statusCode ?? 0)) return reject(toError(res));
			res.pipe(fss.createWriteStream(file)).on("finish", () => {
				logger.debug("Done " + file + " - " + res.headers["content-length"] + " bytes ");
				if (cacheFolder) {
					logger.debug(`Writing ${file} to cache ${cacheFolder + filename}`);
					fss.createReadStream(file).pipe(fss.createWriteStream(cacheFolder + filename));
				}
				resolve();
			});
		});
	});
}

type Callback = (result: { error: string } | { res: http.IncomingMessage }) => void;

function followRedirects(
	uri: string,
	headers: Headers,
	allowInsecure: InsecureRegistrySupport,
	cb: Callback,
	count = 0,
) {
	logger.debug("rc", uri);
	const options: https.RequestOptions = { ...URL.parse(uri) };
	options.headers = headers;
	options.method = "GET";
	request(options, allowInsecure, (res) => {
		if (redirectCodes.includes(res.statusCode ?? 0)) {
			if (count > 10) return cb({ error: "Too many redirects for " + uri });
			const location = res.headers.location;
			if (!location) return cb({ error: "Redirect, but missing location header" });
			return followRedirects(location, headers, allowInsecure, cb, count + 1);
		}
		cb({ res });
	}).end();
}

function buildHeaders(accept: string, auth: string) {
	const headers: Headers = { accept: accept };
	if (auth) headers.authorization = auth;
	return headers;
}

function headOk(
	url: string,
	headers: Headers,
	allowInsecure: InsecureRegistrySupport,
	optimisticCheck = false,
	depth = 0,
): Promise<boolean> {
	if (depth >= 5) {
		logger.info("Followed five redirects, assuming layer does not exist");
		return new Promise((resolve) => resolve(false));
	}
	return new Promise((resolve, reject) => {
		logger.debug(`HEAD ${url}`);
		const options: https.RequestOptions = URL.parse(url);
		options.headers = headers;
		options.method = "HEAD";
		request(options, allowInsecure, (res) => {
			logger.debug(`HEAD ${url}`, res.statusCode);
			// Not found
			if (res.statusCode == 404) return resolve(false);
			// OK
			if (res.statusCode == 200) return resolve(true);
			// Redirected
			if (redirectCodes.includes(res.statusCode ?? 0) && res.headers.location) {
				if (optimisticCheck) return resolve(true);
				return resolve(headOk(res.headers.location, headers, allowInsecure, optimisticCheck, ++depth));
			}
			// Unauthorized
			// Possibly related to https://gitlab.com/gitlab-org/gitlab/-/issues/23132
			if (res.statusCode == 401) {
				return resolve(false);
			}
			reject(toError(res));
		}).end();
	});
}

function uploadContent(
	uploadUrl: string,
	file: string,
	fileConfig: PartialManifestConfig,
	allowInsecure: InsecureRegistrySupport,
	auth: string,
	contentType: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		logger.debug("Uploading: ", file);
		let url = uploadUrl;
		if (fileConfig.digest) url += (url.indexOf("?") == -1 ? "?" : "&") + "digest=" + fileConfig.digest;
		const options: https.RequestOptions = URL.parse(url);
		options.method = "PUT";
		options.headers = {
			authorization: auth,
			"content-length": fileConfig.size,
			"content-type": contentType,
		};
		logger.debug("POST", url);
		const req = request(options, allowInsecure, (res) => {
			logger.debug(res.statusCode, res.statusMessage, res.headers["content-type"], res.headers["content-length"]);
			if ([200, 201, 202, 203].includes(res.statusCode ?? 0)) {
				resolve();
			} else {
				const data: string[] = [];
				res.on("data", (d) => data.push(d.toString()));
				res.on("end", () => {
					reject(`Error uploading to ${uploadUrl}. Got ${res.statusCode} ${res.statusMessage}:\n${data.join("")}`);
				});
			}
		});
		fss.createReadStream(file).pipe(req);
	});
}

function prepareToken(token: string) {
	if (token.startsWith("Basic ")) return token;
	if (token.startsWith("ghp_")) return "Bearer " + Buffer.from(token).toString("base64");
	return "Bearer " + token;
}

export function createRegistry(
	registryBaseUrl: string,
	token: string,
	allowInsecure: InsecureRegistrySupport,
	optimisticToRegistryCheck = false,
) {
	const auth = prepareToken(token);

	async function exists(image: Image, layer: Layer) {
		const url = `${registryBaseUrl}${image.path}/blobs/${layer.digest}`;
		return await headOk(url, buildHeaders(layer.mediaType, auth), allowInsecure, optimisticToRegistryCheck, 0);
	}

	async function uploadLayerContent(uploadUrl: string, layer: Layer, dir: string) {
		logger.info(layer.digest);
		const file = path.join(dir, getHash(layer.digest) + getLayerTypeFileEnding(layer));
		await uploadContent(uploadUrl, file, layer, allowInsecure, auth, "application/octet-stream");
	}

	async function getUploadUrl(image: Image): Promise<string> {
		return new Promise((resolve, reject) => {
			const url = `${registryBaseUrl}${image.path}/blobs/uploads/`;
			const options: https.RequestOptions = URL.parse(url);
			options.method = "POST";
			options.headers = { authorization: auth };
			request(options, allowInsecure, (res) => {
				logger.debug("POST", `${url}`, res.statusCode);
				if (res.statusCode == 202) {
					const { location } = res.headers;
					if (location) {
						if (location.startsWith("http")) {
							resolve(location);
						} else {
							const regURL = URL.parse(registryBaseUrl);

							resolve(`${regURL.protocol}//${regURL.hostname}${regURL.port ? ":" + regURL.port : ""}${location}`);
						}
					}
					reject("Missing location for 202");
				} else {
					const data: string[] = [];
					res
						.on("data", (c) => data.push(c.toString()))
						.on("end", () => {
							reject(
								`Error getting upload URL from ${url}. Got ${res.statusCode} ${res.statusMessage}:\n${data.join("")}`,
							);
						});
				}
			}).end();
		});
	}

	async function dlManifest(
		image: Image,
		preferredPlatform: Platform,
		allowInsecure: InsecureRegistrySupport,
	): Promise<Manifest> {
		// Accept both manifests and index/manifest lists
		const res = await dlJson<Manifest | Index>(
			`${registryBaseUrl}${image.path}/manifests/${image.tag}`,
			buildHeaders(`${OCI.index}, ${OCI.manifest}, ${DockerV2.index}, ${DockerV2.manifest}`, auth),
			allowInsecure,
		);

		// We've received an OCI Index or Docker Manifest List and need to find which manifest we want
		if (res.mediaType === OCI.index || res.mediaType === DockerV2.index) {
			const availableManifests = (res as Index).manifests;
			const adequateManifest = pickManifest(availableManifests, preferredPlatform);
			return dlManifest({ ...image, tag: adequateManifest.digest }, preferredPlatform, allowInsecure);
		}
		return res as Manifest;
	}

	function pickManifest(manifests: IndexManifest[], preferredPlatform: Platform): IndexManifest {
		const matchingArchitectures = new Set<IndexManifest>();
		const matchingOSes = new Set<IndexManifest>();
		// Find sets of matching architecture and os
		for (const manifest of manifests) {
			if (manifest.platform.architecture === preferredPlatform.architecture) {
				matchingArchitectures.add(manifest);
			}
			if (manifest.platform.os === preferredPlatform.os) {
				matchingOSes.add(manifest);
			}
		}

		// If the intersection of matching architectures and OS is one we've found our optimal match
		const intersection = new Set([...matchingArchitectures].filter((x) => matchingOSes.has(x)));
		if (intersection.size == 1) {
			return intersection.values().next().value;
		}

		// If we don't have a perfect match we give a warning and try the first matching architecture
		if (matchingArchitectures.size >= 1) {
			const matchingArch = matchingArchitectures.values().next().value;
			logger.info(`[WARN] Preferred OS '${preferredPlatform.os}' not available.`);
			logger.info("[WARN] Using closest available manifest:", JSON.stringify(matchingArch.platform));
			return matchingArch;
		}

		// If there's no image matching the wanted architecture we bail
		logger.error(`No image matching requested architecture: '${preferredPlatform.architecture}'`);
		logger.error("Available platforms:", JSON.stringify(manifests.map((m) => m.platform)));
		throw new Error("No image matching requested architecture");
	}

	async function dlConfig(
		image: Image,
		config: Manifest["config"],
		allowInsecure: InsecureRegistrySupport,
	): Promise<Config> {
		return await dlJson<Config>(
			`${registryBaseUrl}${image.path}/blobs/${config.digest}`,
			buildHeaders("*/*", auth),
			allowInsecure,
		);
	}

	async function dlLayer(
		image: Image,
		layer: Layer,
		folder: string,
		allowInsecure: InsecureRegistrySupport,
		cacheFolder?: string,
	): Promise<string> {
		const file = getHash(layer.digest) + getLayerTypeFileEnding(layer);

		await dlToFile(
			`${registryBaseUrl}${image.path}/blobs/${layer.digest}`,
			path.join(folder, file),
			buildHeaders(layer.mediaType, auth),
			allowInsecure,
			cacheFolder,
		);
		return file;
	}

	async function upload(imageStr: string, folder: string) {
		const image = parseImage(imageStr);
		const manifestFile = path.join(folder, "manifest.json");
		const manifest = (await fse.readJson(manifestFile)) as Manifest;

		logger.info("Checking layer status...");
		const layerStatus = await Promise.all(
			manifest.layers.map(async (l) => {
				return { layer: l, exists: await exists(image, l) };
			}),
		);
		const layersForUpload = layerStatus.filter((l) => !l.exists);
		logger.debug(
			"Needs upload:",
			layersForUpload.map((l) => l.layer.digest),
		);

		logger.info("Uploading layers...");
		await Promise.all(
			layersForUpload.map(async (l) => {
				const url = await getUploadUrl(image);
				await uploadLayerContent(url, l.layer, folder);
			}),
		);

		logger.info("Uploading config...");
		const configUploadUrl = await getUploadUrl(image);
		const configFile = path.join(folder, getHash(manifest.config.digest) + ".json");
		await uploadContent(configUploadUrl, configFile, manifest.config, allowInsecure, auth, "application/octet-stream");

		logger.info("Uploading manifest...");
		const manifestSize = await fileutil.sizeOf(manifestFile);
		await uploadContent(
			`${registryBaseUrl}${image.path}/manifests/${image.tag}`,
			manifestFile,
			{ mediaType: manifest.mediaType, size: manifestSize },
			allowInsecure,
			auth,
			manifest.mediaType,
		);
	}

	async function download(imageStr: string, folder: string, preferredPlatform: Platform, cacheFolder?: string) {
		const image = parseImage(imageStr);

		logger.info("Downloading manifest...");
		const manifest = await dlManifest(image, preferredPlatform, allowInsecure);
		await fs.writeFile(path.join(folder, "manifest.json"), JSON.stringify(manifest));

		logger.info("Downloading config...");
		const config = await dlConfig(image, manifest.config, allowInsecure);

		if (config.architecture != preferredPlatform.architecture) {
			logger.info(
				`[WARN] Image architecture (${config.architecture}) does not match preferred architecture (${preferredPlatform.architecture}).`,
			);
		}
		if (config.os != preferredPlatform.os) {
			logger.info(`[WARN] Image OS (${config.os}) does not match preferred OS (${preferredPlatform.os}).`);
		}

		await fs.writeFile(path.join(folder, "config.json"), JSON.stringify(config));

		logger.info("Downloading layers...");
		await Promise.all(manifest.layers.map((layer) => dlLayer(image, layer, folder, allowInsecure, cacheFolder)));

		logger.info("Image downloaded.");
	}

	return {
		download: download,
		upload: upload,
	};
}

export function createDockerRegistry(allowInsecure: InsecureRegistrySupport, auth?: string) {
	const registryBaseUrl = "https://registry-1.docker.io/v2/";

	async function getToken(image: Image) {
		const resp = await dlJson<{ token: string }>(
			`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${image.path}:pull`,
			{},
			allowInsecure,
		);
		return resp.token;
	}

	async function download(imageStr: string, folder: string, platform: Platform, cacheFolder?: string) {
		const image = parseImage(imageStr);
		if (!auth) auth = await getToken(image);
		await createRegistry(registryBaseUrl, auth, allowInsecure).download(imageStr, folder, platform, cacheFolder);
	}

	async function upload(imageStr: string, folder: string) {
		if (!auth) throw new Error("Need auth token to upload to Docker");
		await createRegistry(registryBaseUrl, auth, allowInsecure).upload(imageStr, folder);
	}

	return {
		download: download,
		upload: upload,
	};
}
