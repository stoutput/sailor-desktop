import { app, BrowserWindow, nativeImage } from 'electron';
import { isDev, resolveBrewBinary, brewEnv } from '@common/constants';
import { spawn } from 'child_process';
import AppTray from '@modules/AppTray';
import postrender from './postrender';
import events from '@common/events';
import SettingsManager from './settings';
import { assetPath } from './assets';

// Electron Forge automatically creates these entry points
declare const APP_WINDOW_WEBPACK_ENTRY: string;
declare const APP_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let win: BrowserWindow;
let _tray: AppTray;
let settings: SettingsManager;
let isQuitting = false;

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
        vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
        backgroundColor: process.platform === 'darwin' ? '#00000000' : '#2a2a2a',
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
        const iconPath = assetPath('images', 'OffWhiteAnchor2Template@4x.png');
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
    }

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

    win.on('close', (e) => {
        if (isQuitting) return;
        if (settings && settings.getSailor().minimizeToTrayOnClose) {
            e.preventDefault();
            win.hide();
        } else {
            app.quit();
        }
    })

})

// Handle app shutdown
app.on('before-quit', () => {
    if (isQuitting) return;
    isQuitting = true;
    if (settings && settings.getSailor().stopOnExit) {
        const instance = settings.getColima().activeInstance;
        const args = instance === 'default' ? ['stop'] : ['stop', instance];
        try {
            // Let Colima finish stopping independently of the app's lifetime.
            const shutdown = spawn(resolveBrewBinary('colima'), args, {
                env: brewEnv,
                detached: true,
                stdio: 'ignore',
            });
            shutdown.on('error', err => console.error('Failed to stop Colima on exit:', err));
            shutdown.on('exit', code => {
                if (code !== 0) console.error(`Colima stop on exit failed with code ${code}`);
            });
            shutdown.unref();
        } catch (err) {
            console.error('Failed to start Colima shutdown:', err);
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
