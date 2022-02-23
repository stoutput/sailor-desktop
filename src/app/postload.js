const { binaries } = require('./utils/binaries');
const { contextBridge, ipcRenderer } = require('electron')

const { spawn } = require('child_process');