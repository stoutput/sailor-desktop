import { app, BrowserWindow } from 'electron';
import { isDev } from '@common/constants';
import AppTray from '@modules/AppTray';
//import postrender from './postrender';
import events from '@common/events';

// Electron Forge automatically creates these entry points
declare const APP_WINDOW_WEBPACK_ENTRY: string;
declare const APP_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let win: BrowserWindow;
let tray: AppTray;

/** Handle creating/removing shortcuts on Windows when installing/uninstalling. */
if (require('electron-squirrel-startup')) {
  app.quit();
}

if (isDev) {
    try {
        require('electron-reloader')(module, {
            debug: true,
            watchRenderer: true
        });
    } catch (_) { console.log('Error'); }
}

const createWindow = () => {
    const path = require('path')
    win = new BrowserWindow({
        width: 800, height: 600,
        show: false, // Show explicitly
        titleBarStyle: "hidden",
        trafficLightPosition: {x: 10, y: 13},
        webPreferences: {
            allowRunningInsecureContent: false,
            sandbox: true,
            contextIsolation: true,
            preload: APP_WINDOW_PRELOAD_WEBPACK_ENTRY,
        },
    })

    win.loadURL(
        isDev
        ? APP_WINDOW_WEBPACK_ENTRY
        : 'http://localhost:3000/app.html'
    );
    // Open DevTools
    if (isDev) {
        win.webContents.openDevTools({ mode: 'detach' });
    }
}

app.whenReady().then(() => {
    createWindow();
    tray = new AppTray(win).create();

    // Forward some BrowserWindow events to the global EventEmitter
    win.on('minimize', (e: Electron.Event) => {
        events.emit(e.type)
    })

    win.on('restore', (e: Electron.Event) => {
      events.emit(e.type)
    })

    win.once('ready-to-show', () => {
        win.show()
        //postrender(win.webContents)
    })

})

/**
 * Emitted when the application is activated. Various actions can
 * trigger this event, such as launching the application for the first time,
 * attempting to re-launch the application when it's already running,
 * or clicking on the application's dock or taskbar icon.
 */
 app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

/**
 * Emitted when all windows have been closed.
 */
app.on('window-all-closed', () => {
  /**
   * On OS X it is common for applications and their menu bar
   * to stay active until the user quits explicitly with Cmd + Q
   */
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
