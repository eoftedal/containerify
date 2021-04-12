#!/usr/bin/env node

const os = require('os');
const program  = require('commander');
const path = require('path');
const fse = require('fs-extra');
const fs = require('fs');

const Registry = require('./registry').Registry;
const DockerRegistry = require('./registry').DockerRegistry;
const appLayerCreator = require('./appLayerCreator');
const fileutil = require('./fileutil');
const tarExporter = require('./tarExporter');

const logger = require('./logger');


const possibleArgs = {
  '--fromImage <name:tag>'        : 'Required: Image name of base image - [path/]image:tag',
  '--toImage <name:tag>'          : 'Required: Image name of target image - [path/]image:tag',
  '--folder <full path>'          : 'Required: Base folder of node application (contains package.json)',
  '--fromRegistry <registry url>' : 'Optional: URL of registry to pull base image from - Default: https://registry-1.docker.io/v2/',
  '--fromToken <token>'           : 'Optional: Authentication token for from registry',
  '--toRegistry <registry url>'   : 'Optional: URL of registry to push base image to - Default: https://registry-1.docker.io/v2/',
  '--toToken <token>'             : 'Optional: Authentication token for target registry',
  '--toTar <path>'                : 'Optional: Export to tar file',
  '--registry <path>'             : 'Optional: Convenience argument for setting both from and to registry',
  '--token <path>'                : 'Optional: Convenience argument for setting token for both from and to registry',
  '--user <user>'                 : 'Optional: User account to run process in container - default: 1000',
  '--workdir <directory>'         : 'Optional: Workdir where node app will be added and run from - default: /app',
  '--entrypoint <entrypoint>'     : 'Optional: Entrypoint when starting container - default: npm start',
  '--labels <labels>'             : 'Optional: Comma-separated list of key value pairs to use as labels',
  '--label <label>'               : 'Optional: Single label (name=value). This option can be used multiple times.',
  '--setTimeStamp <timestamp>'    : 'Optional: Set a specific ISO 8601 timestamp on all entries (e.g. git commit hash). Default: 1970 in tar files, and current time on manifest/config',
  '--verbose'                     : 'Verbose logging',
  '--allowInsecureRegistries'     : 'Allow insecure registries (with self-signed/untrusted cert)',
  '--customContent <dirs/files>'  : 'Optional: Skip normal node_modules and applayer and include specified root folder files/directories instead',
  '--extraContent <dirs/files>'   : 'Optional: Add specific content. Specify as local-path:absolute-container-path,local-path2:absolute-container-path2 etc',
  '--layerOwner <gid:uid>'        : 'Optional: Set specific gid and uid on files in the added layers',
  '--buildFolder <path>'          : 'Optional: Use a specific build folder when creating the image',

};

const keys = Object.keys(possibleArgs)
  .map(k => k.split(' ')[0].replace('--', ''));

let labels = {};

program.on('option:label', (ops) => {
  //Can't use split here, because = might be in the label value
  let splitPoint = ops.indexOf("="); 
  labels[ops.substr(0, splitPoint)] = ops.substring(splitPoint+1);
});


Object.keys(possibleArgs)
  .reduce((program, k) => program.option(k, possibleArgs[k]), program)
  .parse(process.argv);


let options = {
  workdir : '/app',
  user: '1000',
  entrypoint: 'npm start'
};

keys.map(k => options[k] = program[k] || options[k]);

delete options["label"];

function splitLabelsIntoObject(labelsString) {
  let labels = {};
  labelsString.split(',').map(l => l.split('=')).map(l => labels[l[0]] = l[1]);
  return labels;
}

let labelsOpt = options.labels ? splitLabelsIntoObject(options.labels) : {};
Object.keys(labels).map(k => labelsOpt[k] = labels[k]);
options.labels = labelsOpt;


function exitWithErrorIf(check, error) {
  if (check) {
    logger.error('ERROR: ' + error);
    program.outputHelp();
    process.exit(1);
  }
}

if (options.verbose) logger.enableDebug();
if (options.allowInsecureRegistries) process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

exitWithErrorIf(options.registry && options.fromRegistry, 'Do not set both --registry and --fromRegistry');
exitWithErrorIf(options.registry && options.toRegistry, 'Do not set both --registry and --toRegistry');
exitWithErrorIf(options.token && options.fromToken, 'Do not set both --token and --fromToken');
exitWithErrorIf(options.token && options.toToken, 'Do not set both --token and --toToken');

if (options.setTimeStamp) {
  try {
    options.setTimeStamp = new Date(options.setTimeStamp);
  } catch(e) {
    exitWithErrorIf(true, 'Failed to parse date: ' + e);
  }
  logger.info('Setting all dates to: ' + options.setTimeStamp);
}

if (options.layerOwner) {
  if (!options.layerOwner.match("^[0-9]+:[0-9]+$")) {
    exitWithErrorIf(true, 'layerOwner should be on format <number>:<number> (e.g. 1000:1000) but was: ' + options.layerOwner);
  }
}


if (options.registry) {
  options.fromRegistry = options.registry;
  options.toRegistry = options.registry;
}
if (options.token) {
  options.fromToken = options.token;
  options.toToken = options.token;
}

exitWithErrorIf(!options.folder, '--folder must be specified');
exitWithErrorIf(!options.fromImage, '--fromImage must be specified');
exitWithErrorIf(!options.toImage, '--toImage must be specified');
exitWithErrorIf(!options.toRegistry && !options.toTar, 'Must specify either --toTar or --toRegistry');
exitWithErrorIf(!options.toRegistry && !options.toToken && !options.toTar, 'A token must be given when uploading to docker hub');

if(options.toRegistry && options.toRegistry.substr(-1) != '/') options.toRegistry += '/';
if(options.fromRegistry && options.fromRegistry.substr(-1) != '/') options.fromRegistry += '/';

if (!options.fromRegistry && !options.fromImage.split(':')[0].includes('/')) {
  options.fromImage = 'library/' + options.fromImage;
}

if (options.customContent) {
  options.customContent = options.customContent.split(",");
  options.customContent.forEach(p => {
    exitWithErrorIf(!fs.existsSync(p), 'Could not find ' + p + ' in the base folder ' + options.folder)
  });
}

if (options.extraContent) {
  options.extraContent = options.extraContent.split(",").map(x => x.split(":"));
  options.extraContent.forEach(p => {
    exitWithErrorIf(p.length != 2, 'Invalid extraContent - use comma between files/dirs, and : to separate local path and container path')
    exitWithErrorIf(!fs.existsSync(p[0]), 'Could not find ' + p[0] + ' in the base folder ' + options.folder)
  });
}

async function run(options) {
  if (!(await fse.pathExists(options.folder))) throw new Error('No such folder: ' + options.folder);

  const tmpdir = require('fs').mkdtempSync(path.join(os.tmpdir(),'doqr-'));
  logger.debug('Using ' + tmpdir);
  let fromdir = await fileutil.ensureEmptyDir(path.join(tmpdir, 'from'));
  let todir = await fileutil.ensureEmptyDir(path.join(tmpdir, 'to'));

  let fromRegistry = options.fromRegistry ? new Registry(options.fromRegistry, options.fromToken) : new DockerRegistry(options.fromToken);
  await fromRegistry.download(options.fromImage, fromdir);  

  await appLayerCreator.addLayers(tmpdir, fromdir, todir, options);

  if (options.toTar) {
    await tarExporter.saveToTar(todir, tmpdir, options.toTar, options.toImage, options);
  }
  if (options.toRegistry) {
    let toRegistry = new Registry(options.toRegistry, options.toToken);
    await toRegistry.upload(options.toImage, todir);  
  }
  logger.debug('Deleting ' + tmpdir + ' ...');
  await fse.remove(tmpdir);
  logger.debug('Done');
}

run(options).then(() => {
  logger.info('Done!');
  process.exit(0);
}).catch(error => {
  logger.error(error);
  process.exit(1);
});

