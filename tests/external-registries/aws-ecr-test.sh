#!/bin/sh

TOKEN=$(aws ecr get-authorization-token --output text --query 'authorizationData[].authorizationToken')

ACCOUNT=$(aws sts get-caller-identity --output text --query 'Account')

REGION=$(aws configure get region)

echo $TOKEN

printf "* Running containerify to pull from and push result to AWS ECR ...\n"
../../lib/cli.js --verbose --fromImage node:alpine --toRegistry https://$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/v2/ --toImage containerify-test:latest --folder . --customContent customContent --setTimeStamp "2024-01-15T20:00:00.000Z" --toToken "Basic $TOKEN"
