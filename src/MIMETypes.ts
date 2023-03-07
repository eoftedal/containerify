interface MIMETypes {
    index: string,
    manifest: string,
    layer: LayerTypes,
    config: string,
}

interface LayerTypes {
    tar: string,
    gzip: string
}

export const OCI: MIMETypes = {
    index: 'application/vnd.oci.image.index.v1+json',
    manifest: 'application/vnd.oci.image.manifest.v1+json',
    layer: {
        tar: 'application/vnd.oci.image.layer.v1.tar',
        gzip: 'application/vnd.oci.image.layer.v1.tar+gzip'
    },
    config: 'application/vnd.oci.image.config.v1+json'
}

export const DockerV2: MIMETypes = {
    index: 'application/vnd.docker.distribution.manifest.list.v2+json',
    manifest: 'application/vnd.docker.distribution.manifest.v2+json',
    layer: {
        tar: 'application/vnd.docker.image.rootfs.diff.tar',
        gzip: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
    },
    config: 'application/vnd.docker.container.image.v1+json'
}