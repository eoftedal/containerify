export type DockerManifestV1 = {
	name: string;
	tag: string;
	architecture: string;
	fsLayers: Array<{ blobSum: string }>;
	history?: Array<{ v1Compatibility: string }>;
	schemaVersion: 1;
	signatures?: Array<{
		header: unknown;
		signature: string;
		protected: string;
	}>;
};

export type DockerManifestV2 = {
	schemaVersion: 2;
	mediaType: "application/vnd.docker.distribution.manifest.v2+json";
	config: {
		mediaType: "application/vnd.docker.container.image.v1+json";
		digest: string;
		size: number;
	};
	layers: Array<DockerDescriptor>;
};

export type DockerManifestList = {
	schemaVersion: 2;
	mediaType: "application/vnd.docker.distribution.manifest.list.v2+json";
	manifests: DockerIndexManifest[];
};

export type DockerIndexManifest = {
	mediaType: string;
	digest: string;
	size: number;
	platform: DockerPlatform;
};

export type DockerPlatform = {
	architecture: string;
	os: string;
	"os.version"?: string;
	"os.features"?: Array<string>;
	features?: Array<string>;
	variant?: string;
};

export type DockerDescriptor = {
	mediaType: string;
	digest: string;
	size: number;
	urls?: string[];
};
