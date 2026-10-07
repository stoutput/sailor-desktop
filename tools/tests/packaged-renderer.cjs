const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');

const archive = process.argv[2];
if (!archive) {
    console.error('Usage: electron tools/tests/packaged-renderer.cjs /absolute/path/to/app.asar');
    app.exit(1);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const container = { id: 'demo', name: 'demo', image: 'alpine', status: 'running', ports: [], networks: [], created: 0 };
const containers = [container, ...['alpha', 'beta', 'gamma'].map(name => ({ ...container, id: name, name: `${name}_service_1`, composeService: `${name}-service`, composeProject: name, status: 'paused' }))];
const composeActions = [];
const responses = {
    'get-setup-required': false,
    'get-containers-ready': false,
    'get-containers': containers,
    'get-current-status': 'Booting...',
    'is-colima-running': true,
    'get-buffered-logs': [],
    'get-container-stats-history': { startedAt: null, samples: [] },
    'get-colima-settings': { activeInstance: 'default' },
    'get-docker-settings': { activeContext: 'default' },
    'get-untested-notifications': [],
};
for (const channel of Object.keys(responses)) ipcMain.handle(channel, () => responses[channel]);
for (const action of ['up', 'down']) ipcMain.handle(`compose-${action}`, (_, project) => { composeActions.push([action, project]); return containers; });

let preferences = { startOnLogin: false, stopOnExit: false, minimizeToTrayOnClose: true };
let statsRequests = 0;
let preferenceLoads = 0;
let resolveVersions;
let resolveInstances;
let resolveContexts;
const pendingVersions = new Promise(resolve => { resolveVersions = resolve; });
const pendingInstances = new Promise(resolve => { resolveInstances = resolve; });
const pendingContexts = new Promise(resolve => { resolveContexts = resolve; });
ipcMain.handle('get-sailor-settings', () => { preferenceLoads++; return preferences; });
ipcMain.handle('set-sailor-settings', (_, changes) => { preferences = { ...preferences, ...changes }; return preferences; });
ipcMain.handle('get-colima-stats', () => { statsRequests++; return { cpu: 2, memory: 1024, disk: 1024 }; });
ipcMain.handle('check-dependencies', () => pendingVersions);
ipcMain.handle('get-colima-instances', () => pendingInstances);
ipcMain.handle('get-docker-contexts', () => pendingContexts);

app.whenReady().then(async () => {
    const errors = [];
    const win = new BrowserWindow({
        show: false,
        vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
        backgroundColor: process.platform === 'darwin' ? '#00000000' : '#2a2a2a',
        webPreferences: {
            sandbox: true,
            contextIsolation: true,
            preload: path.resolve(archive, '.webpack/renderer/app_window/preload.js'),
        },
    });
    win.webContents.on('console-message', (_, level, message) => {
        if (level === 3) errors.push(message);
    });
    try {
        await win.loadFile(path.resolve(archive, '.webpack/renderer/app_window/index.html'));
        await pause(1000);
        assert.deepEqual(errors, [], 'packaged startup must have no renderer errors');
        const run = script => win.webContents.executeJavaScript(script);
        assert.equal(await run("document.querySelector('#header #logo').draggable"), false, 'title bar logo must not support image dragging');
        assert.equal(await run("getComputedStyle(document.querySelector('#header #logo')).webkitAppRegion"), 'no-drag', 'title bar logo must not drag the window');
        assert.equal(await run("getComputedStyle(document.querySelector('#header')).webkitAppRegion"), 'drag', 'the rest of the title bar remains draggable');
        assert.equal(await run("!!document.querySelector('.startup-view .bouncing')"), true);
        if (process.platform === 'darwin') {
            assert.equal(await run("getComputedStyle(document.body).backgroundColor"), 'rgba(0, 0, 0, 0)');
            assert.equal(await run("getComputedStyle(document.querySelector('#content')).backgroundColor"), 'rgba(32, 38, 46, 0.12)');
        }
        for (const route of ['/topology', '/cli', '/activity', '/container/demo']) {
            await run(`location.hash='${route}'`);
            await pause(100);
            assert.equal(await run("!!document.querySelector('.startup-view .bouncing')"), true);
        }
        await run("location.hash='/settings'");
        await pause(300);
        assert.equal(await run("!!document.querySelector('#settings-page')"), true);
        assert.equal(await run("document.querySelectorAll('#settings-page .text-skeleton').length >= 6"), true);
        assert.equal(await run("!!document.querySelector('.startup-view')"), false);
        assert.equal(statsRequests, 0, 'VM stats must not be polled during startup');
        await run("document.querySelector('#settings-page input[type=checkbox]').click()");
        await pause(100);
        assert.equal(preferences.startOnLogin, true, 'preferences remain editable during startup');
        resolveInstances([]);
        resolveContexts([]);
        const dependency = { installed: true, version: '1.0.0', meetsMinimum: true, latestVersion: null };
        resolveVersions({ dependencies: { colima: dependency, docker: dependency, buildx: dependency, compose: dependency } });
        await pause(200);
        assert.equal(await run("document.querySelectorAll('#settings-page .text-skeleton').length"), 0);
        win.webContents.send('update-status', 'Ready');
        await pause(100);
        assert.equal(statsRequests, 0, 'wait for container readiness before polling VM stats');
        responses['get-containers-ready'] = true;
        responses['get-current-status'] = 'Ready';
        win.webContents.send('containers-ready');
        await pause(200);
        assert.ok(statsRequests > 0);
        assert.equal(await run("document.querySelector('#settings-page input[type=checkbox]').checked"), true);
        assert.equal(preferenceLoads, 1, 'Settings stays mounted when startup finishes');
        assert.equal(await run("document.querySelector('#content').classList.contains('starting')"), false);
        await run("location.hash='/dashboard'");
        await pause(200);
        assert.equal(await run("!!document.querySelector('#page-content')"), true);
        const projectOrder = () => run("Array.from(document.querySelectorAll('.project-name')).map(node => node.textContent)");
        const clickProject = name => run(`Array.from(document.querySelectorAll('.project-toggle')).find(button => button.querySelector('.project-name').textContent === '${name}').click()`);
        assert.deepEqual(await projectOrder(), ['alpha', 'beta', 'gamma']);
        assert.equal(await run("document.querySelector('.compose-project .project-header').classList.contains('paused')"), true);
        assert.equal(await run("getComputedStyle(document.querySelector('.compose-project .project-header')).borderLeftColor"), 'rgb(242, 209, 52)');
        const alpha = containers.find(item => item.id === 'alpha');
        win.webContents.send('containers-update', [...containers, { ...alpha, id: 'alpha-running', status: 'running' }]);
        await pause(50);
        assert.equal(await run("document.querySelector('.compose-project .project-header').classList.contains('paused')"), true,
            'paused status takes priority over running');
        win.webContents.send('containers-update', containers.map(item => item.id === 'alpha' ? { ...item, status: 'running' } : item));
        await pause(50);
        assert.equal(await run("document.querySelector('.compose-project .project-header').classList.contains('running')"), true);
        win.webContents.send('containers-update', containers.map(item => item.id === 'alpha' ? { ...item, status: 'exited' } : item));
        await pause(50);
        assert.equal(await run("document.querySelector('.compose-project .project-header').classList.contains('stopped')"), true);
        win.webContents.send('containers-update', [...containers]);
        await pause(50);
        assert.equal(await run("getComputedStyle(document.querySelector('.compose-project .project-actions .up')).borderRadius"), '50%');
        assert.equal(await run("document.querySelectorAll('.compose-project .project-actions button').length"), 6);
        assert.equal(await run("document.querySelector('.compose-project .project-expand').closest('button').className"), 'project-toggle');
        const collapsedWidth = await run("document.querySelector('.compose-project').getBoundingClientRect().width");
        await clickProject('beta');
        await pause(80);
        const intermediateWidth = await run("document.querySelector('.compose-project').getBoundingClientRect().width");
        assert.ok(intermediateWidth > collapsedWidth, 'tile width animates during expansion');
        await pause(350);
        const expandedWidth = await run("document.querySelector('.compose-project').getBoundingClientRect().width");
        assert.ok(expandedWidth > intermediateWidth, 'expansion proceeds smoothly to full width');
        assert.ok(expandedWidth > collapsedWidth * 1.8);
        assert.deepEqual(await projectOrder(), ['beta', 'alpha', 'gamma']);
        assert.equal(await run("document.querySelector('.project-actions').previousElementSibling.className"), 'project-toggle');
        assert.equal(await run("getComputedStyle(document.querySelector('.project-actions .up')).backgroundColor"), 'rgb(76, 175, 80)');
        assert.equal(await run("getComputedStyle(document.querySelector('.project-actions .down')).backgroundColor"), 'rgb(244, 67, 54)');
        assert.equal(await run("getComputedStyle(document.querySelector('.project-name')).fontWeight"), '400');
        await run("document.querySelector('.project-actions .up').click()");
        await pause(100);
        assert.deepEqual(composeActions, [['up', 'beta']]);
        await run("Array.from(document.querySelectorAll('.compose-project')).find(tile => tile.querySelector('.project-name').textContent === 'alpha').querySelector('.project-actions .up').click()");
        await pause(100);
        assert.deepEqual(composeActions, [['up', 'beta'], ['up', 'alpha']]);
        assert.equal(await run("document.querySelectorAll('.compose-project.expanded').length"), 1);
        await clickProject('alpha');
        await pause(400);
        assert.deepEqual(await projectOrder(), ['beta', 'alpha', 'gamma']);
        await run("document.querySelector('.project-expand').click()");
        await pause(400);
        assert.deepEqual(await projectOrder(), ['alpha', 'beta', 'gamma']);
        assert.equal(await run("document.querySelectorAll('.project-body[inert]').length"), 2);
        assert.equal(await run("document.querySelector('.project-body[inert]').getBoundingClientRect().height"), 0);
        await clickProject('gamma');
        await pause(400);
        assert.deepEqual(await projectOrder(), ['alpha', 'gamma', 'beta']);
        await run("location.hash='/activity'");
        await pause(500);
        containers.forEach(item => { item.status = 'running'; });
        win.webContents.send('containers-update', containers);
        await pause(100);
        const sampleStart = Date.now();
        const emit = (id, timestamp, cpu = 12) => {
            const sample = {
                containerId: id, timestamp, cpu, memory: 50, memoryLimit: 100,
                networkRx: 1000 + timestamp - sampleStart, networkTx: 500 + timestamp - sampleStart,
                blockRead: 2000 + timestamp - sampleStart, blockWrite: 4000 + timestamp - sampleStart,
            };
            const cache = responses['get-container-stats-history'];
            cache.startedAt = cache.startedAt ?? timestamp;
            cache.samples.push(sample);
            win.webContents.send('container-stats', sample);
        };
        for (const [index, item] of containers.entries()) {
            emit(item.id, sampleStart, 12 + index * 10);
            emit(item.id, sampleStart + 2000, 12 + index * 10);
        }
        await pause(300);
        assert.equal(await run("document.querySelectorAll('.recharts-wrapper').length"), 4);
        const graphWidth = await run("document.querySelector('.graph-section').getBoundingClientRect().width");
        const totalWidth = await run("document.querySelector('.graphs-container').getBoundingClientRect().width");
        assert.ok(graphWidth < totalWidth * 0.55, 'graphs default to half width');
        await run("document.querySelector('.graph-toggle').click()");
        await pause(200);
        assert.ok(await run("document.querySelector('.graph-section').getBoundingClientRect().width") > totalWidth * 0.95);
        await run("Array.from(document.querySelectorAll('.graph-toggle')).find(button => button.textContent.includes('Network I/O')).click()");
        await pause(400);
        assert.deepEqual(await run("Array.from(document.querySelectorAll('.graph-section h3')).map(node => node.textContent)"), ['CPU', 'Network I/O', 'Memory', 'Disk I/O']);
        await run("Array.from(document.querySelectorAll('.graph-toggle')).find(button => button.textContent.includes('Network I/O')).click()");
        await pause(400);
        await run("document.querySelector('.graph-toggle').click()");
        await pause(400);
        assert.equal(await run("document.querySelector('.graph-section').getBoundingClientRect().width"), graphWidth);
        const chipNames = () => run("Array.from(document.querySelectorAll('.chip-label')).map(node => node.childNodes[0].textContent)");
        const selectChip = name => run(`Array.from(document.querySelectorAll('.container-chip')).find(button => button.querySelector('.chip-label').childNodes[0].textContent === '${name}').click()`);
        assert.deepEqual(await chipNames(), ['demo', 'alpha-service', 'beta-service', 'gamma-service']);
        assert.equal(await run("document.querySelectorAll('.chip-label small').length"), 3);
        await selectChip('gamma-service');
        await pause(300);
        assert.deepEqual(await chipNames(), ['gamma-service', 'demo', 'alpha-service', 'beta-service']);
        assert.equal(await run("document.querySelector('.series-key').firstElementChild.className"), 'clear-selection');
        assert.equal(await run("document.querySelectorAll('.chip-dismiss').length"), 1);
        assert.notEqual(await run("getComputedStyle(document.querySelector('.container-chip.selected')).boxShadow"), 'none');
        await selectChip('alpha-service');
        await pause(300);
        assert.deepEqual(await chipNames(), ['gamma-service', 'alpha-service', 'demo', 'beta-service']);
        assert.deepEqual(await run("Array.from(document.querySelectorAll('.graph-section:first-child .recharts-area-curve')).map(node => node.getAttribute('name')).sort()"), ['alpha-service', 'gamma-service']);
        await selectChip('gamma-service');
        await pause(300);
        assert.equal(await run("document.querySelectorAll('.container-chip.selected').length"), 1);
        await run("document.querySelector('.clear-selection').click()");
        await pause(300);
        assert.equal(await run("document.querySelectorAll('.container-chip.selected').length"), 0);
        assert.equal(await run("document.querySelectorAll('.graph-section:first-child .recharts-area-curve').length"), 4);
        const demoPath = () => run("document.querySelector('.graph-section:first-child path[name=demo]').getAttribute('d')");
        const beforeUpdate = await demoPath();
        emit('beta', sampleStart + 4000, 25);
        await pause(100);
        assert.equal(await demoPath(), beforeUpdate, 'unaffected curves must not replay on another container update');
        const firstX = async () => Number((await demoPath()).match(/^M([\d.-]+)/)[1]);
        const beforeSlide = await firstX();
        emit('beta', sampleStart + 122000, 25);
        await pause(80);
        const middleSlide = await firstX();
        await pause(500);
        const afterSlide = await firstX();
        assert.ok(beforeSlide > middleSlide && middleSlide > afterSlide, 'time window slides smoothly to the left');
        await run("location.hash='/topology'");
        await pause(200);
        assert.deepEqual(await run("Array.from(document.querySelectorAll('.node-project')).map(node => node.textContent).sort()"), ['alpha', 'beta', 'gamma']);
        const regionWidth = await run("document.querySelector('.network-region').getBoundingClientRect().width");
        await run("Array.from(document.querySelectorAll('.network-region .container-node')).slice(1).forEach(node => { node.style.display = 'none'; })");
        await pause(50);
        assert.ok(await run("document.querySelector('.network-region').getBoundingClientRect().width") < regionWidth,
            'network regions shrink to fit fewer visible containers');
        assert.equal(await run("Array.from(document.querySelectorAll('.node-name')).some(node => node.textContent === 'alpha-service')"), true);
        await run("location.hash='/cli'");
        await pause(200);
        assert.deepEqual(await run("Array.from(document.querySelectorAll('.container-project')).map(node => node.textContent).sort()"), ['alpha', 'beta', 'gamma']);
        assert.equal(await run("Array.from(document.querySelectorAll('.container-name')).some(node => node.textContent === 'alpha-service')"), true);
        await run("location.hash='/activity'");
        await pause(300);
        assert.equal(await run("document.querySelectorAll('.graph-section:first-child .recharts-area-curve').length"), 4,
            'reopening Monitoring restores background history without a new stats event');
        assert.ok((await demoPath()).length > 20, 'cached history contains chart points');
        ipcMain.handle('container-logs-start', (_event, id) => {
            win.webContents.send('container-log-line', id, 'initial socket log');
        });
        ipcMain.handle('container-logs-stop', () => {});
        await run("location.hash='/container/demo'");
        await pause(300);
        assert.equal(await run("document.querySelector('.log-line').textContent"), 'initial socket log',
            'log listeners are installed before opening the socket stream');
        win.webContents.send('container-log-line', 'demo', 'live socket log');
        await pause(100);
        assert.equal(await run("document.querySelectorAll('.log-line').length"), 2);
        await run("location.hash='/activity'");
        await pause(200);
        assert.deepEqual(errors, [], 'packaged monitoring must have no renderer errors');
        console.log('Packaged startup passed: startup, compose tiles, four responsive graphs, multi-select chips, smooth scrolling, and container names');
        win.destroy();
        app.exit(0);
    } catch (err) {
        console.error(err);
        win.destroy();
        app.exit(1);
    }
}).catch(err => {
    console.error(err);
    app.exit(1);
});
