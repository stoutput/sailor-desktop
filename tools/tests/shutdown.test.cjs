const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

function loadApp({ stopOnExit = true, minimizeToTrayOnClose = true, instance = 'default', spawnError, platform = 'linux' } = {}) {
    const events = {};
    const windowEvents = {};
    const calls = { quit: 0, hide: 0, spawn: [], unref: 0, logs: [], windowOptions: null };
    const childEvents = {};
    const app = {
        whenReady: () => ({ then: callback => callback() }),
        on: (event, callback) => { events[event] = callback; },
        quit: () => { calls.quit++; },
        dock: { setIcon() {} },
    };
    class BrowserWindow {
        constructor(options) { this.webContents = {}; calls.windowOptions = options; }
        loadURL() {}
        on(event, callback) { windowEvents[event] = callback; }
        once() {}
        hide() { calls.hide++; }
    }
    class Settings {
        getSailor() { return { stopOnExit, minimizeToTrayOnClose }; }
        getColima() { return { activeInstance: instance }; }
    }
    class Tray { create() { return this; } }
    const modules = {
        electron: { app, BrowserWindow, nativeImage: { createFromPath: () => null } },
        '@common/constants': { isDev: false, resolveBrewBinary: () => '/brew/colima', brewEnv: { PATH: '/brew' } },
        child_process: { spawn: (...args) => {
            if (spawnError) throw spawnError;
            calls.spawn.push(args);
            return { on: (event, callback) => { childEvents[event] = callback; }, unref: () => { calls.unref++; } };
        } },
        '@modules/AppTray': Tray,
        './postrender': () => {},
        '@common/events': { emit() {} },
        './settings': Settings,
        './assets': { assetPath: () => '/assets/icon.png' },
        'electron-squirrel-startup': false,
    };
    const source = fs.readFileSync(require.resolve('../../src/main/app.ts'), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, {
        exports: {}, require: name => modules[name], process: { platform },
        APP_WINDOW_WEBPACK_ENTRY: 'app.html', APP_WINDOW_PRELOAD_WEBPACK_ENTRY: 'preload.js',
        console: { error: (...args) => calls.logs.push(args) },
    });
    return { events, windowEvents, calls, childEvents };
}

test('quit does not wait for Colima or minimize the window to tray', () => {
    const { events, windowEvents, calls } = loadApp();
    const event = { preventDefault: () => assert.fail('quit must not be canceled') };
    events['before-quit'](event);
    windowEvents.close(event);
    assert.equal(calls.hide, 0);
    assert.equal(calls.unref, 1);
    assert.equal(calls.spawn[0][0], '/brew/colima');
    assert.deepEqual(Array.from(calls.spawn[0][1]), ['stop']);
    assert.equal(calls.spawn[0][2].detached, true);
    assert.equal(calls.spawn[0][2].stdio, 'ignore');
    events['before-quit'](event);
    assert.equal(calls.spawn.length, 1);
});

test('uses the active profile and logs shutdown failures', () => {
    const { events, calls, childEvents } = loadApp({ instance: 'development' });
    events['before-quit']();
    assert.deepEqual(Array.from(calls.spawn[0][1]), ['stop', 'development']);
    childEvents.error(new Error('missing binary'));
    childEvents.exit(1);
    assert.equal(calls.logs.length, 2);
});

test('disabled stop on exit skips Colima and spawn failure cannot block quit', () => {
    const disabled = loadApp({ stopOnExit: false });
    disabled.events['before-quit']();
    assert.equal(disabled.calls.spawn.length, 0);
    const failed = loadApp({ spawnError: new Error('spawn failed') });
    assert.doesNotThrow(() => failed.events['before-quit']());
    assert.equal(failed.calls.logs.length, 1);
});

test('normal close still honors minimize to tray', () => {
    const { windowEvents, calls } = loadApp();
    let prevented = false;
    windowEvents.close({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(calls.hide, 1);
});

test('macOS gets native vibrancy and other platforms retain a dark background', () => {
    const mac = loadApp({ platform: 'darwin' });
    assert.equal(mac.calls.windowOptions.vibrancy, 'under-window');
    assert.equal(mac.calls.windowOptions.backgroundColor, '#00000000');
    const linux = loadApp();
    assert.equal(linux.calls.windowOptions.vibrancy, undefined);
    assert.equal(linux.calls.windowOptions.backgroundColor, '#2a2a2a');
});
