import Main from 'electron';
import path from 'path';
import fs from 'fs';
import getPlatform from './platform';

const isDev: boolean = process.env.NODE_ENV === 'development';
const isProd: boolean = process.env.NODE_ENV === 'production';
const appIndex: undefined | number = require.main?.filename?.indexOf('app.asar')
const isPackaged: boolean =  appIndex !== undefined && appIndex !== -1;
const rootPath: string =  __dirname;
const binariesPath: string = path.join(Main.app.getAppPath(), './bin', getPlatform());

const BREW_BIN_PATHS = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/home/linuxbrew/.linuxbrew/bin',
];

function resolveBrewBinary(name: string): string {
    for (const dir of BREW_BIN_PATHS) {
        const full = path.join(dir, name);
        if (fs.existsSync(full)) return full;
    }
    return name;
}

// Environment with Homebrew paths prepended — required for spawned processes
// in a packaged Electron app where PATH doesn't include Homebrew directories.
const brewEnv = {
    ...process.env,
    PATH: `${BREW_BIN_PATHS.join(':')}:${process.env.PATH || ''}`,
};

export {
  isDev,
  isProd,
  isPackaged,
  rootPath,
  binariesPath,
  resolveBrewBinary,
  brewEnv,
}