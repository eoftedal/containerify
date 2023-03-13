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

echo "Building image 1..."

../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v1.tar --setTimeStamp "2023-03-07T12:53:10.471Z"  >/dev/null

echo "Building image 2..."

../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder app --toTar tmp/v2.tar --setTimeStamp "2023-03-07T12:53:10.471Z" >/dev/null

echo "Building image 3..."

../../lib/cli.js --fromImage node:alpine --toImage containerify:demo-app --folder . --toTar tmp/v3.tar --customContent customContent --setTimeStamp "2023-03-07T12:53:10.471Z" >/dev/null


echo "Untaring content ..."
tar -xf tmp/v1.tar -C tmp/v1/content/
tar -xf tmp/v2.tar -C tmp/v2/content/
tar -xf tmp/v3.tar -C tmp/v3/content/

echo "Checking that config files for 1 and 2 are equal ..."
if ! cmp -s tmp/v1/content/config.json tmp/v2/content/config.json; then
   echo "ERROR: config.jsons are different"; 
   exit 1;
fi

echo "Checking that manifest files for 1 and 2 are equal ..."
if ! cmp -s tmp/v1/content/manifest.json tmp/v2/content/manifest.json; then
   echo "ERROR: manifest.jsons are different"; 
   exit 1;
fi

echo "Checking that config files for 1 and 3 are not equal ..."
if cmp -s tmp/v1/content/config.json tmp/v3/content/maniconfigfest.json; then
   echo "ERROR: config.jsons are the same"; 
   exit 1;
fi

echo "Checking that manifest files for 1 and 3 are not equal ..."
if cmp -s tmp/v1/content/manifest.json tmp/v3/content/manifest.json; then
   echo "ERROR: manifest.jsons are the same"; 
   exit 1;
fi

rm -rf tmp
echo "Success!"