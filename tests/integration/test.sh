#!/bin/bash
set -e

echo "Preparing demoapp..."
cd app
npm install > /dev/null
cd ..
rm -rf tmp
mkdir -p tmp/v1/content/
mkdir -p tmp/v2/content/
mkdir -p tmp/v3/content/
mkdir -p tmp/v4/content/
mkdir -p tmp/v5/content/
mkdir -p tmp/layercache

echo "Building image 1..."

../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v1.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache --verbose  --writeDigestTo tmp/digest1 >/dev/null

cat tmp/digest1
echo ""
echo ""

echo "Building image 2..."

../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v2.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache --verbose --writeDigestTo tmp/digest2 >/dev/null
cat tmp/digest2
echo ""
echo ""

echo "Building image 3..."

../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder . --toTar tmp/v3.tar --customContent customContent --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache --writeDigestTo tmp/digest3 > /dev/null
cat tmp/digest3
echo ""
echo ""

echo "Building image 4..."
../../lib/cli.js --file ./file/containerify.json --toTar tmp/v4.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache --writeDigestTo tmp/digest4 > /dev/null
cat tmp/digest4
echo ""
echo ""

echo "Building image 5 (with healthcheck)..."
../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v5.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache \
  --healthcheck-cmd "curl -f http://localhost:3000/health || exit 1" \
  --healthcheck-interval 30s \
  --healthcheck-timeout 10s \
  --healthcheck-start-period 5s \
  --healthcheck-start-interval 5s \
  --healthcheck-retries 3 > /dev/null
echo ""
echo ""


echo "Untaring content ..."
tar -xf tmp/v1.tar -C tmp/v1/content/
tar -xf tmp/v2.tar -C tmp/v2/content/
tar -xf tmp/v3.tar -C tmp/v3/content/
tar -xf tmp/v4.tar -C tmp/v4/content/
tar -xf tmp/v5.tar -C tmp/v5/content/

jqscript='if (.config.Entrypoint == ["npm", "start"]) then true else false end'

echo "Checking that entrypoint is correctly set for 4 ..."
if [[ $(cat tmp/v4/content/config.json | jq "$jqscript") != "true" ]]; then
  echo "ERROR: wrong entrypoint set for 4";
  exit 1;
fi

echo "Checking that config files for 1 and 2 are equal ..."
if ! cmp -s tmp/v1/content/config.json tmp/v2/content/config.json; then
   echo "ERROR: config.jsons are different for 1 and 2"; 
   exit 1;
fi

echo "Checking that manifest files for 1 and 2 are equal ..."
if ! cmp -s tmp/v1/content/manifest.json tmp/v2/content/manifest.json; then
   echo "ERROR: manifest.jsons are different for 1 and 2"; 
   exit 1;
fi

echo "Checking that config files for 1 and 3 are not equal ..."
if cmp -s tmp/v1/content/config.json tmp/v3/content/config.json; then
   echo "ERROR: config.jsons are the same for 1 and 3"; 
   exit 1;
fi

echo "Checking that manifest files for 1 and 3 are not equal ..."
if cmp -s tmp/v1/content/manifest.json tmp/v3/content/manifest.json; then
   echo "ERROR: manifest.jsons are the same for 1 and 3"; 
   exit 1;
fi

echo "Checking that config files for 3 and 4 are equal ..."
if cmp -s tmp/v3/content/config.json tmp/v4/content/config.json; then
   echo "ERROR: config.jsons are the same for 3 and 4";
   exit 1;
fi

echo "Checking that manifest files for 3 and 4 are equal ..."
if ! cmp -s tmp/v3/content/manifest.json tmp/v4/content/manifest.json; then
   echo "ERROR: manifest.jsons are not the same for 3 and 4";
   exit 1;
fi

echo "Checking healthcheck is set correctly in image 5 ..."
hc_test=$(cat tmp/v5/content/config.json | jq -r '.config.Healthcheck.Test[0]')
if [[ "$hc_test" != "CMD-SHELL" ]]; then
  echo "ERROR: expected Healthcheck.Test[0] to be CMD-SHELL, got: $hc_test";
  exit 1;
fi
hc_cmd=$(cat tmp/v5/content/config.json | jq -r '.config.Healthcheck.Test[1]')
if [[ "$hc_cmd" != "curl -f http://localhost:3000/health || exit 1" ]]; then
  echo "ERROR: unexpected Healthcheck command: $hc_cmd";
  exit 1;
fi
hc_interval=$(cat tmp/v5/content/config.json | jq '.config.Healthcheck.Interval')
if [[ "$hc_interval" != "30000000000" ]]; then
  echo "ERROR: expected Healthcheck.Interval to be 30000000000, got: $hc_interval";
  exit 1;
fi
hc_timeout=$(cat tmp/v5/content/config.json | jq '.config.Healthcheck.Timeout')
if [[ "$hc_timeout" != "10000000000" ]]; then
  echo "ERROR: expected Healthcheck.Timeout to be 10000000000, got: $hc_timeout";
  exit 1;
fi
hc_start_period=$(cat tmp/v5/content/config.json | jq '.config.Healthcheck.StartPeriod')
if [[ "$hc_start_period" != "5000000000" ]]; then
  echo "ERROR: expected Healthcheck.StartPeriod to be 5000000000, got: $hc_start_period";
  exit 1;
fi
hc_start_interval=$(cat tmp/v5/content/config.json | jq '.config.Healthcheck.StartInterval')
if [[ "$hc_start_interval" != "5000000000" ]]; then
  echo "ERROR: expected Healthcheck.StartInterval to be 5000000000, got: $hc_start_interval";
  exit 1;
fi
hc_retries=$(cat tmp/v5/content/config.json | jq '.config.Healthcheck.Retries')
if [[ "$hc_retries" != "3" ]]; then
  echo "ERROR: expected Healthcheck.Retries to be 3, got: $hc_retries";
  exit 1;
fi

echo "Checking that image 5 config differs from image 1 (healthcheck makes it different) ..."
if cmp -s tmp/v1/content/config.json tmp/v5/content/config.json; then
   echo "ERROR: config.jsons are the same for 1 and 5 (healthcheck should make them differ)";
   exit 1;
fi

rm -rf tmp
echo "Success!"
