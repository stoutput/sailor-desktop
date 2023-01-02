import Main from 'electron';
import path from 'path';
import getPlatform from './platform';

const isDev: boolean = process.env.NODE_ENV === 'development';
const isProd: boolean = process.env.NODE_ENV === 'production';
let appIndex: undefined | number = require.main?.filename?.indexOf('app.asar')
const isPackaged: boolean =  appIndex !== undefined && appIndex !== -1;
const rootPath: string =  __dirname;
const binariesPath: string = path.join(Main.app.getAppPath(), './bin', getPlatform());

export {
  isDev,
  isProd,
  isPackaged,
  rootPath,
  binariesPath,
}