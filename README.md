# containerify

containerify (previously known as doqr) allows you to build node.js docker images without docker, allowing you to build a node.js docker image _from within a docker container_. This means you can build the container image on Kubernetes or Openshift - or locally in a docker container for more hermetic builds.

It will pull an image you specify from a given registry, add the node.js application from a given folder, and push the result to a(nother) given registry.

## How to install

```
npm install -g containerify
```

## How to use

This will pull the `node:13-slim` image from Docker hub, build the image by adding the application in `src/`, and push the result to the given registry, and set time timestamp of files in the created layers and configs to the current timestamp of the latest git commit.

```
containerify --fromImage node:13-slim --folder src/ --toImage myapp:latest --toRegistry https://registry.example.com/v2/ --setTimeStamp=$(git show -s --format="%aI" HEAD)
```

### customContent - Adding compiled code to non-node container

If you want to build a non-node container (e.g. add compiled frontend code to an nginx container), you can use `--customContent`. When doing this
the normal `node_modules` etc layers will not be added, and workdir, user and entrypoint will not be overridden (allthough they can be explicitely modified
if needed).

```
npm run build  # or some other build command
containerify --fromImage nginx:alpine --folder . --toImage frontend:latest --customContent dist:/usr/share/nginx/html --toRegistry https://registry.example.com/v2/
```

This will take the `nginx:alpine` image, and copy the files from `./dist/` into `/usr/share/nginx/html`. By default it does _NOT_ modify then entrypoint, user or workdir, so the base image settings are still used when running. You can still override with `--entrypoint` etc. if needed.

### Command line options

```
Usage: containerify [options]

Options:
  --fromImage <name:tag>         Required: Image name of base image - [path/]image:tag
  --toImage <name:tag>           Required: Image name of target image - [path/]image:tag
  --folder <full path>           Required: Base folder of node application (contains package.json)
  --file <path>                  Optional: Name of configuration file (defaults to containerify.json if found on path)
  --fromRegistry <registry url>  Optional: URL of registry to pull base image from - Default: https://registry-1.docker.io/v2/
  --fromToken <token>            Optional: Authentication token for from registry
  --toRegistry <registry url>    Optional: URL of registry to push base image to - Default: https://registry-1.docker.io/v2/
  --toToken <token>              Optional: Authentication token for target registry
  --toTar <path>                 Optional: Export to tar file
  --registry <path>              Optional: Convenience argument for setting both from and to registry
  --platform <platform>          Optional: Preferred platform, e.g. linux/amd64 or arm64
  --token <path>                 Optional: Convenience argument for setting token for both from and to registry
  --user <user>                  Optional: User account to run process in container - default: 1000
  --workdir <directory>          Optional: Workdir where node app will be added and run from - default: /app
  --entrypoint <entrypoint>      Optional: Entrypoint when starting container - default: npm start
  --labels <labels>              Optional: Comma-separated list of key value pairs to use as labels
  --label <label>                Optional: Single label (name=value). This option can be used multiple times.
  --envs <envs>                  Optional: Comma-separated list of key value pairs to use av environment variables.
  --env <env>                    Optional: Single environment variable (name=value). This option can be used multiple times.
  --setTimeStamp <timestamp>     Optional: Set a specific ISO 8601 timestamp on all entries (e.g. git commit hash). Default: 1970 in tar files, and current time on
                                 manifest/config
  --verbose                      Verbose logging
  --allowInsecureRegistries      Allow insecure registries (with self-signed/untrusted cert)
  --customContent <dirs/files>   Optional: Skip normal node_modules and applayer and include specified root folder files/directories instead
  --extraContent <dirs/files>    Optional: Add specific content. Specify as local-path:absolute-container-path,local-path2:absolute-container-path2 etc
  --layerOwner <gid:uid>         Optional: Set specific gid and uid on files in the added layers
  --buildFolder <path>           Optional: Use a specific build folder when creating the image
  --layerCacheFolder <path>      Optional: Folder to cache base layers between builds
  --version                      Get containerify version
  -h, --help                     display help for command
```

## Detailed info

Everything in the specified folder (`--folder`) is currently added to the image. It adds one layer with `package.json`, `package-lock.json` and `node_modules` and then a separate layer with the rest.

You may want to prune dev-dependencies and remove any unwanted files before running `containerify`.
