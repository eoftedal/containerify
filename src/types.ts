import {
	DockerDescriptor,
	DockerIndexManifest,
	DockerManifestList,
	DockerManifestV2,
	DockerPlatform,
} from "./manifests/docker";
import { OCIDescriptor, OCIIndex, OCIIndexManifest, OCIManifest, OCIPlatform } from "./manifests/oci";

export type Layer = DockerDescriptor | OCIDescriptor;

export type Image = {
	path: string;
	tag: string;
};

// https://github.com/opencontainers/image-spec/blob/v1.0/image-index.md
// https://docs.docker.com/registry/spec/manifest-v2-2/#manifest-list
export type Index = OCIIndex | DockerManifestList;

export type Manifest = OCIManifest | DockerManifestV2;

export type IndexManifest = OCIIndexManifest | DockerIndexManifest;

export type PartialManifestConfig =
	| (Omit<OCIDescriptor, "digest"> & Partial<Pick<OCIDescriptor, "digest">>)
	| (Omit<DockerDescriptor, "digest"> & Partial<Pick<DockerDescriptor, "digest">>);

export type Platform = OCIPlatform | DockerPlatform;

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
	tarFormat?: "oci" | "docker";
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
	customContent: string[];
	extraContent: Record<string, string>;
	layerOwner?: string;
	buildFolder?: string;
	layerCacheFolder?: string;
};
