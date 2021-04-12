# doqr
doqr allows you to build node.js docker images without docker, allowing you to build a node.js docker image *from within a docker container*. This means you can build the container image on Kubernetes or Openshift - or locally in a docker container for more hermetic builds.

It will pull an image you specify from a given registry, add the node.js application from a given folder, and push the result to a(nother) given registry.

## How to install
```
npm install -g doqr
```

## How to use

This will pull the `node:13-slim` image from Docker hub, build the image by adding the application in `src/`, and push the result to the given registry, and set time timestamp of files in the created layers and configs to the current timestamp of the latest git commit.

```
doqr --fromImage node:13-slim --folder src/ --toImage myapp:latest --toRegistry https://registry.example.com/v2/ --setTimeStamp=$(git show -s --format="%aI" HEAD)
```

### Command line options 
```
Usage: doqr [options]

Options:
  --fromImage <name:tag>         Required: Image name of base image - [path/]image:tag
  --toImage <name:tag>           Required: Image name of target image - [path/]image:tag
  --folder <full path>           Required: Base folder of node application (contains package.json)
  --fromRegistry <registry url>  Optional: URL of registry to pull base image from - Default: https://registry-1.docker.io/v2/
  --fromToken <token>            Optional: Authentication token for from registry
  --toRegistry <registry url>    Optional: URL of registry to push base image to - Default: https://registry-1.docker.io/v2/
  --toToken <token>              Optional: Authentication token for target registry
  --toTar <path>                 Optional: Export to tar file
  --registry <path>              Optional: Convenience argument for setting both from and to registry
  --token <path>                 Optional: Convenience argument for setting token for both from and to registry
  --user <user>                  Optional: User account to run process in container - default: 1000
  --workdir <directory>          Optional: Workdir where node app will be added and run from - default: /app
  --entrypoint <entrypoint>      Optional: Entrypoint when starting container - default: npm start
  --labels <labels>              Optional: Comma-separated list of key value pairs to use as labels
  --label <label>                Optional: Single label (name=value). This option can be used multiple times. Wrap in double quotes if value has spaces or other characters that can cause arugment parsing issues.
  --setTimeStamp <timestamp>     Optional: Set a specific ISO 8601 timestamp on all entries (e.g. git commit hash). Default: 1970 in tar files, and current time on manifest/config
  --verbose                      Verbose logging
  --allowInsecureRegistries      Allow insecure registries (with self-signed/untrusted cert)
  --customContent <dirs/files>   Optional: Skip normal node_modules and applayer and include specified root folder files/directories instead
  --extraContent <dirs/files>    Optional: Add specific content. Specify as local-path:absolute-container-path,local-path2:absolute-container-path2 etc
  --layerOwner <gid:uid>         Optional: Set specific gid and uid on files in the added layers
  --buildFolder <path>           Optional: Use a specific build folder when creating the image
  -h, --help                     output usage information
```

## Detailed info
Everything in the specified folder (`--folder`) is currently added to the image. It adds one layer with `package.json`, `package-lock.json` and `node_modules` and then a separate layer with the rest.

You may want to prune dev-dependencies and remove any unwanted files before running `doqr`. 

