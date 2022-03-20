const path = require('path');
const { binariesPath } = require('./constants');

exports.buildx = path.resolve(path.join(binariesPath, './docker-buildx'));
exports.compose = path.resolve(path.join(binariesPath, './docker-compose'));
exports.docker = path.resolve(path.join(binariesPath, './docker'));

exports.verifySymlinks = (install = true) => {
    return true;
}

module.exports.binaries = {
    buildx: exports.buildx,
    compose: exports.compose,
    docker: exports.docker,
}

