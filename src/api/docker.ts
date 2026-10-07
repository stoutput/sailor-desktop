import EventEmitter from 'events'
import Dockerode from 'dockerode';
import { Readable, Duplex, PassThrough } from 'stream';
import { exec } from 'child_process';
import { createInterface } from 'readline';
import { StringDecoder } from 'string_decoder';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { resolveBrewBinary, brewEnv } from '@common/constants';
import {app} from 'electron';
import { ContainerData, ContainerStats, ContainerStatsHistory, DockerContext } from '@common/types';

/** Docker log cursors have nanosecond precision, beyond JavaScript Date's milliseconds. */
function compareLogTimestamps(a: string, b: string): number {
    const milliseconds = Date.parse(a) - Date.parse(b);
    if (milliseconds) return milliseconds;
    const remainder = (timestamp: string) => Number((timestamp.match(/\.(\d+)/)?.[1] || '').padEnd(9, '0').slice(3, 9));
    return remainder(a) - remainder(b);
}

interface SocketStream {
    controller: AbortController;
    stream?: Readable;
    retry?: NodeJS.Timeout;
}

interface LogStream extends SocketStream {
    onLog: (line: string) => void;
    connecting: boolean;
    lastTimestamp?: string;
    lastLines: Map<string, number>;
}

interface ShellSession {
    stream: Duplex;
    exec: Dockerode.Exec;
    containerId: string;
}

class Docker extends EventEmitter {
    binaryPath = resolveBrewBinary('docker')
    activeInstance = 'default'
    docker: Dockerode
    containers: {[key: string]: ContainerData} = {}
    running = false
    eventStream: SocketStream | null = null
    containerRefresh: { pending: boolean; controller: AbortController } | null = null
    refreshTimer: NodeJS.Timeout | null = null
    firstPollDone = false
    logStreams = new Map<string, LogStream>()
    statsStreams = new Map<string, SocketStream>()
    statsCallback: ((stats: ContainerStats) => void) | null = null
    statsHistory = new Map<string, ContainerStats[]>()
    statsStartedAt: number | null = null
    shellSessions: Map<string, ShellSession> = new Map()

    constructor(instanceName = 'default') {
        super();
        this.activeInstance = instanceName;
        this.docker = new Dockerode({
            socketPath: `${app.getPath('home')}/.colima/${instanceName}/docker.sock`
        });
    }

    _normalizeStatus(state: string): ContainerData['status'] {
        const lowerState = state.toLowerCase();
        switch (lowerState) {
            case 'created':
            case 'paused':
            case 'running':
            case 'exited':
                return lowerState;
            default:
                return 'booting';
        }
    }

    _containerInfoToData(info: Dockerode.ContainerInfo): ContainerData {
        const networks: ContainerData['networks'] = [];
        if (info.NetworkSettings?.Networks) {
            for (const [name, netInfo] of Object.entries(info.NetworkSettings.Networks)) {
                networks.push({
                    name,
                    ipAddress: netInfo.IPAddress || ''
                });
            }
        }

        const ports: ContainerData['ports'] = (info.Ports || []).map(p => ({
            privatePort: p.PrivatePort,
            publicPort: p.PublicPort,
            type: p.Type
        }));

        // Extract Docker Compose labels if present
        const labels = info.Labels || {};
        const composeProject = labels['com.docker.compose.project'];
        const composeService = labels['com.docker.compose.service'];

        return {
            id: info.Id,
            name: info.Names?.[0]?.replace(/^\//, '') || info.Id.slice(0, 12),
            image: info.Image,
            status: this._normalizeStatus(info.State),
            ports,
            networks,
            created: info.Created,
            composeProject,
            composeService
        };
    }

    _scheduleContainerRefresh(delay = 100): void {
        if (!this.running || this.refreshTimer) return;
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this._refreshContainers();
        }, delay);
    }

    _refreshContainers(): void {
        const connection = this.eventStream;
        if (!this.running || !connection?.stream || connection.controller.signal.aborted) return;
        if (this.containerRefresh) {
            this.containerRefresh.pending = true;
            return;
        }
        const refresh = { pending: false, controller: new AbortController() };
        this.containerRefresh = refresh;
        const finish = (err: Error | null, containerList?: Array<Dockerode.ContainerInfo>) => {
            clearTimeout(timeout);
            connection.controller.signal.removeEventListener('abort', cancel);
            if (this.containerRefresh !== refresh) return;
            this.containerRefresh = null;
            if (!this.running) return;
            if (this.eventStream !== connection || connection.controller.signal.aborted) {
                this._scheduleContainerRefresh();
                return;
            }
            if (err || !containerList) {
                this.emit('log', `Could not refresh containers: ${err?.message || 'empty response'}`, 'error');
                this._scheduleContainerRefresh(2000);
                return;
            }
            const next = Object.fromEntries(containerList.map(info => {
                const data = this._containerInfoToData(info);
                return [data.id, data];
            }));
            const changed = JSON.stringify(this.containers) !== JSON.stringify(next);
            this.containers = next;
            this._syncStatsStreams();
            for (const [id, entry] of this.logStreams) {
                if (this.containers[id]?.status === 'running') {
                    if (!entry.stream && !entry.connecting && !entry.retry) void this._openLogStream(id, entry);
                } else {
                    clearTimeout(entry.retry);
                    entry.retry = undefined;
                    entry.controller.abort();
                    entry.stream?.destroy();
                }
            }
            for (const id of this.statsHistory.keys()) {
                if (this.containers[id]?.status !== 'running') this.statsHistory.delete(id);
            }
            if (changed || !this.firstPollDone) {
                this.firstPollDone = true;
                this.emit('containers-update', this.getContainers());
            }
            if (refresh.pending) this._scheduleContainerRefresh();
        };
        const cancel = () => {
            refresh.controller.abort();
            finish(new Error('Container snapshot connection closed'));
        };
        const timeout = setTimeout(() => {
            refresh.controller.abort();
            finish(new Error('Container snapshot timed out'));
        }, 5000);
        connection.controller.signal.addEventListener('abort', cancel, { once: true });
        this.docker.listContainers({ all: true, abortSignal: refresh.controller.signal }, finish);
    }

    async _openEventStream(): Promise<void> {
        if (!this.running || this.eventStream) return;
        const entry: SocketStream = { controller: new AbortController() };
        this.eventStream = entry;
        const isCurrent = () => this.running && this.eventStream === entry;
        const reconnect = (err?: Error) => {
            if (!isCurrent() || entry.retry) return;
            entry.controller.abort();
            entry.stream?.destroy();
            entry.stream = undefined;
            if (err) this.emit('log', `Docker events stream: ${err.message}`, 'error');
            entry.retry = setTimeout(() => {
                if (!isCurrent()) return;
                this.eventStream = null;
                void this._openEventStream();
            }, 2000);
        };
        const timeout = setTimeout(() => entry.controller.abort(), 5000);
        try {
            const stream = await this.docker.getEvents({
                filters: { type: ['container', 'network'] }, abortSignal: entry.controller.signal,
            }) as Readable;
            clearTimeout(timeout);
            if (!isCurrent() || entry.controller.signal.aborted) {
                stream.destroy();
                if (isCurrent()) reconnect(new Error('Connection timed out'));
                return;
            }
            entry.stream = stream;
            const lines = createInterface({ input: stream });
            const finish = (err?: Error) => { lines.close(); reconnect(err); };
            lines.on('line', line => {
                if (!isCurrent() || entry.controller.signal.aborted || !line.trim()) return;
                try {
                    const event = JSON.parse(line);
                    const action: string = event.Action || event.status || '';
                    if ((event.Type === 'container' && !action.startsWith('exec_'))
                        || (event.Type === 'network' && ['connect', 'disconnect'].includes(action))) {
                        this._scheduleContainerRefresh();
                    }
                } catch (err) { finish(err); }
            });
            lines.on('error', finish);
            stream.on('error', finish);
            stream.once('end', () => finish());
            stream.once('close', () => finish());
            // Subscribe before taking the snapshot so startup events cannot be missed.
            this._refreshContainers();
        } catch (err) { reconnect(err); }
        finally { clearTimeout(timeout); }
    }

    getContainers(): ContainerData[] {
        return Object.values(this.containers);
    }

    async startContainer(containerId: string): Promise<void> {
        this.emit('log', `Starting container ${containerId.slice(0, 12)}...`, 'info');
        const container = this.docker.getContainer(containerId);
        await container.start();
        this.emit('log', `Container started`, 'info');
    }

    async stopContainer(containerId: string): Promise<void> {
        this.emit('log', `Stopping container ${containerId.slice(0, 12)}...`, 'info');
        const container = this.docker.getContainer(containerId);
        await container.stop();
        this.emit('log', `Container stopped`, 'info');
    }

    async startLogStream(containerId: string, onLog: (line: string) => void): Promise<void> {
        this.stopLogStream(containerId);
        const entry: LogStream = {
            controller: new AbortController(), onLog, connecting: false, lastLines: new Map(),
        };
        this.logStreams.set(containerId, entry);
        await this._openLogStream(containerId, entry);
    }

    async _openLogStream(containerId: string, entry: LogStream): Promise<void> {
        const controller = new AbortController();
        entry.controller = controller;
        entry.connecting = true;
        const isCurrent = () => this.logStreams.get(containerId) === entry
            && entry.controller === controller && !controller.signal.aborted;
        const reconnect = (err?: Error) => {
            if (this.logStreams.get(containerId) !== entry || entry.controller !== controller) return;
            entry.stream = undefined;
            if (err && (!controller.signal.aborted || this.containers[containerId]?.status === 'running')) {
                this.emit('log', `Container logs ${containerId.slice(0, 12)}: ${err.message}`, 'error');
            }
            controller.abort();
            if (this.containers[containerId]?.status === 'running' && !entry.retry) {
                entry.retry = setTimeout(() => {
                    entry.retry = undefined;
                    if (this.logStreams.get(containerId) === entry) void this._openLogStream(containerId, entry);
                }, 2000);
            }
        };
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const container = this.docker.getContainer(containerId);
            const info = await container.inspect({ abortSignal: controller.signal });
            if (!isCurrent()) { reconnect(new Error('Connection timed out')); return; }
            const stream = await container.logs({
                follow: true, stdout: true, stderr: true, timestamps: true,
                tail: entry.lastTimestamp ? undefined : 100,
                since: entry.lastTimestamp,
                abortSignal: controller.signal,
            }) as Readable;
            clearTimeout(timeout);
            if (!isCurrent()) { stream.destroy(); reconnect(new Error('Connection timed out')); return; }
            entry.stream = stream;
            const replayTimestamp = entry.lastTimestamp;
            const replayLines = new Map(entry.lastLines);
            const outputs = info.Config.Tty ? null : [new PassThrough(), new PassThrough()];
            const inputs = outputs || [stream];
            const buffers = inputs.map(() => ({ decoder: new StringDecoder('utf8'), text: '' }));
            const onLine = (line: string) => {
                if (!isCurrent() || !line.trim()) return;
                const timestamp = line.split(' ', 1)[0];
                if (Number.isFinite(Date.parse(timestamp))) {
                    const replayOrder = replayTimestamp ? compareLogTimestamps(timestamp, replayTimestamp) : 1;
                    if (replayOrder < 0) return;
                    const remaining = replayOrder === 0 ? replayLines.get(line) || 0 : 0;
                    if (remaining) { replayLines.set(line, remaining - 1); return; }
                    const cursorOrder = entry.lastTimestamp ? compareLogTimestamps(timestamp, entry.lastTimestamp) : 1;
                    if (cursorOrder > 0) {
                        entry.lastTimestamp = timestamp;
                        entry.lastLines.clear();
                    }
                    if (cursorOrder >= 0) entry.lastLines.set(line, (entry.lastLines.get(line) || 0) + 1);
                }
                entry.onLog(line);
            };
            let finished = false;
            const finish = (err?: Error) => {
                if (finished) return;
                finished = true;
                buffers.forEach(buffer => onLine(buffer.text + buffer.decoder.end()));
                inputs.forEach(input => input.destroy());
                stream.destroy();
                reconnect(err);
            };
            inputs.forEach((input, index) => input.on('data', (chunk: Buffer) => {
                const buffer = buffers[index];
                const lines = (buffer.text + buffer.decoder.write(chunk)).split('\n');
                buffer.text = lines.pop() || '';
                lines.forEach(line => onLine(line.replace(/\r$/, '')));
            }));
            stream.on('error', finish);
            stream.once('end', () => finish());
            stream.once('close', () => finish());
            if (outputs) this.docker.modem.demuxStream(stream, outputs[0], outputs[1]);
        } catch (err) { reconnect(err); }
        finally {
            clearTimeout(timeout);
            if (entry.controller === controller) entry.connecting = false;
        }
    }

    stopLogStream(containerId: string): void {
        const entry = this.logStreams.get(containerId);
        if (!entry) return;
        this.logStreams.delete(containerId);
        clearTimeout(entry.retry);
        entry.controller.abort();
        entry.stream?.destroy();
    }

    startStatsStreaming(onStats: (stats: ContainerStats) => void): void {
        if (this.statsCallback) return;
        this.statsCallback = onStats;
        this._syncStatsStreams();
    }

    _syncStatsStreams(): void {
        for (const [id, entry] of this.statsStreams) {
            if (this.containers[id]?.status !== 'running') {
                this.statsStreams.delete(id);
                clearTimeout(entry.retry);
                entry.controller.abort();
                entry.stream?.destroy();
                this.statsHistory.delete(id);
            }
        }
        if (!this.statsCallback) return;
        for (const container of Object.values(this.containers)) {
            if (container.status === 'running' && !this.statsStreams.has(container.id)) {
                void this._openStatsStream(container);
            }
        }
    }

    async _openStatsStream(container: ContainerData): Promise<void> {
        const entry: SocketStream = { controller: new AbortController() };
        this.statsStreams.set(container.id, entry);
        const isCurrent = () => this.statsStreams.get(container.id) === entry && !entry.controller.signal.aborted;
        const timeout = setTimeout(() => entry.controller.abort(), 5000);
        try {
            // Dockerode supports abortSignal, but its bundled typings omit it.
            const options = { stream: true as const, abortSignal: entry.controller.signal };
            const stream = await this.docker.getContainer(container.id).stats(options) as Readable;
            clearTimeout(timeout);
            if (!isCurrent()) {
                if (this.statsStreams.get(container.id) === entry) {
                    this.statsStreams.delete(container.id);
                    this._retryStatsStream(container.id, entry);
                }
                stream.destroy();
                return;
            }
            entry.stream = stream;
            const lines = createInterface({ input: stream });
            const finish = (err?: Error) => {
                lines.close();
                if (!isCurrent()) return;
                this.statsStreams.delete(container.id);
                entry.controller.abort();
                stream.destroy();
                if (err) this.emit('log', `Stats stream for ${container.name}: ${err.message}`, 'error');
                this._retryStatsStream(container.id, entry);
            };
            lines.on('line', line => {
                if (!isCurrent() || this.containers[container.id]?.status !== 'running' || !line.trim()) return;
                try {
                    this._recordStats(container.id, JSON.parse(line));
                } catch (err) {
                    finish(err);
                    stream.destroy();
                }
            });
            lines.on('error', finish);
            stream.once('end', () => finish());
            stream.once('close', () => finish());
            stream.on('error', finish);
        } catch (err) {
            if (this.statsStreams.get(container.id) !== entry) return;
            this.statsStreams.delete(container.id);
            if (err.statusCode !== 404) {
                this.emit('log', `Could not open stats for ${container.name}: ${err.message}`, 'error');
            }
            this._retryStatsStream(container.id, entry);
        } finally {
            clearTimeout(timeout);
        }
    }

    _retryStatsStream(containerId: string, entry: SocketStream): void {
        if (!this.statsCallback || this.containers[containerId]?.status !== 'running') return;
        this.statsStreams.set(containerId, entry);
        entry.retry = setTimeout(() => {
            if (this.statsStreams.get(containerId) !== entry) return;
            this.statsStreams.delete(containerId);
            this._syncStatsStreams();
        }, 2000);
    }

    _recordStats(containerId: string, stats: Dockerode.ContainerStats): void {
        // Docker can send an empty record as a container stops.
        if (!stats.cpu_stats?.cpu_usage || !Number.isFinite(stats.memory_stats?.usage)) return;
        const previousCpu = stats.precpu_stats?.cpu_usage?.total_usage;
        const previousSystem = stats.precpu_stats?.system_cpu_usage;
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (previousCpu ?? 0);
        const systemDelta = stats.cpu_stats.system_cpu_usage - (previousSystem ?? 0);
        const cpuCount = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
        const cpuPercent = previousCpu !== undefined && previousSystem > 0 && systemDelta > 0
            ? Math.max(0, cpuDelta / systemDelta * cpuCount * 100) : 0;
        let networkRx = 0;
        let networkTx = 0;
        for (const net of Object.values(stats.networks || {})) {
            networkRx += net.rx_bytes || 0;
            networkTx += net.tx_bytes || 0;
        }
        const blockEntries = stats.blkio_stats?.io_service_bytes_recursive as { op: string; value: number }[] | null | undefined;
        const blockTotal = (operation: string) => blockEntries
            ? blockEntries.filter(entry => entry.op.toLowerCase() === operation)
                .reduce((total, entry) => total + entry.value, 0)
            : null;
        const readAt = Date.parse(stats.read);
        const sample: ContainerStats = {
            containerId,
            timestamp: Number.isFinite(readAt) ? readAt : Date.now(),
            cpu: cpuPercent,
            memory: stats.memory_stats.usage || 0,
            memoryLimit: stats.memory_stats.limit || 1,
            networkRx,
            networkTx,
            blockRead: blockTotal('read'),
            blockWrite: blockTotal('write'),
        };
        const history = this.statsHistory.get(containerId) || [];
        if (history.length && sample.timestamp <= history[history.length - 1].timestamp) return;
        this.statsStartedAt = this.statsStartedAt ?? sample.timestamp;
        history.push(sample);
        const cutoff = sample.timestamp - 120000;
        while (history.length > 2 && history[1].timestamp < cutoff) history.shift();
        this.statsHistory.set(containerId, history.slice(-122));
        this.statsCallback?.(sample);
    }

    stopStatsStreaming(): void {
        this.statsCallback = null;
        for (const entry of this.statsStreams.values()) {
            clearTimeout(entry.retry);
            entry.controller.abort();
            entry.stream?.destroy();
        }
        this.statsStreams.clear();
        this.statsHistory.clear();
        this.statsStartedAt = null;
    }

    getStatsHistory(): ContainerStatsHistory {
        return {
            startedAt: this.statsStartedAt,
            samples: Array.from(this.statsHistory.entries())
                .filter(([id]) => this.containers[id]?.status === 'running')
                .flatMap(([, samples]) => samples),
        };
    }

    // Filter out unwanted ANSI escape sequences from terminal output
    _filterAnsiEscapes(data: string): string {
        // Remove cursor position queries (ESC[6n) and similar sequences
        // that shouldn't be displayed as text
        // eslint-disable-next-line no-control-regex
        return data
            // eslint-disable-next-line no-control-regex
            .replace(/\x1b\[\d*n/g, '')  // Device status report queries
            // eslint-disable-next-line no-control-regex
            .replace(/\x1b\[[?]?\d*[hl]/g, '')  // Mode set/reset
            // eslint-disable-next-line no-control-regex
            .replace(/\x1b\[\d*[ABCDJK]/g, (match) => {
                // Keep cursor movement but filter out erase commands that cause issues
                if (match.includes('J') || match.includes('K')) return '';
                return match;
            });
    }

    async createShellSession(
        containerId: string,
        onData: (data: string) => void,
        onExit: (code: number | null) => void
    ): Promise<string> {
        // Close existing session for this container if any
        this.closeShellSession(containerId);

        const container = this.docker.getContainer(containerId);

        try {
            // Create exec instance with interactive shell
            const exec = await container.exec({
                Cmd: ['/bin/sh', '-c', 'TERM=dumb; export TERM; [ -x /bin/bash ] && exec /bin/bash --noediting || exec /bin/sh'],
                AttachStdin: true,
                AttachStdout: true,
                AttachStderr: true,
                Tty: true
            });

            // Start the exec and get the stream
            const stream = await exec.start({
                hijack: true,
                stdin: true
            }) as Duplex;

            const session: ShellSession = {
                stream,
                exec,
                containerId
            };

            stream.on('data', (chunk: Buffer) => {
                const text = chunk.toString('utf8');
                const filtered = this._filterAnsiEscapes(text);
                if (filtered) {
                    onData(filtered);
                }
            });

            stream.on('end', () => {
                this.shellSessions.delete(containerId);
                onExit(0);
            });

            stream.on('error', (err) => {
                onData(`\r\nError: ${err.message}\r\n`);
                this.shellSessions.delete(containerId);
                onExit(1);
            });

            this.shellSessions.set(containerId, session);
            return containerId;
        } catch (err) {
            onData(`\r\nFailed to create shell: ${err}\r\n`);
            onExit(1);
            throw err;
        }
    }

    writeToShell(containerId: string, data: string): boolean {
        const session = this.shellSessions.get(containerId);
        if (session && session.stream.writable) {
            session.stream.write(data);
            return true;
        }
        return false;
    }

    closeShellSession(containerId: string): void {
        const session = this.shellSessions.get(containerId);
        if (session) {
            session.stream.destroy();
            this.shellSessions.delete(containerId);
        }
    }

    hasShellSession(containerId: string): boolean {
        return this.shellSessions.has(containerId);
    }

    _verify_symlinks(_binPath: string) {
        // verify that binary path is symlinked to docker path, or installed in docker engine
        return true;
    }

    getComposeProjects(): { name: string; containers: ContainerData[] }[] {
        const projectMap = new Map<string, ContainerData[]>();

        for (const container of Object.values(this.containers)) {
            if (container.composeProject) {
                const existing = projectMap.get(container.composeProject) || [];
                existing.push(container);
                projectMap.set(container.composeProject, existing);
            }
        }

        return Array.from(projectMap.entries()).map(([name, containers]) => ({
            name,
            containers
        }));
    }

    async composeUp(projectName: string): Promise<void> {
        // Find containers from this project to get the working directory
        const projectContainers = Object.values(this.containers).filter(
            c => c.composeProject === projectName
        );

        if (projectContainers.length === 0) {
            throw new Error(`No containers found for project: ${projectName}`);
        }

        // Start stopped containers and resume paused ones.
        this.emit('log', `Starting compose project: ${projectName}`, 'info');

        const failures: string[] = [];
        for (const container of projectContainers) {
            if (container.status === 'exited' || container.status === 'created' || container.status === 'paused') {
                try {
                    if (container.status === 'paused') await this.docker.getContainer(container.id).unpause();
                    else await this.startContainer(container.id);
                } catch (err) {
                    this.emit('log', `Failed to start ${container.name}: ${err}`, 'error');
                    failures.push(container.name);
                }
            }
        }

        if (failures.length) throw new Error(`Could not start: ${failures.join(', ')}`);
        this.emit('log', `Compose project ${projectName} started`, 'info');
    }

    async composeDown(projectName: string): Promise<void> {
        const projectContainers = Object.values(this.containers).filter(
            c => c.composeProject === projectName
        );

        if (projectContainers.length === 0) {
            throw new Error(`No containers found for project: ${projectName}`);
        }

        this.emit('log', `Stopping compose project: ${projectName}`, 'info');

        const failures: string[] = [];
        for (const container of projectContainers) {
            if (container.status === 'running' || container.status === 'paused') {
                try {
                    if (container.status === 'paused') await this.docker.getContainer(container.id).unpause();
                    await this.stopContainer(container.id);
                } catch (err) {
                    this.emit('log', `Failed to stop ${container.name}: ${err}`, 'error');
                    failures.push(container.name);
                }
            }
        }

        if (failures.length) throw new Error(`Could not stop: ${failures.join(', ')}`);
        this.emit('log', `Compose project ${projectName} stopped`, 'info');
    }

    async listContexts(): Promise<DockerContext[]> {
        try {
            const { stdout } = await execAsync(`${this.binaryPath} context ls --format json`, {
                timeout: 10000,
                env: brewEnv,
            });

            const lines = stdout.trim().split('\n').filter(line => line.trim());
            const contexts: DockerContext[] = [];

            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    contexts.push({
                        name: data.Name || '',
                        description: data.Description || '',
                        dockerEndpoint: data.DockerEndpoint || '',
                        current: data.Current === true || data.Current === 'true'
                    });
                } catch {
                    // Skip malformed lines
                }
            }

            return contexts;
        } catch (err) {
            this.emit('log', `Failed to list contexts: ${err}`, 'error');
            return [];
        }
    }

    async switchContext(contextName: string): Promise<void> {
        this.emit('log', `Switching to Docker context: ${contextName}`, 'info');
        try {
            await execAsync(`${this.binaryPath} context use ${contextName}`, {
                timeout: 10000,
                env: brewEnv,
            });
            this.emit('log', `Switched to context: ${contextName}`, 'info');
        } catch (err) {
            this.emit('log', `Failed to switch context: ${err}`, 'error');
            throw err;
        }
    }

    async getCurrentContext(): Promise<string | null> {
        try {
            const contexts = await this.listContexts();
            const current = contexts.find(c => c.current);
            return current?.name || null;
        } catch {
            return null;
        }
    }

    setup() {
        const plugins = [
            'buildx',
            'compose',
        ]
        plugins.forEach(plugin => (
            this._verify_symlinks(resolveBrewBinary('docker-' + plugin))
        ))
        return true;
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.emit('log', 'Connecting to Docker daemon...', 'info');
        this.firstPollDone = false;
        this.startStatsStreaming(stats => this.emit('container-stats', stats));
        void this._openEventStream();
    }

    stop() {
        this.running = false;
        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
        const events = this.eventStream;
        this.eventStream = null;
        if (events) {
            clearTimeout(events.retry);
            events.controller.abort();
            events.stream?.destroy();
        }
        this.containerRefresh?.controller.abort();
        this.containerRefresh = null;
        this.stopStatsStreaming();
        for (const id of this.logStreams.keys()) this.stopLogStream(id);
    }
}

export default Docker;
