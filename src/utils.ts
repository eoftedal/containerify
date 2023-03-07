import { Layer, Manifest, Platform } from "./types";
import { DockerV2, OCI } from "./MIMETypes";

export function unique(vals: string[]): string[] {
	return [...new Set(vals)];
}

export function omit<T>(obj: Record<string, T>, keys: string[]): Record<string, T> {
	return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}
export function getPreferredPlatform(platform?: string): Platform {
	// We assume the input is similar to docker which accepts `<os>/<arch>` and `<arch>`
	let os: string = process.platform;
	let arch: string = process.arch;

	if (platform != undefined) {
		const input = platform.split("/");
		if (input.length == 1) {
			arch = input[0];
		} else if (input.length == 2) {
			os = input[0];
			arch = input[1];
		} else {
			throw new Error(`Invalid platform ${platform}. Should be on format <os>/<arch> or <arch>`);
		}
	}

	// Mapping from Node's process.platform and Golang's `$GOOS` to Golang's `$GOOS`
	// Incomplete, but cover the most common OS-types
	// https://nodejs.org/api/process.html#processplatform
	// https://go.dev/doc/install/source#environment
	const OS_MAPPING = {
		aix: "aix",
		darwin: "darwin",
		freebsd: "freebsd",
		linux: "linux",
		openbsd: "openbsd",
		sunos: "solaris",
		solaris: "solaris",
		win32: "windows",
		windows: "windows",
	} as const;

	const targetOS = Object.entries(OS_MAPPING).find(([k]) => k == os)?.[1];
	if (targetOS == undefined) {
		throw new Error(`Platform ${os} not supported. Supported platforms are '${Object.keys(OS_MAPPING)}`);
	}

	// Mapping from Node's `process.arch` and Golang's `$GOARCH` to Golang's `$GOARCH` (incomplete)
	// Incomplete, but cover the most common architectures
	// https://nodejs.org/api/process.html#processarch
	// https://go.dev/doc/install/source#environment
	const ARCH_MAPPING = {
		ia32: "386",
		"386": "386",
		x64: "amd64",
		amd64: "amd64",
		arm: "arm",
		arm64: "arm64",
	} as const;

	const targetArch = Object.entries(ARCH_MAPPING).find(([k]) => k == arch)?.[1];
	if (targetArch == undefined) {
		throw new Error(`Architecture ${arch} not supported. Supported architectures are '${Object.keys(ARCH_MAPPING)}'.`);
	}
	return {
		os: targetOS,
		architecture: targetArch,
	};
}

export function getManifestLayerType(manifest: Manifest) {
	if (manifest.mediaType === OCI.manifest) {
		return OCI.layer.gzip;
	}
	if (manifest.mediaType === DockerV2.manifest) {
		return DockerV2.layer.gzip;
	}
	throw new Error(`${manifest.mediaType} not recognized.`);
}

export function getLayerTypeFileEnding(layer: Layer) {
	switch (layer.mediaType) {
		case OCI.layer.gzip:
		case DockerV2.layer.gzip:
			return ".tar.gz";
		case OCI.layer.tar:
		case DockerV2.layer.tar:
			return ".tar";
		default:
			throw new Error(`Layer mediaType ${layer.mediaType} not known.`);
	}
}
