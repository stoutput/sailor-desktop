const { binaries } = require('./utils/binaries');
const { contextBridge, ipcRenderer } = require('electron')

const { spawn } = require('child_process');

// function attachIPCListeners() {
//     contextBridge.exposeInMainWorld(
//         'status-updates',
//         {
//             sendMessage: () => ipcRenderer.send('countdown-start')
//         }
//     );
//     // contextBridge.exposeInMainWorld( 'status-updates', {
//     //     send: ( channel, data ) => ipcRenderer.invoke( channel, data ),
//     //     handle: ( channel, callable, event, data ) => ipcRenderer.on( channel, callable( event, data ) )
//     // });
// }

// attachIPCListeners();