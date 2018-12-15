const https = require('https');
const http = require('http');
const URL = require('url');
const fs = require('fs').promises;
const path = require('path');
const fse = require('fs-extra');

const fileutil = require('./fileutil');
const logger = require('./logger');

const redirectCodes = [307,303,302];

function request(options, callback) {
  return (options.protocol == 'https:' ? https : http).request(options, res => {
    callback(res);
  });
}


function isOk(httpStatus) {
  return httpStatus >= 200 && httpStatus < 300;
}

function getHash(digest) {
  return digest.split(':')[1];
}

function parseImage(imageStr) {
  let ar = imageStr.split(':');
  let tag = ar[1] || 'latest';
  let ipath = ar[0];
  return { path: ipath, tag: tag };
}

function toError(res) {
  return `Unexpected HTTP status ${res.statusCode} : ${res.statusMessage}`;
}

function dl(uri, headers) {
  logger.debug('dl', uri);
  return new Promise((resolve, reject) => {
    followRedirects(uri, headers, res => {
      logger.debug(res.statusCode, res.statusMessage, res.headers['content-type'], res.headers['content-length']);
      if (!isOk(res.statusCode)) return reject(toError(res));
      let data = [];
      res
        .on('data', chunk => data.push(chunk.toString()))
        .on('end', () => {
          resolve(data.reduce((a,b) => a.concat(b)));
        });  
    });
  });
}

async function dlJson(uri, headers) {
  var data = await dl(uri, headers);
  return JSON.parse(Buffer.from(data).toString('utf-8'));
}

function dlToFile(uri, file, headers) {
  return new Promise((resolve, reject) => {
    followRedirects(uri, headers, res => {
      logger.debug(res.statusCode, res.statusMessage, res.headers['content-type'], res.headers['content-length']);
      if (!isOk(res.statusCode)) return reject(toError(res));
      res.pipe(require('fs').createWriteStream(file))
        .on('finish', () => {
          logger.debug('Done ' + file + ' - ' + res.headers['content-length'] + ' bytes ');
          resolve();
        });  
    });
  });  
}


function followRedirects(uri, headers, cb) {
  logger.debug('rc', uri);
  let options = URL.parse(uri);
  options.headers = headers;
  options.method = 'GET';
  request(options, res => {
    if (redirectCodes.includes(res.statusCode)) {
      return followRedirects(res.headers.location, headers, cb);
    }
    cb(res);
  }).end();
}



function buildHeaders(accept, auth) {
  let headers = { accept: accept };
  if (auth) headers.authorization = auth;
  return headers;
}

function headOk(url, headers) {
  return new Promise((resolve, reject) => {
    logger.debug(`HEAD ${url}`);
    let options = URL.parse(url);
    options.headers = headers;
    options.method = 'HEAD';
    request(options, res => {
      logger.debug(`HEAD ${url}`, res.statusCode);
      if (res.statusCode == 404) return resolve(false);
      if (res.statusCode == 200) return resolve(true);
      reject(toError(res));
    }).end();
  });  
}

function uploadContent(uploadUrl, file, fileConfig, auth) {
  return new Promise((resolve, reject) => {
    logger.debug('Uploading: ', file);
    let url = uploadUrl;
    if (fileConfig.digest) url += (url.indexOf('?') == -1 ? '?' : '&') + 'digest=' + fileConfig.digest;
    let options = URL.parse(url);
    options.method = 'PUT';
    options.headers = {
      authorization    : auth,
      'content-length' : fileConfig.size,
      'content-type'   : fileConfig.mediaType
    };
    logger.debug('POST', url);
    let req = request(options, res => {
      logger.debug(res.statusCode, res.statusMessage, res.headers['content-type'], res.headers['content-length']);
      if ([200,201,202,203].includes(res.statusCode)) {
        resolve();
      } else {
        var data = [];
        res.on('data', d => data.push(d.toString()));
        res.on('end', () => {
          reject(`Error uploading to ${uploadUrl}. Got ${res.statusCode} ${res.statusMessage}:\n${data.join('')}`);
        });
      }
    });
    require('fs').createReadStream(file).pipe(req);
  });  
}



function Registry(registryBaseUrl, token) {
  const auth = 'Bearer ' + token;

  async function exists(image, layer) {
    let url = `${registryBaseUrl}${image.path}/blobs/${layer.digest}`;
    return await headOk(url, buildHeaders(layer.mediaType, auth));
  }

  async function uploadLayerContent(uploadUrl, layer, dir) {
    logger.info(layer.digest);
    let file = path.join(dir, getHash(layer.digest) + (layer.mediaType.includes('tar.gzip')  ? '.tar.gz' : '.tar'));
    await uploadContent(uploadUrl, file, layer, auth);
  }

  function getUploadUrl(image) {
    return new Promise((resolve, reject) => {
      let url = `${registryBaseUrl}${image.path}/blobs/uploads/`;
      let options = URL.parse(url);
      options.method = 'POST';
      options.headers = { authorization: auth };
      request(options, res => {
        logger.debug('POST', `${url}`, res.statusCode);
        if (res.statusCode == 202) {
          resolve(res.headers['location']);        
        } else {
          var data = [];
          res.on('data', c => data.push(c.toString()))
            .on('end', () => {
              reject(`Error getting upload URL from ${url}. Got ${res.statusCode} ${res.statusMessage}:\n${data.join('')}`);
            });
        }
      }).end();
    });
  }



  async function dlManifest(image) {
    return await dlJson(
      `${registryBaseUrl}${image.path}/manifests/${image.tag}`, 
      buildHeaders('application/vnd.docker.distribution.manifest.v2+json', auth)
    );
  }

  async function dlConfig(image, config) {
    return await dlJson(
      `${registryBaseUrl}${image.path}/blobs/${config.digest}`,
      buildHeaders('*/*', auth)
    );
  }

  async function dlLayer(image, layer, folder) {
    logger.info(layer.digest);
    let file = getHash(layer.digest) + (layer.mediaType.includes('tar.gzip')  ? '.tar.gz' : '.tar');
    await dlToFile(
      `${registryBaseUrl}${image.path}/blobs/${layer.digest}`,
      path.join(folder, file),
      buildHeaders(layer.mediaType, auth)
    );
    return file;
  }

  async function upload(imageStr, folder) {
    let image = parseImage(imageStr);
    let manifestFile = path.join(folder, 'manifest.json');
    let manifest = await fse.readJson(manifestFile);

    logger.info('Checking layer status...');
    let layerStatus = await Promise.all(manifest.layers.map(async l => {
      return { layer: l, exists: (await exists(image, l)) };
    }));
    let layersForUpload = layerStatus.filter(l => !l.exists);
    logger.debug('Needs upload:', layersForUpload.map(l => l.layer.digest));

    logger.info('Uploading layers...');
    await Promise.all(layersForUpload.map(async l => {
      let url = await getUploadUrl(image);
      await uploadLayerContent(url, l.layer, folder);
    }));

    logger.info('Uploading config...');
    let configUploadUrl = await getUploadUrl(image);
    let configFile = path.join(folder, getHash(manifest.config.digest) + '.json');
    await uploadContent(configUploadUrl, configFile, manifest.config, auth);

    logger.info('Uploading manifest...');
    let manifestSize = await fileutil.sizeOf(manifestFile);
    await uploadContent(
      `${registryBaseUrl}${image.path}/manifests/${image.tag}`, 
      manifestFile, 
      { mediaType: manifest.mediaType, size: manifestSize }, 
      auth
    );
  }


  async function download(imageStr, folder) {
    let image = parseImage(imageStr);

    logger.info('Downloading manifest...');
    let manifest = await dlManifest(image);
    await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest));

    logger.info('Downloading config...');
    let config = await dlConfig(image, manifest.config);
    await fs.writeFile(path.join(folder, 'config.json'), JSON.stringify(config));

    logger.info('Downloading layers...');
    await Promise.all(manifest.layers.map(layer => dlLayer(image, layer, folder)));

    logger.info('Image downloaded.');
  }

  return {
    download: download,
    upload: upload
  };
}

function DockerRegistry(auth) {
  const registryBaseUrl = 'https://registry-1.docker.io/v2/';

  async function getToken(image) {
    let resp = await dlJson(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${image.path}:pull`);
    return resp.token;
  }
  async function download(imageStr, folder) {
    let image = parseImage(imageStr);
    if (!auth) auth = await getToken(image);
    await Registry(registryBaseUrl, auth).download(imageStr, folder);
  }

  async function upload(imageStr, folder) {
    if (!auth) throw new Error('Need auth token to upload to Docker');
    await Registry(registryBaseUrl, auth).upload(imageStr, folder);
  }

  return {
    download: download,
    upload: upload
  };
}


module.exports = {
  Registry : Registry,
  DockerRegistry: DockerRegistry
};