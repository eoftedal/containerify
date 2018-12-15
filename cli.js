#!/usr/bin/env node

const os = require('os');
const program  = require('commander');
const path = require('path');
const fse = require('fs-extra');

const Registry = require('./registry').Registry;
const DockerRegistry = require('./registry').DockerRegistry;
const appLayerCreator = require('./appLayerCreator');
const fileutil = require('./fileutil');
const tarExporter = require('./tarExporter');

const logger = require('./logger');


const possibleArgs = {
  '--fromRegistry <registry url>' : 'Optional: URL of registry to pull base image from - Default: https://registry-1.docker.io/v2/',
  '--fromImage <name:tag>'        : 'Required: Image name of base image - [path/]image:tag',
  '--fromToken <token>'           : 'Optional: Authentication token for from registry',
  '--toRegistry <registry url>'   : 'Optional: URL of registry to push base image to - Default: https://registry-1.docker.io/v2/',
  '--toImage <name:tag>'          : 'Required: Image name of target image - [path/]image:tag',
  '--toToken <token>'             : 'Optional: Authentication token for target registry',
  '--toTar <path>'                : 'Optional: Export to tar file',
  '--registry <path>'             : 'Optional: Convenience argument for setting both from and to registry',
  '--token <path>'                : 'Optional: Convenience argument for setting token for both from and to registry',
  '--folder <full path>'          : 'Required: Base folder of node application (contains package.json)',
  '--user <user>'                 : 'Optional: User account to run process in container - default: 1000',
  '--workdir <directory>'         : 'Optional: Workdir where node app will be added and run from - default: /app',
  '--entrypoint <entrypoint>'     : 'Optional: Entrypoint when starting container - default: npm start',
  '--verbose'                     : 'Verbose logging',
  '--allowInsecureRegistries'     : 'Allow insecure registries (with self-signed/untrusted cert)'
};

const keys = Object.keys(possibleArgs)
  .map(k => k.split(' ')[0].replace('--', ''));

Object.keys(possibleArgs)
  .reduce((program, k) => program.option(k, possibleArgs[k]), program)
  .parse(process.argv);


let options = {
  workdir : '/app',
  user: '1000',
  entrypoint: 'npm start'
};

keys.map(k => options[k] = program[k] || options[k]);

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

if(options.toRegistry.substr(-1) != '/') options.toRegistry += '/';
if(options.fromRegistry.substr(-1) != '/') options.fromRegistry += '/';

if (!options.fromRegistry && !options.fromImage.split(':')[0].includes('/')) {
  options.fromImage = 'library/' + options.fromImage;
}

async function run(options) {
  if (!(await fse.pathExists(options.folder))) throw new Error('No such folder: ' + options.folder);

  const tmpdir = require('fs').mkdtempSync(path.join(os.tmpdir(),'nib-'));
  let fromdir = await fileutil.ensureEmptyDir(path.join(tmpdir, 'from'));
  let todir = await fileutil.ensureEmptyDir(path.join(tmpdir, 'to'));

  let fromRegistry = options.fromRegistry ? new Registry(options.fromRegistry, options.fromToken) : new DockerRegistry(options.fromToken);
  await fromRegistry.download(options.fromImage, fromdir);  

  await appLayerCreator.addLayers(tmpdir, fromdir, todir, options);

  if (options.toTar) {
    await tarExporter.saveToTar(todir, tmpdir, options.toTar, options.toImage);
  }
  if (options.toRegistry) {
    let toRegistry = new Registry(options.toRegistry, options.toToken);
    await toRegistry.upload(options.toImage, todir);  
  }
  
}

run(options).then(() => {
  logger.info('Done!');
  process.exit(0);
}).catch(error => {
  logger.error(error);
  process.exit(1);
});

