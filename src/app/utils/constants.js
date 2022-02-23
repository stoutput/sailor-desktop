exports.isDev = process.env.NODE_ENV === 'development';
exports.isProd = process.env.NODE_ENV === 'production';
exports.isPackaged = require.main?.filename.indexOf('app.asar') !== -1;
exports.rootPath =  __dirname;