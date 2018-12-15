# doqr
doqr allows you to build docker images without docker, allowing you to build a node.js docker image *from within a docker container*. This means you can build the container image on Kubernetes or Openshift - or locally in a docker container for more hermetic builds.

It will pull an image you specify from a given registry, add the node.js application from a given folder, and push the result to a(nother) given registry.

## How to install
```
npm install -g doqr
```

## How to use

This pull the ´node:10-alpine` image from Docker hub, build the image by adding the application from `src/`, and push the result to the given registry.

``
doqr --fromImage node:10-alpine --folder src/ --toImage myapp:latest --toRegistry https://registry.example.com/v2/
```

### Command line options 
Usage: doqr [options]

Options:
  --fromRegistry <registry url>  Optional: URL of registry to pull base image from - Default: https://registry-1.docker.io/v2/
  --fromImage <name:tag>         Required: Image name of base image - [path/]image:tag
  --fromToken <token>            Optional: Authentication token for from registry
  --toRegistry <registry url>    Optional: URL of registry to push base image to - Default: https://registry-1.docker.io/v2/
  --toImage <name:tag>           Required: Image name of target image - [path/]image:tag
  --toToken <token>              Optional: Authentication token for target registry
  --toTar <path>                 Optional: Export to tar file
  --registry <path>              Optional: Convenience argument for setting both from and to registry
  --token <path>                 Optional: Convenience argument for setting token for both from and to registry
  --folder <full path>           Required: Base folder of node application (contains package.json)
  --user <user>                  Optional: User account to run process in container - default: 1000
  --workdir <directory>          Optional: Workdir where node app will be added and run from - default: /app
  --entrypoint <entrypoint>      Optional: Entrypoint when starting container - default: npm start
  --verbose                      Verbose logging
  --allowInsecureRegistries      Allow insecure registries (with self-signed/untrusted cert)
  -h, --help                     output usage information
```

## Detailed info
Everything in the specified folder (`--folder`) is currently added to the image. It adds one layer with `package.json`, `package-lock.json` and `node_modules` and then a separate layer with the rest.

You may want to prune dev-dependencies and remove any unwanted files before running `doqr`. 

