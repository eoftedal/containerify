const OCIManifestTypes = [
	"application/vnd.oci.image.manifest.v1+json",
	"application/vnd.oci.artifact.manifest.v1+jsonapplication/vnd.oci.artifact.manifest.v1+json",
	"application/vnd.oci.image.index.v1+json",
] as const;

export type OCIIndex = {
	schemaVersion: 2; //Docker compatibility
	mediaType: "application/vnd.oci.image.index.v1+json";
	manifests: OCIIndexManifest[];
	annotations?: Record<string, string>;
};

export type OCIIndexManifest = {
	mediaType: typeof OCIManifestTypes;
	size: number;
	digest: string;
	platform?: OCIPlatform;
};

export type OCIPlatform = {
	architecture: string;
	os: string;
	"os.version"?: string;
	"os.features"?: string[];
	variant?: string;
	features?: string[];
};

export type OCIManifest = {
	schemaVersion: 2; //Docker compatibility
	mediaType: "application/vnd.oci.image.manifest.v1+json";
	config: {
		mediaType: "application/vnd.oci.image.config.v1+json";
		digest: string;
		size: number;
	};
	layers: OCIDescriptor[];
};

export type OCIDescriptor = {
	mediaType: string;
	digest: string;
	size: number;
	urls?: string[];
	annotations?: Record<string, string>;
	data?: string;
	artifactType?: string;
};
