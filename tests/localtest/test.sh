#!/bin/bash

set -e

export DOCKER_CONFIG=tmp
TESTUSER=testuser
TESTPASSWORD=testpassword
BASICAUTH=$(echo -n "$TESTUSER:$TESTPASSWORD" | base64)
LOCAL_REGISTRY=127.0.0.1

rm -rf tmp
mkdir -p tmp/certs
mkdir -p tmp/auth

printf "* Generating key for local registry...\n"
openssl req \
  -newkey rsa:4096 -nodes -sha256 -keyout tmp/certs/domain.key \
  -addext "subjectAltName = IP:127.0.0.1" \
  -subj "/C=NO/ST=containerify/L=containerify/O=containerify Integration/OU=Test Department/CN=containerify.test" \
  -x509 -days 365 -out tmp/certs/domain.crt > /dev/null 2>&1


printf "* Generating password for local registry...\n"
 docker run \
  --entrypoint htpasswd \
  httpd:2 -Bbn $TESTUSER $TESTPASSWORD > tmp/auth/htpasswd

printf "* Stopping any running local containerify test registry...\n"
docker stop registry-containerify-test >/dev/null 2>&1 || echo "No running container registry, so nothing to stop"

printf "* Starting local containerify test registry on port 5443...\n"
docker run -d \
  --rm \
  --name registry-containerify-test \
  -v "$(pwd)"/tmp/certs:/certs \
  -v "$(pwd)"/tmp/auth:/auth \
  -e REGISTRY_HTTP_ADDR=0.0.0.0:5443 \
  -e REGISTRY_HTTP_TLS_CERTIFICATE=/certs/domain.crt \
  -e REGISTRY_HTTP_TLS_KEY=/certs/domain.key \
  -e "REGISTRY_AUTH=htpasswd" \
  -e "REGISTRY_AUTH_HTPASSWD_REALM=Registry Realm" \
  -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd \
  -p 5443:5443 \
  registry:2 > /dev/null


printf "* Pulling node:alpine as base image...\n"
docker pull node:alpine  &>  /dev/null

printf "* Pushing base image to local containerify test registry...\n"
docker tag node:alpine ${LOCAL_REGISTRY}:5443/node > /dev/null
echo -n $TESTPASSWORD | docker login -u $TESTUSER --password-stdin ${LOCAL_REGISTRY}:5443
docker push ${LOCAL_REGISTRY}:5443/node > /dev/null

printf "* Running containerify to pull from and push result to the local containerify test registry...\n"
cd ../integration/app
npm ci
cd ../../localtest
NODE_EXTRA_CA_CERTS=tmp/certs/domain.crt ../../lib/cli.js \
  --fromImage node \
  --doCrossMount \
  --registry https://${LOCAL_REGISTRY}:5443/v2/ \
  --toImage containerify-integration-test:localtest \
  --folder ../integration/app --setTimeStamp "2023-03-07T12:53:10.471Z" \
  --token "Basic $BASICAUTH"


printf "\n* Pulling image from registry to local docker daemon...\n"
docker pull ${LOCAL_REGISTRY}:5443/containerify-integration-test:localtest &> /dev/null

printf "* Running image on local docker daemon...\n"
docker run --rm -it ${LOCAL_REGISTRY}:5443/containerify-integration-test:localtest

printf "\n* Deleting image from registry to local docker daemon...\n"
docker rmi ${LOCAL_REGISTRY}:5443/containerify-integration-test:localtest > /dev/null

printf "* Stopping local containerify test registry...\n"
docker stop registry-containerify-test > /dev/null
rm -rf tmp

printf "\nSUCCESS!\n"
