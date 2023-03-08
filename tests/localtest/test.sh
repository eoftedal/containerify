#!/bin/bash

set -e

TESTUSER=testuser
TESTPASSWORD=testpassword
BASICAUTH=$(echo -n "$TESTUSER:$TESTPASSWORD" | base64)

rm -rf tmp
mkdir -p tmp/certs
mkdir -p tmp/auth

printf "Generating key for local registry...\n"
openssl req \
  -newkey rsa:4096 -nodes -sha256 -keyout tmp/certs/domain.key \
  -addext "subjectAltName = DNS:myregistry.domain.com" \
  -subj "/C=NO/ST=Doqr/L=Doqr/O=Doqr Integration/OU=Test Department/CN=doqr.test" \
  -x509 -days 365 -out tmp/certs/domain.crt


printf "\nGenerating password for local registry...\n"
 docker run \
  --entrypoint htpasswd \
  httpd:2 -Bbn $TESTUSER $TESTPASSWORD > tmp/auth/htpasswd

printf "\nStopping any running local doqr test registry...\n"
docker stop registry-doqr-test || echo "No running container registry, so nothing to stop"

printf "\nStarting local doqr test registry on port 5443...\n"
docker run -d \
  --rm \
  --name registry-doqr-test \
  -v "$(pwd)"/tmp/certs:/certs \
  -v "$(pwd)"/tmp/auth:/auth \
  -e REGISTRY_HTTP_ADDR=0.0.0.0:5443 \
  -e REGISTRY_HTTP_TLS_CERTIFICATE=/certs/domain.crt \
  -e REGISTRY_HTTP_TLS_KEY=/certs/domain.key \
  -e "REGISTRY_AUTH=htpasswd" \
  -e "REGISTRY_AUTH_HTPASSWD_REALM=Registry Realm" \
  -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd \
  -p 5443:5443 \
  registry:2

printf "\nPulling node:alpine as base image...\n"
docker pull node:alpine 

printf "\nPushing base image to local doqr test registry...\n"
docker tag node:alpine localhost:5443/node
docker push localhost:5443/node

printf "\nRunning doqr to pull from and push result to the local doqr test registry...\n"
../../lib/cli.js --fromImage node --registry https://localhost:5443/v2/ --toImage doqr-integration-test:localtest --folder ../integration/app --setTimeStamp "2023-03-07T12:53:10.471Z" --allowInsecureRegistries --token "Basic $BASICAUTH"


printf "\nPulling image from registry to local docker daemon...\n"
docker pull localhost:5443/doqr-integration-test:localtest

printf "\nRunning image on local docker daemon...\n"
docker run --rm -it localhost:5443/doqr-integration-test:localtest

printf "\nDeleting image from registry to local docker daemon...\n"
docker rmi localhost:5443/doqr-integration-test:localtest

printf "\nStopping local doqr test registry...\n"
docker stop registry-doqr-test


printf "\nSUCCESS!\n"