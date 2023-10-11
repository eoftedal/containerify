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
mkdir -p tmp/layercache

echo "Building image 1..."

../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v1.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache --verbose  >/dev/null

echo "Building image 2..."

../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v2.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache --verbose >/dev/null

echo "Building image 3..."

../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder . --toTar tmp/v3.tar --customContent customContent --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache > /dev/null

echo "Building image 4..."

../../lib/cli.js --file ./file/containerify.json --toTar tmp/v4.tar --setTimeStamp "2023-03-07T12:53:10.471Z" --layerCacheFolder tmp/layercache > /dev/null

echo "Untaring content ..."
tar -xf tmp/v1.tar -C tmp/v1/content/
tar -xf tmp/v2.tar -C tmp/v2/content/
tar -xf tmp/v3.tar -C tmp/v3/content/
tar -xf tmp/v4.tar -C tmp/v4/content/

jqscript='if (.config.Entrypoint == ["npm", "start"]) then true else false end'

echo "Checking that entrypoint is correctly set for 3 ..."
if [[ $(cat tmp/v4/content/config.json | jq "$jqscript") != "true" ]]; then
  echo "ERROR: wrong entrypoint set for 3";
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

rm -rf tmp
echo "Success!"
