const { app, BrowserWindow } = require('electron');
const { isDev } = require('./app/utils/constants');
const AppTray = require('./app/modules/AppTray');
const { postrender } = require('./app/postrender')

let window = null;
let tray = null;

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
    window = new BrowserWindow({
        width: 800,
        height: 600,
        titleBarStyle: "hidden",
        trafficLightPosition: {
            x: 10,
            y: 13
        },
        webPreferences: {
            show: false, // Show explicitly
            allowRunningInsecureContent: false,
            sandbox: true,
            contextIsolation: true,
            preload: path.join(__dirname, "./app/preload.js"),
        }
    })

    // and load the index.html of the app.
    // window.loadFile("index.html");
    window.loadURL(
        isDev
        ? `file://${path.join(__dirname, '../dist/index.html')}`
        : 'http://localhost:3000/index.html'
    );
    // Open DevTools
    if (isDev) {
        window.webContents.openDevTools({ mode: 'detach' });
    }
}

app.whenReady().then(() => {
    createWindow();
    tray = new AppTray(window).create();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    window.once('ready-to-show', () => {
        window.show()
        postrender(window.webContents)
    })

})