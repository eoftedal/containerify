#!/bin/bash

set -e
if [[ -z "$GITHUB_TOKEN" ]]; then
    echo "ERROR: GITHUB_TOKEN not set (see https://github.com/settings/tokens/new?scopes=write:packages for running locally)"
    exit 1
fi

printf "* Running containerify to pull from and push result to gchr.io ...\n"
../../lib/cli.js --verbose --doCrossMount --from ghcr.io/docker-mirror/node:alpine --to ghcr.io/eoftedal/containerify-integrationtest:latest --folder . --customContent customContent --setTimeStamp "2024-01-15T20:00:00.000Z" --token "$GITHUB_TOKEN"
