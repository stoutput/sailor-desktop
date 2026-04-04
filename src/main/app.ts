import { app, BrowserWindow, nativeImage } from 'electron';
import { isDev } from '@common/constants';
import AppTray from '@modules/AppTray';
import postrender from './postrender';
import events from '@common/events';
import SettingsManager from './settings';
import path from 'path';

// Electron Forge automatically creates these entry points
declare const APP_WINDOW_WEBPACK_ENTRY: string;
declare const APP_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let win: BrowserWindow;
let _tray: AppTray;
let settings: SettingsManager;
let isQuiting = false;

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

    win.loadURL(APP_WINDOW_WEBPACK_ENTRY);
    // Open DevTools
    if (isDev) {
        win.webContents.openDevTools({ mode: 'detach' });
    }
}

app.whenReady().then(() => {
    createWindow();
    _tray = new AppTray(win).create();
    settings = new SettingsManager();

    // Set dock icon to the anchor logo
    if (process.platform === 'darwin') {
        const iconPath = path.resolve('assets/images/OffWhiteAnchor2Template@4x.png');
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
    }

    // Forward some BrowserWindow events to the global EventEmitter
    win.on('minimize', (e: Electron.Event) => {
        events.emit(e.type)
    })

    win.on('restore', (e: Electron.Event) => {
      events.emit(e.type)
    })

    // On macOS, hide the window instead of closing it so the app stays in the menu bar
    win.on('close', (e: Electron.Event) => {
        if (process.platform === 'darwin' && !isQuiting) {
            e.preventDefault();
            win.hide();
        }
    })

    win.once('ready-to-show', () => {
        win.show()
        postrender(win.webContents)
    })

})

// Handle app shutdown
app.on('before-quit', (event) => {
    if (isQuiting) return;
    isQuiting = true;
    if (settings && settings.getSailor().stopOnExit) {
        event.preventDefault();
        const Colima = require('../api/colima').default;
        const colima = new Colima();
        const colimaSettings = settings.getColima();
        colima.stop(colimaSettings.activeInstance)
            .catch((err: Error) => console.error('Failed to stop Colima on exit:', err))
            .finally(() => app.quit());
    }
})

/**
 * Emitted when the application is activated. Various actions can
 * trigger this event, such as launching the application for the first time,
 * attempting to re-launch the application when it's already running,
 * or clicking on the application's dock or taskbar icon.
 */
 app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    win.show();
  }
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
