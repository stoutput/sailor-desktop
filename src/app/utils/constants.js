const Main = require('electron');
const path = require('path');
const { getPlatform } = require('./get-platform');

exports.isDev = process.env.NODE_ENV === 'development';
exports.isProd = process.env.NODE_ENV === 'production';
exports.isPackaged = require.main?.filename.indexOf('app.asar') !== -1;
exports.rootPath =  __dirname;
exports.binariesPath =
  exports.isProd && exports.isPackaged
    ? path.join(Main.app.getAppPath(), './Resources', './bin')
    : path.join(Main.app.getAppPath(), './build', getPlatform(), './bin');