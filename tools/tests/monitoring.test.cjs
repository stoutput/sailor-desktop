const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const moduleExports = {};
const source = fs.readFileSync(require.resolve('../../src/renderer/pages/monitoringData.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: moduleExports });
const { appendSample, axisMaximum, timeWindow, formatBytes, WINDOW_MS } = moduleExports;
const stats = (timestamp, overrides = {}) => ({ containerId: 'test', timestamp, cpu: 12, memory: 50, memoryLimit: 100, networkRx: 1000, networkTx: 2000, blockRead: 4000, blockWrite: 8000, ...overrides });

test('time window fills from the left and slides only after two minutes', () => {
    assert.deepEqual(Array.from(timeWindow(1000, 61000)), [1000, 121000]);
    assert.deepEqual(Array.from(timeWindow(1000, 121000)), [1000, 121000]);
    assert.deepEqual(Array.from(timeWindow(1000, 125000)), [5000, 125000]);
});

test('network rates use elapsed seconds and do not invent the initial rate', () => {
    const first = appendSample([], stats(1000));
    assert.equal(first[0].rx, null);
    const history = appendSample(first, stats(5000, { networkRx: 3000, networkTx: 6000 }));
    assert.equal(history[1].rx, 500);
    assert.equal(history[1].tx, 1000);
    assert.equal(history[1].memory, 50);
});

test('counter resets and invalid limits produce finite nonnegative values', () => {
    const history = appendSample(appendSample([], stats(1000)), stats(3000, { networkRx: 5, networkTx: 0, memoryLimit: 0, cpu: NaN }));
    assert.equal(history[1].rx, 0);
    assert.equal(history[1].tx, 0);
    assert.equal(history[1].memory, 0);
    assert.equal(history[1].cpu, 0);
});

test('duplicate, out-of-order, and invalid timestamps are ignored', () => {
    const history = appendSample([], stats(3000));
    for (const timestamp of [3000, 1000, NaN]) assert.equal(appendSample(history, stats(timestamp)), history);
});

test('history is bounded with one sample retained before the visible window', () => {
    let history = [];
    for (let timestamp = 0; timestamp <= WINDOW_MS * 5; timestamp += 2000) history = appendSample(history, stats(timestamp));
    assert.equal(history.length, 62);
    assert.equal(history[0].timestamp, WINDOW_MS * 4 - 2000);
});

test('axes have a ten percent buffer and byte labels handle small values', () => {
    assert.equal(axisMaximum([0, 20, 100, NaN]), 110.00000000000001);
    assert.ok(axisMaximum([]) > 0);
    assert.equal(formatBytes(0.5), '0.5 B');
    assert.equal(formatBytes(1024), '1 KB');
    assert.equal(formatBytes(Infinity), '0 B');
});

test('block I/O rates use elapsed time and handle unsupported data and resets', () => {
    const first = appendSample([], stats(1000));
    assert.equal(first[0].read, null);
    const second = appendSample(first, stats(5000, { blockRead: 6000, blockWrite: 12000 }));
    assert.equal(second[1].read, 500);
    assert.equal(second[1].write, 1000);
    const unsupported = appendSample(second, stats(7000, { blockRead: null, blockWrite: null }));
    assert.equal(unsupported[2].read, null);
    assert.equal(unsupported[2].write, null);
    const reset = appendSample(second, stats(7000, { blockRead: 0, blockWrite: 5 }));
    assert.equal(reset[2].read, 0);
    assert.equal(reset[2].write, 0);
});
