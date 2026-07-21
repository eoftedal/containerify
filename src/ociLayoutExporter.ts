import * as tar from "tar";
import { promises as fs } from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Config, Manifest, Options } from "./types";
import { OCI } from "./MIMETypes";
import * as fileutil from "./fileutil";
import { getLayerTypeFileEnding, getHash, toOciMediaType } from "./utils";
import logger from "./logger";

const tarDefaultConfig = {
	preservePaths: false,
	portable: true,
	follow: true,
};

function calculateHashOfBuffer(buf: Buffer): string {
	return crypto.createHash("sha256").update(buf).digest("hex");
}

async function saveToOciLayout(fromdir: string, tmpdir: string, toPath: string, repoTags: string[], options: Options) {
	logger.info("Creating " + toPath + " ...");

	const targetFolder = path.dirname(toPath);
	await fs.access(targetFolder).catch(async () => await fs.mkdir(targetFolder, { recursive: true }));

	const manifest = await fileutil.readJson<Manifest>(path.join(fromdir, "manifest.json"));
	const configHex = getHash(manifest.config.digest);
	const config = await fileutil.readJson<Config>(path.join(fromdir, configHex + ".json"));

	const layoutDir = await fileutil.ensureEmptyDir(path.join(tmpdir, "tooci"));
	const blobsDir = path.join(layoutDir, "blobs", "sha256");
	await fs.mkdir(blobsDir, { recursive: true });

	// Config and layer blobs carry no mediaType inside their own bytes, so they can
	// be copied verbatim - their digest is unaffected by OCI vs Docker media types.
	await fs.copyFile(path.join(fromdir, configHex + ".json"), path.join(blobsDir, configHex));
	await Promise.all(
		manifest.layers.map(async (layer) => {
			const hex = getHash(layer.digest);
			const ext = getLayerTypeFileEnding(layer);
			await fs.copyFile(path.join(fromdir, hex + ext), path.join(blobsDir, hex));
		}),
	);

	// The manifest itself embeds mediaType strings, so it must be rewritten to the
	// OCI family (and rehashed) to be genuinely OCI-compliant regardless of the
	// source base image's original format.
	const ociManifest: Manifest = {
		...manifest,
		mediaType: toOciMediaType(manifest.mediaType),
		config: { ...manifest.config, mediaType: toOciMediaType(manifest.config.mediaType) },
		layers: manifest.layers.map((layer) => ({ ...layer, mediaType: toOciMediaType(layer.mediaType) })),
	};
	const manifestBuffer = Buffer.from(JSON.stringify(ociManifest));
	const manifestHex = calculateHashOfBuffer(manifestBuffer);
	await fs.writeFile(path.join(blobsDir, manifestHex), manifestBuffer);

	const index = {
		schemaVersion: 2,
		mediaType: OCI.index,
		manifests: [
			{
				mediaType: OCI.manifest,
				digest: "sha256:" + manifestHex,
				size: manifestBuffer.byteLength,
				...(config.os && config.architecture ? { platform: { os: config.os, architecture: config.architecture } } : {}),
				annotations: { "org.opencontainers.image.ref.name": repoTags[0] },
			},
		],
	};
	await fs.writeFile(path.join(layoutDir, "index.json"), JSON.stringify(index));
	await fs.writeFile(path.join(layoutDir, "oci-layout"), JSON.stringify({ imageLayoutVersion: "1.0.0" }));

	const blobHexes = [configHex, manifestHex, ...manifest.layers.map((layer) => getHash(layer.digest))].sort();
	const blobEntries = blobHexes.map((hex) => path.join("blobs", "sha256", hex));
	await tar.create(
		{
			...tarDefaultConfig,
			...{
				cwd: layoutDir,
				file: toPath,
				noMtime: !options.setTimeStamp,
				...(options.setTimeStamp ? { mtime: new Date(options.setTimeStamp) } : {}),
			},
		},
		["oci-layout", "index.json"].concat(blobEntries),
	);
	logger.info("Finished " + toPath);
}

export default {
	saveToOciLayout,
};
