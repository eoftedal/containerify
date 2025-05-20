type Descriptor = {
	mediaType: string;
	size: number;
	digest: string;
};

export type Layer = Descriptor;

export type Image = {
	path: string;
	tag: string;
};

// https://github.com/opencontainers/image-spec/blob/v1.0/image-index.md
// https://docs.docker.com/registry/spec/manifest-v2-2/#manifest-list
export type Index = {
	mediaType: string;
	schemaVersion: string;
	manifests: Array<IndexManifest>;
	annotations?: Map<string, string>;
};

export type IndexManifest = Descriptor & {
	platform: Platform;
};

export type Platform = {
	architecture: string;
	os: string;
};

export type Manifest = {
	config: Descriptor;
	mediaType: string;
	layers: Array<Layer>;
};

export type PartialManifestConfig = Omit<Descriptor, "digest"> & Partial<Pick<Descriptor, "digest">>;

export type Config = {
	architecture?: string;
	os?: string;
	history: Array<HistoryLine>;
	rootfs: {
		diff_ids: string[];
	};
	config: {
		Labels: Record<string, string>;
		Env: string[];
		WorkingDir: string;
		Entrypoint: string[];
		User: string;
	};
	container_config: {
		Labels: Record<string, string>;
		Env: string[];
		User: string;
	};
};

export type HistoryLine = {
	created: string;
	created_by: string;
	empty_layer?: boolean;
	comment?: string;
};

export type Options = {
	from?: string;
	to?: string;
	fromImage: string;
	toImage: string;
	folder: string;
	file?: string;
	fromRegistry?: string;
	fromToken?: string;
	toRegistry?: string;
	doCrossMount: boolean;
	optimisticToRegistryCheck?: boolean;
	toToken?: string;
	toTar?: string;
	toDocker?: boolean;
	registry?: string;
	platform: string;
	token?: string;
	user: string;
	workdir: string;
	entrypoint: string;
	labels: Record<string, string>;
	envs: string[];
	preserveTimeStamp?: boolean;
	setTimeStamp?: string;
	verbose?: boolean;
	allowInsecureRegistries?: boolean;
	allowNoPushAuth?: boolean;
	customContent: Record<string, string>;
	extraContent: Record<string, string>;
	layerOwner?: string;
	buildFolder?: string;
	layerCacheFolder?: string;
	nonDefaults: {
		user?: string;
		workdir?: string;
		entrypoint?: string;
	};
	writeDigestTo?: string;
};

export enum InsecureRegistrySupport {
	NO,
	YES,
}
export type Registry = {
	download: (imageStr: string, folder: string, preferredPlatform: Platform, cacheFolder?: string) => Promise<Manifest>;
	upload: (
		imageStr: string,
		folder: string,
		doCrossMount: boolean,
		originalManifest: Manifest,
		originalRepository: string,
	) => Promise<void>;
	registryBaseUrl: string;
};

export type ManifestDescriptor = Descriptor;
