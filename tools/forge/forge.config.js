// Forge Configuration
const fs = require('fs');
const path = require('path');
const rootDir = process.cwd();

// Electron Packager's option is `extraResource` (singular); `extraResources` is the
// electron-builder name and is silently ignored here. Packager copies each entry into
// the app's Resources directory under its basename, so `assets` arrives as
// `Contents/Resources/assets` and is read in main via process.resourcesPath.
// `bin/` is produced by `make dl-bin` and is gitignored, so only ship it if it exists.
const extraResource = [path.resolve('assets')];
if (fs.existsSync(path.resolve('bin'))) {
  extraResource.push(path.resolve('bin'));
}

module.exports = {
  // Packager Config
  packagerConfig: {
    // Create asar archive for main, renderer process files
    asar: true,
    // Set executable name
    executableName: 'Sailor',
    // Set application copyright
    appCopyright: 'Copyright (C) 2024 Benjamin Stout',
    // Set application icon
    icon: path.resolve('assets/icons/anchor'),
    // Package dependent binaries and runtime assets
    extraResource
  },
  // Forge Makers
  makers: [
    {
      // Squirrel.Windows is a no-prompt, no-hassle, no-admin method of installing
      // Windows applications and is therefore the most user friendly you can get.
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'sailor-desktop',
      },
    },
    {
      // The Zip target builds basic .zip files containing your packaged application.
      // There are no platform specific dependencies for using this maker and it will run on any platform.
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      // The deb target builds .deb packages, which are the standard package format for Debian-based
      // Linux distributions such as Ubuntu.
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      // The RPM target builds .rpm files, which is the standard package format for
      // RedHat-based Linux distributions such as Fedora.
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  // Forge Plugins
  plugins: [
    {
      // The Webpack plugin allows you to use standard Webpack tooling to compile both your main process code
      // and your renderer process code, with built in support for Hot Module Reloading in the renderer
      // process and support for multiple renderers.
      'name': '@electron-forge/plugin-webpack',
      'config': {
        // fix content-security-policy error when image or video src isn't same origin
        devContentSecurityPolicy: `default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-eval' 'unsafe-inline' data:`,
        // Ports
        port: 3000, // Webpack Dev Server port
        loggerPort: 9000, // Logger port
        // Main process webpack configuration
        mainConfig: path.join(rootDir, 'tools/webpack/webpack.main.js'),
        // Renderer process webpack configuration
        renderer: {
          // Configuration file path
          config: path.join(rootDir, 'tools/webpack/webpack.renderer.js'),
          // Entrypoints of the application
          entryPoints: [
            {
              // Window process name
              name: 'app_window',
              // React Hot Module Replacement (HMR)
              rhmr: 'react-hot-loader/patch',
              // HTML index file template
              html: path.join(rootDir, 'src/renderer/app.html'),
              // Renderer
              js: path.join(rootDir, 'src/renderer/app.tsx'),
              // Main Window
              // Preload
              preload: {
                js: path.join(rootDir, 'src/main/preload.ts'),
                config: path.join(rootDir, 'tools/webpack/webpack.preload.js'),
              },
            },
          ],
        },
        devServer: {
          liveReload: false,
        },
      },
    },
  ],
};
