const path = require('path');
const Main = require('electron');

const { isPackaged, isProd, rootPath } = require('./constants');
const { getPlatform } = require('./get-platform');

exports.binariesPath =
  isProd && isPackaged
    ? path.join(path.dirname(Main.app.getAppPath()), '..', './Resources', './bin')
    : path.join(rootPath, './build', getPlatform(), './bin');
exports.buildx = path.resolve(path.join(exports.binariesPath, './docker-buildx'));
exports.colima = path.resolve(path.join(exports.binariesPath, './colima'));
exports.compose = path.resolve(path.join(exports.binariesPath, './docker-compose'));
exports.docker = path.resolve(path.join(exports.binariesPath, './docker'));

exports.verifySymlinks = (install = true) => {
    return true;
}

module.exports.binaries = {
    buildx: exports.buildx,
    colima: exports.colima,
    compose: exports.compose,
    docker: exports.docker,
}

