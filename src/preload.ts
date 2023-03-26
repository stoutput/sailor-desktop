//const { binaries } = require('./utils/binaries');
import { contextBridge, ipcRenderer } from 'electron';
import CONFIG from '@src/config';

export const API = {
    onUpdateStatus: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => {
        ipcRenderer.on('update-status', callback)
        return () => {
            ipcRenderer.removeListener('update-status', callback);
        };
    },
    onContainerChange: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => {
        ipcRenderer.on('container-change', callback)
        return () => {
            ipcRenderer.removeListener('container-change', callback);
        };
    }
}

function attachIPCListeners() {
    contextBridge.exposeInMainWorld('api', API)
    contextBridge.exposeInMainWorld('config', CONFIG)
}

attachIPCListeners();
