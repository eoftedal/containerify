#!/bin/bash

set -e
if [[ -z "$GCP_LOCATION" || -z "$GCP_PROJECT" || -z "$GCP_REPO" ]]; then
    echo "ERROR: set GCP_LOCATION, GCP_PROJECT and GCP_REPO (e.g. GCP_LOCATION=europe-north1 GCP_PROJECT=my-project GCP_REPO=my-repo)"
    exit 1
fi

LOGIN_SERVER="$GCP_LOCATION-docker.pkg.dev"

# 'oauth2accesstoken' is the well-known username for Google Artifact Registry.
# See https://cloud.google.com/artifact-registry/docs/docker/authentication
TOKEN=$(gcloud auth print-access-token)
BASIC=$(printf "oauth2accesstoken:%s" "$TOKEN" | base64 | tr -d '\n')

printf "* Running containerify to pull from and push result to Google Artifact Registry ...\n"
../../lib/cli.js --verbose --fromImage node:alpine --toRegistry "https://$LOGIN_SERVER/v2/" --toImage "$GCP_PROJECT/$GCP_REPO/containerify-test:latest" --folder . --customContent customContent --setTimeStamp "2024-01-15T20:00:00.000Z" --toToken "Basic $BASIC"

printf "* Verifying the pushed image can be pulled with docker ...\n"
echo "$TOKEN" | docker login "$LOGIN_SERVER" --username oauth2accesstoken --password-stdin
docker pull "$LOGIN_SERVER/$GCP_PROJECT/$GCP_REPO/containerify-test:latest"
