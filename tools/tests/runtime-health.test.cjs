const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const EventEmitter = require('node:events');
const { promisify } = require('node:util');
const tick = () => new Promise(resolve => setImmediate(resolve));

function load(file, modules, globals = {}) {
    const exports = {};
    const source = fs.readFileSync(require.resolve(`../../src/${file}`), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React },
    }).outputText, { exports, require: name => modules[name] || require(name), console, ...globals });
    return exports;
}

function colimaFixture() {
    let output = [{ name: 'default', status: 'Running' }, { name: 'other', status: 'Stopped' }];
    let fail = false;
    let pending;
    const calls = [];
    const execFile = () => {};
    execFile[promisify.custom] = (...args) => {
        calls.push(args);
        return new Promise((resolve, reject) => { pending = { resolve, reject }; });
    };
    const { default: Colima } = load('api/colima.tsx', {
        '@common/constants': { resolveBrewBinary: name => name, brewEnv: {} },
        child_process: { execFile, exec: () => {} },
    });
    const colima = new Colima();
    return {
        colima, calls,
        setOutput: value => { output = value; },
        setFailure: value => { fail = value; },
        finish: () => fail ? pending.reject(new Error('I/O error'))
            : pending.resolve({ stdout: output.map(value => JSON.stringify(value)).join('\n') }),
        async check() { const promise = colima.refreshStatus(); this.finish(); await promise; },
    };
}

test('Colima checks the active profile, detects external stops, and recovers', async () => {
    const f = colimaFixture();
    await f.check();
    assert.equal(f.colima.status, 'Ready');
    f.colima.setActiveInstance('other');
    await f.check();
    assert.equal(f.colima.status, 'Stopped');
    f.setOutput([{ name: 'other', status: 'Running' }]);
    await f.check();
    assert.equal(f.colima.status, 'Ready');
    f.setFailure(true);
    await f.check();
    assert.equal(f.colima.status, 'Error: Colima status unavailable');
    assert.equal(f.calls[0][2].timeout, 5000);
    f.setFailure(false);
    await f.check();
    assert.equal(f.colima.status, 'Ready');
});

test('Colima ignores overlapping probes and results from an old profile or startup', async () => {
    const f = colimaFixture();
    const check = f.colima.refreshStatus();
    await f.colima.refreshStatus();
    assert.equal(f.calls.length, 1);
    f.colima.setActiveInstance('other');
    f.finish(); await check;
    assert.equal(f.colima.status, '');
    const next = f.colima.refreshStatus();
    f.colima._updateStatus('Booting...');
    f.finish(); await next;
    assert.equal(f.colima.status, 'Booting...');
});

async function mainFixture() {
    let colima;
    let docker;
    const handlers = {};
    const timers = new Map();
    class Colima extends EventEmitter {
        constructor() { super(); colima = this; }
        setActiveInstance() {}
        start() {}
        refreshStatus() { this.checked = true; }
        status = '';
    }
    class Docker extends EventEmitter {
        constructor() { super(); docker = this; }
        setup() {}
        start() { this.started = true; }
        stop() { this.started = false; }
    }
    class Settings {
        getColima() { return { activeInstance: 'default' }; }
        applyAllSettings() {}
    }
    const renderer = new EventEmitter();
    renderer.sent = [];
    renderer.isDestroyed = () => false;
    renderer.send = (...args) => renderer.sent.push(args);
    const { default: postrender } = load('main/postrender.ts', {
        electron: { ipcMain: { handle: (name, fn) => { handlers[name] = fn; } } },
        '../api/colima': { default: Colima, STATUS: { READY: 'Ready' }, __esModule: true },
        '../api/docker': Docker,
        './settings': Settings,
        './dependencies': { isSetupRequired: async () => false },
        './dockerConfig': { ensureDockerCliPlugins() {} },
        '@common/constants': {},
    }, {
        setInterval: (fn, ms) => { timers.set(ms, fn); return ms; },
        clearInterval: id => timers.delete(id),
    });
    postrender(renderer);
    await tick();
    return {
        colima, docker, renderer, timers,
        status: () => handlers['get-current-status'](),
        ready: () => handlers['get-containers-ready'](),
        runtime(status) { colima.status = status; colima.emit('status-update', status); },
    };
}

test('main process publishes current health and invalidates content independently of open pages', async () => {
    const f = await mainFixture();
    f.runtime('Ready');
    assert.equal(f.status(), 'Connecting to containers...');
    assert.equal(f.ready(), false);
    f.docker.emit('containers-update', [{ id: 'test' }]);
    assert.equal(f.status(), 'Ready');
    assert.equal(f.ready(), true);
    f.docker.emit('reachability', false);
    assert.equal(f.status(), 'Error: Container runtime unreachable');
    assert.equal(f.ready(), false);
    assert.equal(f.renderer.sent.at(-1)[1].length, 0);
    f.docker.emit('containers-update', []);
    assert.equal(f.status(), 'Ready', 'a valid empty snapshot is healthy');
    f.runtime('Stopped');
    assert.equal(f.status(), 'Stopped');
    assert.equal(f.ready(), false);
    f.docker.emit('containers-update', [{ id: 'late' }]);
    assert.equal(f.status(), 'Stopped', 'late Docker data cannot overwrite a stopped runtime');
    f.timers.get(5000)();
    assert.equal(f.colima.checked, true);
    f.renderer.emit('destroyed');
    assert.equal(f.timers.size, 0);
    assert.equal(f.docker.started, false);
});

function hookFixture(initialStatus, initialContainers = []) {
    const listeners = {};
    const states = [];
    let cursor = 0;
    let mounted = false;
    let cleanup;
    let resolveStatus;
    const statusPromise = new Promise(resolve => { resolveStatus = resolve; });
    const { useContainers } = load('renderer/hooks/useContainers.ts', {
        react: {
            useState(initial) {
                const index = cursor++;
                if (!(index in states)) states[index] = initial;
                return [states[index], value => { states[index] = value; }];
            },
            useEffect(effect) { if (!mounted) { mounted = true; cleanup = effect(); } },
        },
    }, { window: { api: {
        getCurrentStatus: () => statusPromise,
        getContainers: async () => initialContainers,
        onUpdateStatus: callback => { listeners.status = callback; return () => delete listeners.status; },
        onContainersUpdate: callback => { listeners.containers = callback; return () => delete listeners.containers; },
    } } });
    const render = () => { cursor = 0; return useContainers(); };
    render();
    return { render, listeners, cleanup: () => cleanup(), finish: () => resolveStatus(initialStatus) };
}

test('pages mounted after failure display unavailable content and recover with fresh data', async () => {
    const f = hookFixture('Error: Container runtime unreachable', [{ id: 'stale' }]);
    f.finish(); await tick();
    assert.equal(f.render().isColimaStopped, true);
    assert.equal(f.render().isLoading, false);
    assert.equal(f.render().containers.length, 0);
    f.listeners.status(null, 'Ready');
    f.listeners.containers(null, [{ id: 'fresh', status: 'running' }]);
    assert.equal(f.render().isColimaStopped, false);
    assert.equal(f.render().runningContainers[0].id, 'fresh');
    f.listeners.status(null, 'Stopped');
    assert.equal(f.render().containers.length, 0);
    f.cleanup();
    assert.equal(Object.keys(f.listeners).length, 0);
});

test('late initial page reads cannot replace a newer failure or leave live data loading', async () => {
    const f = hookFixture('Ready', [{ id: 'stale' }]);
    f.listeners.status(null, 'Stopped');
    f.finish(); await tick();
    assert.equal(f.render().isColimaStopped, true);
    assert.equal(f.render().containers.length, 0);
    const live = hookFixture('Ready');
    live.listeners.containers(null, [{ id: 'fresh' }]);
    live.finish(); await tick();
    assert.equal(live.render().isLoading, false);
    assert.equal(live.render().containers[0].id, 'fresh');
});

test('restart stops the runtime before starting and propagates stop failures', async () => {
    const { colima } = colimaFixture();
    const calls = [];
    colima.stop = async () => { calls.push('stop'); };
    colima.start = () => { calls.push('start'); };
    await colima.restart();
    assert.deepEqual(calls, ['stop', 'start']);
    colima.stop = async () => { throw new Error('stop failed'); };
    await assert.rejects(colima.restart(), /stop failed/);
    assert.equal(calls.length, 2);
});

test('footer cannot stay green or restore green from a stale initial read after an error', async () => {
    const states = [];
    const listeners = {};
    let cursor = 0;
    let mounted = false;
    let resolveStatus;
    const effects = [];
    const react = {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState(initial) {
            const index = cursor++;
            if (!(index in states)) states[index] = initial;
            return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
        },
        useRef: () => ({ current: null }),
        useEffect: effect => { if (!mounted) effects.push(effect); },
    };
    const { default: Statusbox } = load('renderer/components/statusbox.tsx', {
        react,
        'react-icons/md': { MdAnchor: () => null },
        './statusbox.scss': {},
    }, { window: { api: {
        getCurrentStatus: () => new Promise(resolve => { resolveStatus = resolve; }),
        getBufferedLogs: async () => [],
        onUpdateStatus: callback => { listeners.status = callback; return () => {}; },
        onLogMessage: () => () => {},
    } } });
    const render = () => { cursor = 0; return Statusbox(); };
    render();
    mounted = true;
    effects.forEach(effect => effect());
    listeners.status(null, 'Ready');
    assert.equal(render().props.className, 'footer status-ready');
    listeners.status(null, 'Error: Container runtime unreachable');
    assert.equal(render().props.className, 'footer status-error');
    resolveStatus('Ready'); await tick();
    assert.equal(render().props.className, 'footer status-error');
    listeners.status(null, 'Stopped');
    assert.equal(render().props.className, 'footer status-warning');
    listeners.status(null, 'Connecting to containers...');
    assert.equal(render().props.className, 'footer status-loading');
});
