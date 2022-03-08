//const { binaries } = require('./utils/binaries');
const { contextBridge, ipcRenderer } = require('electron')

//const { spawn } = require('child_process');

function attachIPCListeners() {
    contextBridge.exposeInMainWorld('api', {
        onUpdateStatus: (callback) => {
            ipcRenderer.on('update-status', callback)
            return () => {
                ipcRenderer.removeListener('update-status', callback);
            };
        }
    })
    // contextBridge.exposeInMainWorld( 'status-updates', {
    //     send: ( channel, data ) => ipcRenderer.invoke( channel, data ),
    //     handle: ( channel, callable, event, data ) => ipcRenderer.on( channel, callable( event, data ) )
    // });
}

attachIPCListeners();