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
mkdir -p tmp/v6/content/
mkdir -p tmp/v7/content/
mkdir -p tmp/v8/content/
mkdir -p tmp/v9/content/
mkdir -p tmp/v10/content/
mkdir -p tmp/layercache

echo "Building image 1..."

../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v1.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache --verbose  --writeDigestTo tmp/digest1 --writePrefixedDigestTo tmp/pdigest1 >/dev/null

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

echo "Building image 6 (buildFolder reuse / EEXIST regression)..."
../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v6a.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache --buildFolder tmp/bf > /dev/null
# Second run reuses the same --buildFolder; the old code crashed here with EEXIST on the totar dir
../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v6.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache --buildFolder tmp/bf > /dev/null
echo ""

echo "Building image 7 (config-file auto-detection from --folder)..."
../../lib/cli.js --folder configdir --toTar tmp/v7.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache > /dev/null
echo ""

echo "Building images 8/9 (layerOwner + setTimeStamp, reproducible) and 10 (different timestamp)..."
../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v8.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerOwner 1000:1000 --layerCacheFolder tmp/layercache > /dev/null
../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v9.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerOwner 1000:1000 --layerCacheFolder tmp/layercache > /dev/null
../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v10.tar --setTimeStamp "2024-01-02T03:04:05.000Z" --layerOwner 1000:1000 --layerCacheFolder tmp/layercache > /dev/null
echo ""
echo ""


echo "Untaring content ..."
tar -xf tmp/v1.tar -C tmp/v1/content/
tar -xf tmp/v2.tar -C tmp/v2/content/
tar -xf tmp/v3.tar -C tmp/v3/content/
tar -xf tmp/v4.tar -C tmp/v4/content/
tar -xf tmp/v5.tar -C tmp/v5/content/
tar -xf tmp/v6.tar -C tmp/v6/content/
tar -xf tmp/v7.tar -C tmp/v7/content/
tar -xf tmp/v8.tar -C tmp/v8/content/
tar -xf tmp/v9.tar -C tmp/v9/content/
tar -xf tmp/v10.tar -C tmp/v10/content/

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

echo "Checking --writePrefixedDigestTo output ..."
pd=$(cat tmp/pdigest1)
if ! echo "$pd" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
  echo "ERROR: prefixed digest not in expected format: $pd";
  exit 1;
fi
if [[ "$pd" != "sha256:$(cat tmp/digest1)" ]]; then
  echo "ERROR: prefixed digest ($pd) != sha256: + bare digest (sha256:$(cat tmp/digest1))";
  exit 1;
fi

echo "Checking buildFolder reuse produced both tarballs (EEXIST regression) ..."
if [[ ! -s tmp/v6a.tar || ! -s tmp/v6.tar ]]; then
  echo "ERROR: buildFolder reuse did not produce both tar files";
  exit 1;
fi

echo "Checking config-file auto-detection from --folder (7) applied the file's label ..."
adlabel=$(cat tmp/v7/content/config.json | jq -r '.config.Labels.autodetect')
if [[ "$adlabel" != "yes" ]]; then
  echo "ERROR: expected auto-detected config-file label autodetect=yes, got: $adlabel";
  exit 1;
fi

echo "Checking layerOwner+setTimeStamp build is reproducible (8 == 9) ..."
if ! cmp -s tmp/v8/content/config.json tmp/v9/content/config.json; then
  echo "ERROR: config.jsons differ for 8 and 9 (layerOwner build not reproducible)";
  exit 1;
fi
if ! cmp -s tmp/v8/content/manifest.json tmp/v9/content/manifest.json; then
  echo "ERROR: manifest.jsons differ for 8 and 9 (layerOwner build not reproducible)";
  exit 1;
fi

echo "Checking layerOwner honors --setTimeStamp (8 vs 10 layer digests differ) ..."
layers8=$(cat tmp/v8/content/manifest.json | jq -c '.[0].layers')
layers10=$(cat tmp/v10/content/manifest.json | jq -c '.[0].layers')
if [[ "$layers8" == "$layers10" ]]; then
  echo "ERROR: layer digests identical for different --setTimeStamp values; --layerOwner is discarding --setTimeStamp";
  exit 1;
fi

echo "Checking layerOwner tar entry mtimes reflect --setTimeStamp (not epoch) ..."
applayer=$(cat tmp/v8/content/manifest.json | jq -r '.[0].layers[-1]')
years=$(tar -tvzf "tmp/v8/content/$applayer" | grep -oE '(19|20)[0-9]{2}' | sort -u)
if echo "$years" | grep -q '1970'; then
  echo "ERROR: layer entries have 1970 mtime; --layerOwner discarded --setTimeStamp";
  exit 1;
fi
if ! echo "$years" | grep -q '2023'; then
  echo "ERROR: expected layer entry mtimes in 2023 (from --setTimeStamp), got years: $years";
  exit 1;
fi

rm -rf tmp
echo "Success!"
