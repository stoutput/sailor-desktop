import EventEmitter from 'events'
import Dockerode from 'dockerode';
import { Readable, Duplex } from 'stream';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { resolveBrewBinary, brewEnv } from '@common/constants';
import events from '@common/events';
import {app} from 'electron';
import { ContainerData, ContainerStats, DockerContext } from '@common/types';

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
    containerPoll: NodeJS.Timer
    firstPollDone = false
    logStreams: Map<string, Readable> = new Map()
    statsStreams: Map<string, Readable> = new Map()
    statsPolling: NodeJS.Timer | null = null
    statsCallback: ((stats: ContainerStats) => void) | null = null
    shellSessions: Map<string, ShellSession> = new Map()

    constructor(instanceName = 'default') {
        super();
        this.activeInstance = instanceName;
        this.docker = new Dockerode({
            socketPath: `${app.getPath('home')}/.colima/${instanceName}/docker.sock`
        });
    }

    _listen_to_events() {
        events.on('minimize', () => {
            // No need to update containers when window is minimized
            this._stopContainerPolling();
        });
        events.on('restore', () => {
            // When restored, immediately refresh containers
            this._pollContainers();
            // Then restart conatiner polling
            this._startContainerPolling();
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

    _pollContainers() {
        // List all containers including stopped ones
        this.docker.listContainers({ all: true }, (err, containerList: Array<Dockerode.ContainerInfo>) => {
            if (err || !containerList) return;

            const containerIds = new Set<string>();
            let changed = false;

            containerList.forEach((containerInfo) => {
                const containerData = this._containerInfoToData(containerInfo);
                containerIds.add(containerData.id);

                // Check if container is new or changed
                const existing = this.containers[containerData.id];
                if (!existing || existing.status !== containerData.status) {
                    this.containers[containerData.id] = containerData;
                    changed = true;
                }
            });

            // Remove containers that are no longer present
            for (const id in this.containers) {
                if (!containerIds.has(id)) {
                    delete this.containers[id];
                    changed = true;
                }
            }

            // Always emit after first successful poll so containers-ready fires
            // even when no containers exist yet
            if (changed || !this.firstPollDone) {
                this.firstPollDone = true;
                this.emit('containers-update', this.getContainers());
            }
        });
    }

    _startContainerPolling(interval = 5000) {
        this._stopContainerPolling(); // Ensure previous polling interval has been stopped
        this._pollContainers(); // Poll immediately on start
        this.containerPoll = setInterval(() => this._pollContainers(), interval)
    }

    _stopContainerPolling() {
        if (this.containerPoll !== null) {
            clearInterval(this.containerPoll)
            this.containerPoll = null
        }
    }

    getContainers(): ContainerData[] {
        return Object.values(this.containers);
    }

    async startContainer(containerId: string): Promise<void> {
        this.emit('log', `Starting container ${containerId.slice(0, 12)}...`, 'info');
        const container = this.docker.getContainer(containerId);
        await container.start();
        this.emit('log', `Container started`, 'info');
        this._pollContainers(); // Refresh immediately
    }

    async stopContainer(containerId: string): Promise<void> {
        this.emit('log', `Stopping container ${containerId.slice(0, 12)}...`, 'info');
        const container = this.docker.getContainer(containerId);
        await container.stop();
        this.emit('log', `Container stopped`, 'info');
        this._pollContainers(); // Refresh immediately
    }

    async startLogStream(containerId: string, onLog: (line: string) => void): Promise<void> {
        // Stop existing stream if any
        this.stopLogStream(containerId);

        const container = this.docker.getContainer(containerId);

        try {
            const stream = await container.logs({
                follow: true,
                stdout: true,
                stderr: true,
                tail: 100, // Get last 100 lines initially
                timestamps: true
            }) as Readable;

            this.logStreams.set(containerId, stream);

            let buffer = '';
            stream.on('data', (chunk: Buffer) => {
                // Docker multiplexes stdout/stderr with an 8-byte header
                // We need to parse this to get clean log lines
                const data = chunk.toString('utf8');
                buffer += data;

                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.trim()) {
                        // Remove Docker stream header (first 8 bytes if present)
                        const cleanLine = line.length > 8 ? line.slice(8) : line;
                        onLog(cleanLine);
                    }
                }
            });

            stream.on('end', () => {
                this.logStreams.delete(containerId);
            });

            stream.on('error', (err) => {
                console.error('Log stream error:', err);
                this.logStreams.delete(containerId);
            });
        } catch (err) {
            console.error('Failed to start log stream:', err);
        }
    }

    stopLogStream(containerId: string): void {
        const stream = this.logStreams.get(containerId);
        if (stream) {
            stream.destroy();
            this.logStreams.delete(containerId);
        }
    }

    async startStatsStreaming(onStats: (stats: ContainerStats) => void): Promise<void> {
        this.stopStatsStreaming();
        this.statsCallback = onStats;

        const pollStats = async () => {
            const runningContainers = Object.values(this.containers).filter(c => c.status === 'running');

            for (const container of runningContainers) {
                try {
                    const dockerContainer = this.docker.getContainer(container.id);
                    const stats = await dockerContainer.stats({ stream: false });

                    // Calculate CPU percentage
                    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
                    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
                    const cpuCount = stats.cpu_stats.online_cpus || 1;
                    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

                    // Calculate memory
                    const memUsage = stats.memory_stats.usage || 0;
                    const memLimit = stats.memory_stats.limit || 1;

                    // Calculate network I/O
                    let networkRx = 0;
                    let networkTx = 0;
                    if (stats.networks) {
                        for (const net of Object.values(stats.networks) as { rx_bytes: number; tx_bytes: number }[]) {
                            networkRx += net.rx_bytes || 0;
                            networkTx += net.tx_bytes || 0;
                        }
                    }

                    if (this.statsCallback) {
                        this.statsCallback({
                            containerId: container.id,
                            timestamp: Date.now(),
                            cpu: cpuPercent,
                            memory: memUsage,
                            memoryLimit: memLimit,
                            networkRx,
                            networkTx
                        });
                    }
                } catch (err) {
                    // Container may have stopped
                }
            }
        };

        // Poll immediately, then every 2 seconds
        await pollStats();
        this.statsPolling = setInterval(pollStats, 2000);
    }

    stopStatsStreaming(): void {
        if (this.statsPolling) {
            clearInterval(this.statsPolling);
            this.statsPolling = null;
        }
        this.statsCallback = null;
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

        // Start all stopped containers in the project
        this.emit('log', `Starting compose project: ${projectName}`, 'info');

        for (const container of projectContainers) {
            if (container.status === 'exited' || container.status === 'created') {
                try {
                    await this.startContainer(container.id);
                } catch (err) {
                    this.emit('log', `Failed to start ${container.name}: ${err}`, 'error');
                }
            }
        }

        this.emit('log', `Compose project ${projectName} started`, 'info');
        this._pollContainers();
    }

    async composeDown(projectName: string): Promise<void> {
        const projectContainers = Object.values(this.containers).filter(
            c => c.composeProject === projectName
        );

        if (projectContainers.length === 0) {
            throw new Error(`No containers found for project: ${projectName}`);
        }

        this.emit('log', `Stopping compose project: ${projectName}`, 'info');

        for (const container of projectContainers) {
            if (container.status === 'running' || container.status === 'paused') {
                try {
                    await this.stopContainer(container.id);
                } catch (err) {
                    this.emit('log', `Failed to stop ${container.name}: ${err}`, 'error');
                }
            }
        }

        this.emit('log', `Compose project ${projectName} stopped`, 'info');
        this._pollContainers();
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
        this.emit('log', 'Connecting to Docker daemon...', 'info');
        this.firstPollDone = false;
        this._listen_to_events();
        this._startContainerPolling();
        this.emit('log', 'Docker connection established', 'info');
    }

    stop() {
        this._stopContainerPolling();
    }
}

export default Docker;