#!/bin/bash

set -e

export DOCKER_CONFIG=tmp
LOCAL_REGISTRY=127.0.0.1

rm -rf tmp
mkdir tmp

printf "* Stopping any running local containerify test registry...\n"
docker stop registry-containerify-insecure-test >/dev/null 2>&1 || echo "No running container registry, so nothing to stop"

printf "* Starting local containerify test registry on port 5443...\n"
docker run -d \
  --rm \
  --name registry-containerify-insecure-test \
  -e REGISTRY_HTTP_ADDR=0.0.0.0:5443 \
  -p 5443:5443 \
  registry:2 > /dev/null

printf "* Pulling node:alpine as base image...\n"
docker pull node:alpine  &>  /dev/null

printf "* Pushing base image to local containerify test registry...\n"
docker tag node:alpine ${LOCAL_REGISTRY}:5443/node > /dev/null
docker push ${LOCAL_REGISTRY}:5443/node > /dev/null

printf "* Running containerify to pull from and push result to the local containerify test registry...\n"
cd ../integration/app
npm ci
cd ../../localtest
../../lib/cli.js --registry http://${LOCAL_REGISTRY}:5443/v2/ \
                 --fromImage node \
                 --toImage containerify-integration-test:localtest \
                 --allowInsecureRegistries --doCrossMount \
                 --folder ../integration/app --setTimeStamp "2024-01-18T13:33:33.337Z"

printf "\n* Pulling image from registry to local docker daemon...\n"
docker pull ${LOCAL_REGISTRY}:5443/containerify-integration-test:localtest &> /dev/null

printf "* Running image on local docker daemon...\n"
docker run --rm -it ${LOCAL_REGISTRY}:5443/containerify-integration-test:localtest

printf "\n* Deleting image from registry to local docker daemon...\n"
docker rmi ${LOCAL_REGISTRY}:5443/containerify-integration-test:localtest > /dev/null

printf "* Stopping local containerify test registry...\n"
docker stop registry-containerify-insecure-test > /dev/null
rm -rf tmp

printf "\nSUCCESS!\n"
