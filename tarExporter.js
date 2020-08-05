const tar = require('tar');
const fs = require('fs').promises;
const fss = require('fs');
const fse = require('fs-extra');
const path = require('path');

const logger = require('./logger');

const tarDefaultConfig = {
  preservePaths: false, 
  portable: true, 
  follow: true  
};

async function saveToTar(fromdir, tmpdir, toPath, repoTags, options) {
  logger.info('Creating ' +  toPath + ' ...');

  let manifestFile = path.join(fromdir, 'manifest.json');
  let manifest = await fse.readJson(manifestFile);
  let configFile = path.join(fromdir, manifest.config.digest.split(':')[1] + '.json');
  let config = await fse.readJson(configFile);


  let tardir = path.join(tmpdir, 'totar'); 
  await fs.mkdir(tardir);
  let layers = await Promise.all(
    manifest.layers
      .map(x => x.digest.split(':')[1])
      .map(async x => {
        let fn = x + ((await fse.pathExists(path.join(fromdir, x + '.tar.gz'))) ? '.tar.gz' : '.tar');
        await fse.copy(path.join(fromdir, fn), path.join(tardir, fn));
        return fn;
      })
  );

  let simpleManifest = [{
    config  : 'config.json',
    repoTags: [repoTags],
    layers  : layers
  }];
  await fs.writeFile(path.join(tardir, 'manifest.json'), JSON.stringify(simpleManifest));
  await fs.writeFile(path.join(tardir, 'config.json'), JSON.stringify(config));
  await tar.c(Object.assign({}, tarDefaultConfig, {
    cwd: tardir,
    file: toPath,
    noMtime: (!options.setTimeStamp),
    mtime: options.setTimeStamp
  }), ['config.json', 'manifest.json'].concat(layers));
  logger.info('Finished ' + toPath);
}

module.exports = {
  saveToTar : saveToTar
};