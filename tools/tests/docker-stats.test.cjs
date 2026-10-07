const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const EventEmitter = require('node:events');
const { PassThrough } = require('node:stream');

const source = ts.transpileModule(fs.readFileSync(require.resolve('../../src/api/docker.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2015, esModuleInterop: true },
}).outputText;
const stats = blockEntries => ({
    cpu_stats: { cpu_usage: { total_usage: 10 }, system_cpu_usage: 100, online_cpus: 1 },
    precpu_stats: { cpu_usage: { total_usage: 5 }, system_cpu_usage: 50 },
    memory_stats: { usage: 50, limit: 100 },
    blkio_stats: { io_service_bytes_recursive: blockEntries },
});
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(openStats, options = {}) {
    const exports = {};
    const intervals = new Map();
    const timeouts = new Map();
    const streams = new Map();
    const requests = [];
    const eventStreams = [];
    const logStreams = [];
    const logRequests = [];
    const composeActions = [];
    const listRequests = [];
    const listCallbacks = [];
    let containerList = [{ Id: 'test', Names: ['/test'], State: 'running' }];
    let now = 1000000;
    let nextId = 0;
    class Dockerode {
        constructor() { this.modem = { demuxStream: require('docker-modem').prototype.demuxStream }; }
        getContainer(id) {
            return {
                start: () => { composeActions.push(['start', id]); return Promise.resolve(); },
                stop: () => { composeActions.push(['stop', id]); return Promise.resolve(); },
                unpause: () => {
                    composeActions.push(['unpause', id]);
                    return options.failUnpause ? Promise.reject(new Error('Cannot resume')) : Promise.resolve();
                },
                stats: options => {
                    requests.push({ id, options });
                    if (openStats) return openStats(id, options);
                    const stream = new PassThrough();
                    streams.set(id, stream);
                    return Promise.resolve(stream);
                },
                inspect: opts => options.inspect ? options.inspect(opts) : Promise.resolve({ Config: { Tty: !!options.tty } }),
                logs: opts => {
                    logRequests.push(opts);
                    if (options.openLogs) return options.openLogs(opts);
                    const stream = new PassThrough(); logStreams.push(stream);
                    return Promise.resolve(stream);
                },
            };
        }
        getEvents(opts) {
            if (options.openEvents) return options.openEvents(opts);
            const stream = new PassThrough(); eventStreams.push(stream);
            return Promise.resolve(stream);
        }
        listContainers(opts, callback) {
            listRequests.push(opts);
            if (options.deferList) listCallbacks.push(callback);
            else callback(null, containerList);
        }
    }
    const modules = {
        dockerode: Dockerode,
        electron: { app: { getPath: () => '/home/test' } },
        '@common/constants': { resolveBrewBinary: name => name, brewEnv: {} },
        '@common/events': new EventEmitter(),
    };
    vm.runInNewContext(source, {
        exports, require: name => modules[name] || require(name),
        setInterval: (fn, ms) => { const id = ++nextId; intervals.set(id, { fn, ms }); return id; },
        clearInterval: id => intervals.delete(id),
        setTimeout: (fn, ms) => { const id = ++nextId; timeouts.set(id, { fn, ms }); return id; },
        clearTimeout: id => timeouts.delete(id), AbortController,
        Date: { now: () => now, parse: Date.parse }, console,
    });
    const docker = new exports.default();
    docker.containers = { test: { id: 'test', name: 'test', status: 'running' } };
    const samples = [];
    const logs = [];
    docker.on('log', (...args) => logs.push(args));
    return {
        docker, intervals, timeouts, streams, requests, samples, logs, composeActions,
        eventStreams, logStreams, logRequests, listRequests, listCallbacks,
        setList: list => { containerList = list; },
        fireTimer: ms => {
            const timer = [...timeouts.entries()].find(([, timer]) => timer.ms === ms);
            assert.ok(timer, `expected a ${ms}ms timer`);
            timeouts.delete(timer[0]); timer[1].fn();
        },
        advance: ms => { now += ms; },
        async start() { docker.startStatsStreaming(sample => samples.push(sample)); await tick(); },
        send(data = stats([]), id = 'test') { streams.get(id).write(`${JSON.stringify(data)}\n`); },
    };
}

async function collectStats(blockEntries) {
    const f = fixture();
    await f.start();
    f.send(stats(blockEntries));
    f.docker.stop();
    return f.samples[0];
}

test('Docker stats aggregate block reads and writes across devices without double-counting totals', async () => {
    const sample = await collectStats([
        { op: 'Read', value: 2000 }, { op: 'Write', value: 3000 },
        { op: 'Read', value: 4000 }, { op: 'Write', value: 5000 },
        { op: 'Total', value: 14000 },
    ]);
    assert.equal(sample.blockRead, 6000);
    assert.equal(sample.blockWrite, 8000);
});

test('Docker stats distinguish unavailable block counters from idle devices', async () => {
    const unavailable = await collectStats(null);
    assert.equal(unavailable.blockRead, null);
    assert.equal(unavailable.blockWrite, null);
    const idle = await collectStats([]);
    assert.equal(idle.blockRead, 0);
    assert.equal(idle.blockWrite, 0);
});

test('background streams start with Docker and stop with the connection', async () => {
    const f = fixture();
    f.docker.on('container-stats', sample => f.samples.push(sample));
    f.docker.start();
    await tick();
    f.send();
    assert.equal(f.samples.length, 1);
    assert.equal(f.intervals.size, 0, 'container discovery is event driven');
    assert.equal(f.requests[0].options.stream, true);
    const stream = f.streams.get('test');
    f.docker.stop();
    assert.equal(f.intervals.size, 0);
    assert.equal(stream.destroyed, true);
    assert.equal(f.requests[0].options.abortSignal.aborted, true);
    assert.equal(f.docker.getStatsHistory().samples.length, 0);
    assert.equal(f.docker.getStatsHistory().startedAt, null);
});

test('there is one concurrent persistent request per running container, with no stats polling', async () => {
    const f = fixture();
    f.docker.containers.other = { id: 'other', status: 'running' };
    await f.start();
    f.docker.startStatsStreaming(() => {});
    f.docker._syncStatsStreams();
    assert.equal(f.requests.length, 2);
    assert.equal(f.intervals.size, 0);
    assert.equal(f.timeouts.size, 0);
    f.send();
    f.advance(1000);
    f.send();
    assert.equal(f.samples.length, 2, 'fresh samples arrive without another API request');
    assert.equal(f.requests.length, 2);
    f.docker.stop();
});

test('decodes records split across chunks and multiple records in one chunk', async () => {
    const f = fixture();
    await f.start();
    const record = JSON.stringify({ ...stats([]), read: '2026-10-07T12:00:00.000Z' });
    const next = JSON.stringify({ ...stats([]), read: '2026-10-07T12:00:01.000Z' });
    f.streams.get('test').write(record.slice(0, 20));
    assert.equal(f.samples.length, 0);
    f.streams.get('test').write(`${record.slice(20)}\r\n\n${next}\n`);
    assert.equal(f.samples.length, 2);
    assert.equal(f.samples[1].timestamp - f.samples[0].timestamp, 1000);
    assert.equal(f.samples[1].cpu, 10);
    f.docker.stop();
});

test('stopping aborts pending requests and destroys late streams without emitting old samples', async () => {
    let resolveRequest;
    const f = fixture(() => new Promise(resolve => { resolveRequest = resolve; }));
    f.docker.startStatsStreaming(sample => f.samples.push(sample));
    f.docker.stop();
    assert.equal(f.requests[0].options.abortSignal.aborted, true);
    const late = new PassThrough();
    resolveRequest(late);
    await tick();
    assert.equal(late.destroyed, true);
    assert.equal(f.samples.length, 0);
    assert.equal(f.timeouts.size, 0);
    assert.equal(f.docker.statsStreams.size, 0);
});

test('container discovery stops old streams and starts new running containers', async () => {
    const f = fixture();
    await f.start();
    f.send();
    const old = f.streams.get('test');
    f.docker.containers.test.status = 'exited';
    f.docker.containers.other = { id: 'other', status: 'running' };
    f.docker._syncStatsStreams();
    await tick();
    assert.equal(old.destroyed, true);
    assert.equal(f.docker.statsStreams.has('test'), false);
    assert.equal(f.docker.statsStreams.has('other'), true);
    assert.equal(f.docker.getStatsHistory().samples.length, 0);
    f.docker.stop();
});

test('history keeps a bounded two-minute window at one-second cadence and ignores duplicate timestamps', async () => {
    const f = fixture();
    await f.start();
    f.send();
    for (let i = 0; i < 200; i++) { f.advance(1000); f.send(); }
    f.send();
    const snapshot = f.docker.getStatsHistory();
    assert.ok(snapshot.samples.length <= 122);
    assert.equal(snapshot.startedAt, 1000000);
    assert.equal(snapshot.samples.at(-1).timestamp, 1200000);
    assert.ok(snapshot.samples[0].timestamp >= 1079000);
    assert.equal(f.samples.length, 201);
    f.docker.stop();
});

test('a stream error closes its socket, logs once, and reconnects without polling', async () => {
    const f = fixture();
    await f.start();
    const old = f.streams.get('test');
    old.destroy(new Error('connection lost'));
    await tick();
    assert.equal(f.logs.length, 1);
    assert.equal(f.docker.statsStreams.size, 1, 'retry placeholder prevents duplicate connections');
    f.fireTimer(2000);
    await tick();
    assert.equal(f.requests.length, 2);
    f.send();
    assert.equal(f.samples.length, 1);
    f.docker.stop();
});

test('malformed JSON closes the stream cleanly and allows reconnecting', async () => {
    const f = fixture();
    await f.start();
    const old = f.streams.get('test');
    old.write('{invalid}\n');
    assert.equal(old.destroyed, true);
    assert.equal(f.logs.length, 1);
    f.fireTimer(2000);
    await tick();
    f.send();
    assert.equal(f.samples.length, 1);
    f.docker.stop();
});

test('first sample without a CPU baseline and empty shutdown records do not invent CPU spikes', async () => {
    const f = fixture();
    await f.start();
    f.send({ ...stats([]), precpu_stats: {} });
    assert.equal(f.samples[0].cpu, 0);
    f.send({ id: 'test' });
    f.send({ ...stats([]), read: '0001-01-01T00:00:00Z', memory_stats: {} });
    assert.equal(f.samples.length, 1);
    assert.equal(f.logs.length, 0);
    f.docker.stop();
});

test('stalled connection attempts time out and retry without polling', async () => {
    let stall = true;
    const f = fixture((_, options) => {
        if (!stall) return Promise.resolve(new PassThrough());
        return new Promise((_, reject) => {
            options.abortSignal.addEventListener('abort', () => reject(new Error('connection timed out')));
        });
    });
    f.docker.startStatsStreaming(() => {});
    const timeout = [...f.timeouts.values()][0];
    assert.equal(timeout.ms, 5000);
    timeout.fn();
    await tick();
    assert.equal(f.timeouts.size, 1, 'retry is scheduled');
    assert.equal(f.logs.length, 1);
    stall = false;
    f.fireTimer(2000);
    await tick();
    assert.equal(f.requests.length, 2);
    f.docker.stop();
});

const frame = (text, type = 1) => {
    const payload = Buffer.isBuffer(text) ? text : Buffer.from(text);
    const header = Buffer.alloc(8);
    header[0] = type; header.writeUInt32BE(payload.length, 4);
    return Buffer.concat([header, payload]);
};

test('events subscribe before the initial snapshot, with no idle polling or reconnect timers', async () => {
    const f = fixture();
    f.docker.start();
    assert.equal(f.eventStreams.length, 1);
    assert.equal(f.listRequests.length, 0, 'wait until the event stream is attached');
    await tick();
    assert.equal(f.listRequests.length, 1);
    assert.equal(f.intervals.size, 0);
    assert.equal(f.timeouts.size, 0);
    f.docker.start();
    assert.equal(f.eventStreams.length, 1);
    f.docker.stop();
    assert.equal(f.eventStreams[0].destroyed, true);
});

test('container and network events refresh metadata and stream membership without polling', async () => {
    const f = fixture();
    f.docker.start(); await tick();
    f.setList([
        { Id: 'test', Names: ['/renamed'], State: 'running', NetworkSettings: { Networks: { added: { IPAddress: '10.0.0.2' } } } },
        { Id: 'other', Names: ['/other'], State: 'running' },
    ]);
    const rename = JSON.stringify({ Type: 'container', Action: 'rename' });
    f.eventStreams[0].write(rename.slice(0, 8));
    f.eventStreams[0].write(`${rename.slice(8)}\n`);
    f.eventStreams[0].write(`${JSON.stringify({ Type: 'network', Action: 'connect' })}\n`);
    f.fireTimer(100); await tick();
    assert.equal(f.docker.containers.test.name, 'renamed');
    assert.equal(f.docker.containers.test.networks[0].name, 'added');
    assert.equal(f.docker.statsStreams.has('other'), true);
    f.setList([{ Id: 'test', Names: ['/renamed'], State: 'exited' }]);
    const event = JSON.stringify({ Type: 'container', Action: 'die' });
    f.eventStreams[0].write(event.slice(0, 8));
    f.eventStreams[0].write(`${event.slice(8)}\n`);
    f.eventStreams[0].write(`${JSON.stringify({ Type: 'network', Action: 'disconnect' })}\n`);
    f.fireTimer(100); await tick();
    assert.equal(f.docker.statsStreams.size, 0);
    assert.equal(f.docker.containers.test.status, 'exited');
    assert.equal(f.listRequests.length, 3);
    f.docker.stop();
});

test('event bursts coalesce and events during a snapshot trigger one follow-up refresh', async () => {
    const f = fixture(undefined, { deferList: true });
    f.docker.start(); await tick();
    const stream = f.eventStreams[0];
    for (let i = 0; i < 20; i++) stream.write(`${JSON.stringify({ Type: 'container', Action: 'start' })}\n`);
    f.fireTimer(100);
    assert.equal(f.listRequests.length, 1, 'only one snapshot may be in flight');
    f.listCallbacks[0](null, []);
    f.fireTimer(100);
    assert.equal(f.listRequests.length, 2);
    f.listCallbacks[1](null, [{ Id: 'new', Names: ['/new'], State: 'running' }]);
    await tick();
    assert.equal(f.docker.containers.new.name, 'new');
    assert.equal(f.timeouts.size, 0);
    stream.write(`${JSON.stringify({ Type: 'container', Action: 'exec_start' })}\n`);
    assert.equal(f.timeouts.size, 0, 'shell exec activity does not rescan containers');
    f.docker.stop();
});

test('event connection errors reconnect and take a fresh snapshot', async () => {
    const f = fixture();
    f.docker.start(); await tick();
    f.eventStreams[0].destroy(new Error('socket lost')); await tick();
    f.fireTimer(2000); await tick();
    assert.equal(f.eventStreams.length, 2);
    assert.equal(f.listRequests.length, 2);
    assert.ok(f.logs.some(([message]) => message.includes('socket lost')));
    f.docker.stop();
    assert.equal(f.timeouts.size, 0);
});

test('snapshot errors retry only on failure and late snapshots cannot update a stopped runtime', async () => {
    const f = fixture(undefined, { deferList: true });
    f.docker.start(); await tick();
    f.listCallbacks[0](new Error('snapshot failed'));
    f.fireTimer(2000);
    assert.equal(f.listRequests.length, 2);
    f.docker.stop();
    f.listCallbacks[1](null, [{ Id: 'late', State: 'running' }]);
    assert.equal(f.docker.containers.late, undefined);
    assert.equal(f.timeouts.size, 0);
});

test('a snapshot interrupted by event reconnection is replaced with a fresh snapshot', async () => {
    const f = fixture(undefined, { deferList: true });
    f.docker.start(); await tick();
    f.eventStreams[0].destroy(); await tick();
    f.fireTimer(2000); await tick();
    f.listCallbacks[0](new Error('old connection aborted'));
    f.fireTimer(100);
    assert.equal(f.listRequests.length, 2);
    f.listCallbacks[1](null, []);
    assert.equal(f.docker.firstPollDone, true);
    f.docker.stop();
});

test('late event connections are aborted and destroyed after stopping', async () => {
    let resolve;
    let signal;
    const f = fixture(undefined, { openEvents: opts => {
        signal = opts.abortSignal;
        return new Promise(done => { resolve = done; });
    } });
    f.docker.start(); f.docker.stop();
    const stream = new PassThrough(); resolve(stream); await tick();
    assert.equal(signal.aborted, true);
    assert.equal(stream.destroyed, true);
    assert.equal(f.listRequests.length, 0);
    assert.equal(f.timeouts.size, 0);
});

test('socket logs demultiplex split headers, preserve UTF-8, and keep stdout and stderr partial lines separate', async () => {
    const f = fixture();
    const lines = [];
    await f.docker.startLogStream('test', line => lines.push(line));
    const stream = f.logStreams[0];
    assert.equal(f.logRequests[0].follow, true);
    const unicode = Buffer.from('hello café ⚓\nshort\n');
    const first = frame(unicode.subarray(0, 10));
    stream.write(first.subarray(0, 4)); stream.write(first.subarray(4));
    stream.write(Buffer.concat([frame('error\n', 2), frame(unicode.subarray(10)), frame('partial')]));
    stream.end(); await tick();
    assert.deepEqual(lines, ['error', 'hello café ⚓', 'short', 'partial']);
    assert.equal(stream.destroyed, true);
    f.docker.stop();
});

test('TTY socket logs are plain text and do not lose their first eight characters', async () => {
    const f = fixture(undefined, { tty: true });
    const lines = [];
    await f.docker.startLogStream('test', line => lines.push(line));
    f.logStreams[0].write('2026-10-07T12:00:00Z hello\nhi\n');
    assert.deepEqual(lines, ['2026-10-07T12:00:00Z hello', 'hi']);
    f.docker.stop();
    assert.equal(f.logStreams[0].destroyed, true);
});

test('log reconnects resume from the timestamp and skip replayed lines without losing same-timestamp duplicates', async () => {
    const f = fixture(undefined, { tty: true });
    const lines = [];
    await f.docker.startLogStream('test', line => lines.push(line));
    const first = '2026-10-07T12:00:00.123456789Z first';
    f.logStreams[0].write(`${first}\n${first}\n`);
    f.logStreams[0].destroy(new Error('disconnected')); await tick();
    f.fireTimer(2000); await tick();
    assert.equal(f.logRequests[1].since, '2026-10-07T12:00:00.123456789Z');
    f.logStreams[1].write(`${first}\n${first}\n${first}\n2026-10-07T12:00:01Z second\n`);
    assert.deepEqual(lines, [first, first, first, '2026-10-07T12:00:01Z second']);
    f.docker.stop();
    assert.equal(f.timeouts.size, 0);
});

test('leaving logs aborts pending opens and cannot resurrect a canceled subscription', async () => {
    let resolve;
    const f = fixture(undefined, { openLogs: () => new Promise(done => { resolve = done; }) });
    const opening = f.docker.startLogStream('test', () => assert.fail('old logs emitted'));
    await tick();
    f.docker.stopLogStream('test');
    const stream = new PassThrough(); resolve(stream); await opening;
    assert.equal(stream.destroyed, true);
    assert.equal(f.docker.logStreams.size, 0);
    assert.equal(f.timeouts.size, 0);
    f.docker.stop();
});

test('stalled snapshots time out, release the refresh token, and ignore late callbacks', async () => {
    const f = fixture(undefined, { deferList: true });
    f.docker.start(); await tick();
    const firstSignal = f.listRequests[0].abortSignal;
    f.fireTimer(5000);
    assert.equal(firstSignal.aborted, true);
    assert.equal(f.docker.containerRefresh, null);
    f.fireTimer(2000);
    assert.equal(f.listRequests.length, 2);
    f.listCallbacks[0](null, [{ Id: 'late', State: 'running' }]);
    assert.equal(f.docker.containers.late, undefined);
    assert.ok(f.docker.containerRefresh, 'old callback cannot clear the new snapshot');
    f.listCallbacks[1](null, [{ Id: 'current', State: 'running' }]);
    await tick();
    assert.equal(f.docker.containers.current.id, 'current');
    f.docker.stop();
    assert.equal(f.timeouts.size, 0);
});

test('out-of-order stdout/stderr logs keep the highest resume timestamp without replaying newer lines', async () => {
    const f = fixture(undefined, { tty: true });
    const lines = [];
    await f.docker.startLogStream('test', line => lines.push(line));
    const newer = '2026-10-07T12:00:02Z newer';
    const older = '2026-10-07T12:00:01Z older';
    f.logStreams[0].write(`${newer}\n${older}\n`);
    f.logStreams[0].destroy(); await tick();
    f.fireTimer(2000); await tick();
    assert.equal(f.logRequests[1].since, '2026-10-07T12:00:02Z');
    f.logStreams[1].write(`${older}\n${newer}\n2026-10-07T12:00:03Z newest\n`);
    assert.deepEqual(lines, [newer, older, '2026-10-07T12:00:03Z newest']);
    f.docker.stop();
});

test('log cursor comparisons preserve nanoseconds within the same millisecond', async () => {
    const f = fixture(undefined, { tty: true });
    await f.docker.startLogStream('test', () => {});
    f.logStreams[0].write('2026-10-07T12:00:00.300000002Z newer\n2026-10-07T12:00:00.3Z older\n');
    f.logStreams[0].destroy(); await tick();
    f.fireTimer(2000); await tick();
    assert.equal(f.logRequests[1].since, '2026-10-07T12:00:00.300000002Z');
    f.docker.stop();
});

test('compose project actions resume paused containers before starting or stopping', async () => {
    const f = fixture();
    f.docker.containers = Object.fromEntries(['running', 'paused', 'exited'].map(status => [status, {
        id: status, name: status, composeProject: 'demo', status,
    }]));
    await f.docker.composeUp('demo');
    assert.deepEqual(f.composeActions, [['unpause', 'paused'], ['start', 'exited']]);
    f.composeActions.length = 0;
    await f.docker.composeDown('demo');
    assert.deepEqual(f.composeActions, [['stop', 'running'], ['unpause', 'paused'], ['stop', 'paused']]);
});

test('compose project actions report a failed resume', async () => {
    const f = fixture(undefined, { failUnpause: true });
    f.docker.containers = { paused: { id: 'paused', name: 'paused', composeProject: 'demo', status: 'paused' } };
    await assert.rejects(f.docker.composeUp('demo'), /Could not start: paused/);
    await assert.rejects(f.docker.composeDown('demo'), /Could not stop: paused/);
    assert.equal(f.logs.filter(([, level]) => level === 'error').length, 2);
});
