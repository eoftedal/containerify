const tar = require('tar');
const fs = require('fs').promises;
const fse = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const Gunzip = require('minizlib').Gunzip;

const fileutil = require('./fileutil');
const logger = require('./logger');

const depLayerPossibles = ['package.json', 'package-lock.json', 'node_modules'];
const ignore = ['.git', '.gitignore']

const tarDefaultConfig = {
  preservePaths: false, 
  portable: true, 
  follow: true
};

function calculateHashOfBuffer(buf) {
  let hash = crypto.createHash('sha256');
  hash.update(buf);
  return hash.digest('hex');
}

function calculateHash(path) {
  return new Promise((resolve, reject) => {
    let hash = crypto.createHash('sha256');
    let stream = require('fs').createReadStream(path);
    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function copySync(src, dest) {
  const copyOptions = { overwrite: true, dereference: true };
  fse.copySync(src, dest, copyOptions);
}

function addEmptyLayer(config, options, operation, action) {
  logger.info(`Applying ${operation}`);
  config.history.push({
    created: options.setTimeStamp || new Date().toISOString(),
    created_by: '/bin/sh -c #(nop) ' + operation,
    empty_layer: true
  });
  action(config);
}

async function getHashOfUncompressed(file) {
  return new Promise((resolve, reject) => {
    let hash = crypto.createHash('sha256');
    let gunzip = new Gunzip();
    gunzip.on('data', chunk => hash.update(chunk));
    gunzip.on('end', () => resolve(hash.digest('hex')));
    gunzip.on('error', err => reject(err));
    require('fs').createReadStream(file).pipe(gunzip).on('error', err => reject(err));
  });
}

async function addDataLayer(tmpdir, todir, options, config, layers, files, comment) {
  logger.info('Adding layer for ' + comment + ' ...');
  let buildDir = await fileutil.ensureEmptyDir(path.join(tmpdir, 'build'));
  files.map(f => {
    copySync(path.join(options.folder, f), path.join(buildDir, f));  
  });  
  let layerFile = path.join(todir, 'layer.tar.gz');
  await tar.c(Object.assign({}, tarDefaultConfig, {
    prefix: options.workdir, 
    cwd: buildDir, 
    file: layerFile,
    gzip: true,
    noMtime: (!options.setTimeStamp),
    mtime: options.setTimeStamp
  }), files);
  let fhash = await calculateHash(layerFile);
  let finalName = path.join(todir, fhash + '.tar.gz');
  await fse.move(layerFile, finalName);
  layers.push({
    mediaType : 'application/vnd.docker.image.rootfs.diff.tar.gzip',
    size: await fileutil.sizeOf(finalName),
    digest: 'sha256:' + fhash
  });
  let dhash = await getHashOfUncompressed(finalName);
  config.rootfs.diff_ids.push('sha256:' + dhash);
  config.history.push({
    created: options.setTimeStamp || new Date().toISOString(),
    created_by: 'doqr',
    comment: comment
  });
}


async function copyLayers(fromdir, todir, layers) {
  await Promise.all(layers.map(async layer => {
    let file = layer.digest.split(':')[1] + (layer.mediaType.includes('tar.gzip')  ? '.tar.gz' : '.tar');
    await fse.copy(path.join(fromdir, file), path.join(todir, file));
  }));
}

function parseCommandLineToParts(entrypoint) {
  return entrypoint.split('"')
    .map((p,i) => {
      if (i % 2 == 1) return [p];
      return p.split(' ');
    })
    .reduce((a, b) => a.concat(b), [])
    .filter(a => a != '');
}

function splitLabelsIntoObject(labelsString) {
  let labels = {};
  labelsString.split(',').map(l => l.split('=')).map(l => labels[l[0]] = l[1]);
  return labels;
}

async function addAppLayers(options, config, todir, manifest, tmpdir) {
  if (options.customContent) {
    addLabelsLayer(options, config, todir, manifest, tmpdir)
    await addDataLayer(tmpdir, todir, options, config, manifest.layers, options.customContent, 'custom');
  } else {
    addEmptyLayer(config, options, `WORKDIR ${options.workdir}`, config => config.config.WorkingDir = options.workdir);
    let entrypoint = parseCommandLineToParts(options.entrypoint);
    addEmptyLayer(config, options, `ENTRYPOINT ${JSON.stringify(entrypoint)}`, config => config.config.Entrypoint = entrypoint);
    addEmptyLayer(config, options, `USER ${options.user}`, config => {
      config.config.user = options.user;
      config.container_config.user = options.user;
    });
    addLabelsLayer(options, config, todir, manifest, tmpdir)
    let appFiles = (await fs.readdir(options.folder)).filter(l => !ignore.includes(l));
    let depLayerContent = appFiles.filter(l => depLayerPossibles.includes(l));
    let appLayerContent = appFiles.filter(l => !depLayerPossibles.includes(l));

    await addDataLayer(tmpdir, todir, options, config, manifest.layers, depLayerContent, 'dependencies');
    await addDataLayer(tmpdir, todir, options, config, manifest.layers, appLayerContent, 'app');
  }
}
async function addLabelsLayer(options, config, todir, manifest, tmpdir) {
  if (options.labels) {
    let labels = splitLabelsIntoObject(options.labels);
    addEmptyLayer(config, options, `LABELS ${options.labels}`, config => {
      config.config.labels = labels;
      config.container_config.labels = labels;
    });
  }
}

async function addLayers(tmpdir, fromdir, todir, options) {

  logger.info('Parsing image ...');
  let manifest = await fse.readJson(path.join(fromdir, 'manifest.json'));
  let config = await fse.readJson(path.join(fromdir, 'config.json'));

  logger.info('Adding new layers...');
  await copyLayers(fromdir, todir, manifest.layers);
  await addAppLayers(options, config, todir, manifest, tmpdir);

  logger.info('Writing final image...');
  let configContent = Buffer.from(JSON.stringify(config));
  let configHash = calculateHashOfBuffer(configContent); 
  let configFile = path.join(todir, configHash + '.json');
  await fs.writeFile(configFile, configContent);
  manifest.config.digest = 'sha256:' + configHash;
  manifest.config.size = await fileutil.sizeOf(configFile);
  await fs.writeFile(path.join(todir, 'manifest.json'), JSON.stringify(manifest)); 
}

module.exports = {
  addLayers : addLayers
};

