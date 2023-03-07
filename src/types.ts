export type Layer = {
	mediaType: string;
	size: number;
	digest: string;
};

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
}

export type IndexManifest = {
	mediaType: string;
	digest: string;
	size: number;
	platform: Platform;
}

export type Platform = {
	architecture: string;
	os: string;
}

export type Manifest = {
	config: {
		digest: string;
		mediaType: string;
		size: number;
	};
	mediaType: string;
	layers: Array<Layer>;
};

export type PartialManifestConfig = {
	digest?: string;
	mediaType: string;
	size: number;
};

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
	fromImage: string;
	toImage: string;
	folder: string;
	file?: string;
	fromRegistry?: string;
	fromToken?: string;
	toRegistry?: string;
	toToken?: string;
	toTar?: string;
	registry?: string;
	platform: string;
	token?: string;
	user: string;
	workdir: string;
	entrypoint: string;
	labels: Record<string, string>;
	envs: string[];
	setTimeStamp?: string;
	verbose?: boolean;
	allowInsecureRegistries?: boolean;
	customContent?: string[];
	extraContent?: string[];
	layerOwner?: string;
	buildFolder?: string;
};
