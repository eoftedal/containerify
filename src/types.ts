export type Layer = {
	mediaType: string;
	size: number;
	digest: string;
};

export type Image = {
	path: string;
	tag: string;
};

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
