import { app, BrowserWindow } from 'electron';
import { isDev } from '@common/constants';
import AppTray from '@modules/AppTray';
import postrender from './postrender';
import events from '@common/events';
import SettingsManager from './settings';

// Electron Forge automatically creates these entry points
declare const APP_WINDOW_WEBPACK_ENTRY: string;
declare const APP_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let win: BrowserWindow;
let _tray: AppTray;
let settings: SettingsManager;

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
    _tray = new AppTray(win).create();
    settings = new SettingsManager();

    // Forward some BrowserWindow events to the global EventEmitter
    win.on('minimize', (e: Electron.Event) => {
        events.emit(e.type)
    })

    win.on('restore', (e: Electron.Event) => {
      events.emit(e.type)
    })

    win.once('ready-to-show', () => {
        win.show()
        postrender(win.webContents)
    })

})

// Handle app shutdown
app.on('before-quit', async () => {
    if (settings && settings.getSailor().stopOnExit) {
        // Import colima to stop it
        const Colima = require('../api/colima').default;
        const colima = new Colima();
        const colimaSettings = settings.getColima();
        try {
            await colima.stop(colimaSettings.activeInstance);
        } catch (err) {
            console.error('Failed to stop Colima on exit:', err);
        }
    }
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
