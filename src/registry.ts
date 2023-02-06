import * as https from "https";
import * as http from "http";
import * as URL from "url";
import { promises as fs } from "fs";
import * as path from "path";
import * as fse from "fs-extra";
import * as fss from "fs";

import * as fileutil from "./fileutil";
import logger from "./logger";
import { Config, Image, Layer, Manifest, PartialManifestConfig } from "./types";

type Headers = Record<string, string>;

const redirectCodes = [307, 303, 302];

function request(options: https.RequestOptions, callback: (res: http.IncomingMessage) => void) {
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

function dl(uri: string, headers: Headers): Promise<string> {
	logger.debug("dl", uri);
	return new Promise((resolve, reject) => {
		followRedirects(uri, headers, (result) => {
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

async function dlJson<T>(uri: string, headers: Headers): Promise<T> {
	const data = await dl(uri, headers);
	return JSON.parse(Buffer.from(data).toString("utf-8"));
}

function dlToFile(uri: string, file: string, headers: Headers): Promise<void> {
	return new Promise((resolve, reject) => {
		followRedirects(uri, headers, (result) => {
			if ("error" in result) return reject(result.error);
			const { res } = result;
			logger.debug(res.statusCode, res.statusMessage, res.headers["content-type"], res.headers["content-length"]);
			if (!isOk(res.statusCode ?? 0)) return reject(toError(res));
			res.pipe(fss.createWriteStream(file)).on("finish", () => {
				logger.debug("Done " + file + " - " + res.headers["content-length"] + " bytes ");
				resolve();
			});
		});
	});
}

type Callback = (result: { error: string } | { res: http.IncomingMessage }) => void;

function followRedirects(uri: string, headers: Headers, cb: Callback, count = 0) {
	logger.debug("rc", uri);
	const options: https.RequestOptions = { ...URL.parse(uri) };
	options.headers = headers;
	options.method = "GET";
	request(options, (res) => {
		if (redirectCodes.includes(res.statusCode ?? 0)) {
			if (count > 10) return cb({ error: "Too many redirects for " + uri });
			const location = res.headers.location;
			if (!location) return cb({ error: "Redirect, but missing location header" });
			return followRedirects(location, headers, cb, count + 1);
		}
		cb({ res });
	}).end();
}

function buildHeaders(accept: string, auth: string) {
	const headers: Headers = { accept: accept };
	if (auth) headers.authorization = auth;
	return headers;
}

function headOk(url: string, headers: Headers): Promise<boolean> {
	return new Promise((resolve, reject) => {
		logger.debug(`HEAD ${url}`);
		const options: http.RequestOptions = URL.parse(url);
		options.headers = headers;
		options.method = "HEAD";
		request(options, (res) => {
			logger.debug(`HEAD ${url}`, res.statusCode);
			if (res.statusCode == 404) return resolve(false);
			if (res.statusCode == 200) return resolve(true);
			reject(toError(res));
		}).end();
	});
}

function uploadContent(
	uploadUrl: string,
	file: string,
	fileConfig: PartialManifestConfig,
	auth: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		logger.debug("Uploading: ", file);
		let url = uploadUrl;
		if (fileConfig.digest) url += (url.indexOf("?") == -1 ? "?" : "&") + "digest=" + fileConfig.digest;
		const options: http.RequestOptions = URL.parse(url);
		options.method = "PUT";
		options.headers = {
			authorization: auth,
			"content-length": fileConfig.size,
			"content-type": fileConfig.mediaType,
		};
		logger.debug("POST", url);
		const req = request(options, (res) => {
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

export function createRegistry(registryBaseUrl: string, token: string) {
	const auth = "Bearer " + token;

	async function exists(image: Image, layer: Layer) {
		const url = `${registryBaseUrl}${image.path}/blobs/${layer.digest}`;
		return await headOk(url, buildHeaders(layer.mediaType, auth));
	}

	async function uploadLayerContent(uploadUrl: string, layer: Layer, dir: string) {
		logger.info(layer.digest);
		const file = path.join(dir, getHash(layer.digest) + (layer.mediaType.includes("tar.gzip") ? ".tar.gz" : ".tar"));
		await uploadContent(uploadUrl, file, layer, auth);
	}

	async function getUploadUrl(image: Image): Promise<string> {
		return new Promise((resolve, reject) => {
			const url = `${registryBaseUrl}${image.path}/blobs/uploads/`;
			const options: https.RequestOptions = URL.parse(url);
			options.method = "POST";
			options.headers = { authorization: auth };
			request(options, (res) => {
				logger.debug("POST", `${url}`, res.statusCode);
				if (res.statusCode == 202) {
					const { location } = res.headers;
					if (location) resolve(location);
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

	async function dlManifest(image: Image): Promise<Manifest> {
		return await dlJson(
			`${registryBaseUrl}${image.path}/manifests/${image.tag}`,
			buildHeaders("application/vnd.docker.distribution.manifest.v2+json", auth),
		);
	}

	async function dlConfig(image: Image, config: Manifest["config"]): Promise<Config> {
		return await dlJson(`${registryBaseUrl}${image.path}/blobs/${config.digest}`, buildHeaders("*/*", auth));
	}

	async function dlLayer(image: Image, layer: Layer, folder: string): Promise<string> {
		logger.info(layer.digest);
		const file = getHash(layer.digest) + (layer.mediaType.includes("tar.gzip") ? ".tar.gz" : ".tar");
		await dlToFile(
			`${registryBaseUrl}${image.path}/blobs/${layer.digest}`,
			path.join(folder, file),
			buildHeaders(layer.mediaType, auth),
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
		await uploadContent(configUploadUrl, configFile, manifest.config, auth);

		logger.info("Uploading manifest...");
		const manifestSize = await fileutil.sizeOf(manifestFile);
		await uploadContent(
			`${registryBaseUrl}${image.path}/manifests/${image.tag}`,
			manifestFile,
			{ mediaType: manifest.mediaType, size: manifestSize },
			auth,
		);
	}

	async function download(imageStr: string, folder: string) {
		const image = parseImage(imageStr);

		logger.info("Downloading manifest...");
		const manifest = await dlManifest(image);
		await fs.writeFile(path.join(folder, "manifest.json"), JSON.stringify(manifest));

		logger.info("Downloading config...");
		const config = await dlConfig(image, manifest.config);
		await fs.writeFile(path.join(folder, "config.json"), JSON.stringify(config));

		logger.info("Downloading layers...");
		await Promise.all(manifest.layers.map((layer) => dlLayer(image, layer, folder)));

		logger.info("Image downloaded.");
	}

	return {
		download: download,
		upload: upload,
	};
}

export function createDockerRegistry(auth?: string) {
	const registryBaseUrl = "https://registry-1.docker.io/v2/";

	async function getToken(image: Image) {
		const resp = await dlJson<{ token: string }>(
			`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${image.path}:pull`,
			{},
		);
		return resp.token;
	}
	async function download(imageStr: string, folder: string) {
		const image = parseImage(imageStr);
		if (!auth) auth = await getToken(image);
		await createRegistry(registryBaseUrl, auth).download(imageStr, folder);
	}

	async function upload(imageStr: string, folder: string) {
		if (!auth) throw new Error("Need auth token to upload to Docker");
		await createRegistry(registryBaseUrl, auth).upload(imageStr, folder);
	}

	return {
		download: download,
		upload: upload,
	};
}
