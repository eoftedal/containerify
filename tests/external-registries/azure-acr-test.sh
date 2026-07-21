#!/bin/bash

set -e
if [[ -z "$ACR_NAME" ]]; then
    echo "ERROR: ACR_NAME not set (e.g. export ACR_NAME=myregistry for myregistry.azurecr.io)"
    exit 1
fi

LOGIN_SERVER="$ACR_NAME.azurecr.io"

# 'az acr login --expose-token' returns a token that is used together with the
# well-known null-GUID username. See
# https://learn.microsoft.com/azure/container-registry/container-registry-authentication
TOKEN=$(az acr login --name "$ACR_NAME" --expose-token --output tsv --query accessToken)
BASIC=$(printf "00000000-0000-0000-0000-000000000000:%s" "$TOKEN" | base64 | tr -d '\n')

printf "* Running containerify to pull from and push result to Azure Container Registry ...\n"
../../lib/cli.js --verbose --fromImage node:alpine --toRegistry "https://$LOGIN_SERVER/v2/" --toImage containerify-test:latest --folder . --customContent customContent --setTimeStamp "2024-01-15T20:00:00.000Z" --toToken "Basic $BASIC"

printf "* Verifying the pushed image can be pulled with docker ...\n"
echo "$TOKEN" | docker login "$LOGIN_SERVER" --username "00000000-0000-0000-0000-000000000000" --password-stdin
docker pull "$LOGIN_SERVER/containerify-test:latest"
