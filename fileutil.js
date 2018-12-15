const fs = require('fs').promises;
const fse = require('fs-extra');

async function sizeOf(file) {
  return (await fs.lstat(file)).size;
}

async function ensureEmptyDir(path) {
  if (require('fs').existsSync(path)) await fse.remove(path);
  await fs.mkdir(path);
  return path;
}

module.exports = {
  sizeOf: sizeOf,
  ensureEmptyDir: ensureEmptyDir
};
