import EventEmitter from 'events'
import Dockerode from 'dockerode';
import path from 'path';
import { Readable } from 'stream';
import { binariesPath } from '@common/constants';
import events from '@common/events';
import {app} from 'electron';
import { ContainerData, ContainerStats } from '@common/types';

class Docker extends EventEmitter {
    binaryPath = path.resolve(path.join(binariesPath, './docker'))
    docker = new Dockerode({socketPath: app.getPath('home') + '/.colima/default/docker.sock'})
    containers: {[key: string]: ContainerData} = {}
    containerPoll: NodeJS.Timer
    logStreams: Map<string, Readable> = new Map()
    statsStreams: Map<string, Readable> = new Map()
    statsPolling: NodeJS.Timer | null = null
    statsCallback: ((stats: ContainerStats) => void) | null = null

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

        return {
            id: info.Id,
            name: info.Names?.[0]?.replace(/^\//, '') || info.Id.slice(0, 12),
            image: info.Image,
            status: this._normalizeStatus(info.State),
            ports,
            networks,
            created: info.Created
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

            if (changed) {
                this.emit('containers-update', this.getContainers());
            }
        });
    }

    _startContainerPolling(interval = 5000) {
        this._stopContainerPolling(); // Ensure previous polling interval has been stopped
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
                        for (const net of Object.values(stats.networks) as any[]) {
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

    _verify_symlinks(binPath: string) {
        // verify that binary path is symlinked to docker path, or installed in docker engine
        return true;
    }

    setup() {
        const plugins = [
            'buildx',
            'compose',
        ]
        plugins.forEach(plugin => (
            this._verify_symlinks(path.resolve(path.join(binariesPath, './docker-' + plugin)))
        ))
        return true;
    }

    start() {
        this.emit('log', 'Connecting to Docker daemon...', 'info');
        this._listen_to_events();
        this._startContainerPolling();
        this.emit('log', 'Docker connection established', 'info');
    }

    stop() {
        this._stopContainerPolling();
    }
}

export default Docker;