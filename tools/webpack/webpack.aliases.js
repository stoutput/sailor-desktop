const { createWebpackAliases } = require('./webpack.helpers');

// Export aliases
module.exports = createWebpackAliases({
  '@assets': 'assets',
  '@components': 'src/renderer/components',
  '@pages': 'src/renderer/pages',
  '@common': 'src/common',
  '@main': 'src/main',
  '@modules': 'src/modules',
  '@renderer': 'src/renderer',
  '@src': 'src',
});
