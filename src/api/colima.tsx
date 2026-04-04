import EventEmitter from 'events'
import { resolveBrewBinary, brewEnv } from '@common/constants';
import { spawn, execSync, ChildProcess } from 'child_process';
import { ColimaStats, ColimaInstance } from '@common/types';

const STATUS = {
    COLIMA_START: 'Booting...',
    PROVISIONING: 'Provisioning...',
    DOCKER_START: 'Starting docker...',
    FINISHING: 'Finishing up...',
    READY: 'Ready',
    STOPPED: 'Stopped',
}

export interface ColimaCreateOptions {
    name?: string;
    cpu?: number;
    memory?: number;
    disk?: number;
    runtime?: 'docker' | 'containerd';
    arch?: 'x86_64' | 'aarch64' | 'host';
    vmType?: 'qemu' | 'vz';
    network?: boolean;
    kubernetes?: boolean;
    kubernetesVersion?: string;
    kubernetesDisableServices?: string[];
    mountType?: '9p' | 'sshfs' | 'virtiofs';
    mountINotify?: boolean;
    sshAgent?: boolean;
    dnsHosts?: Record<string, string>;
    envVariables?: Record<string, string>;
}

type LogType = 'info' | 'error' | 'status';

class Colima extends EventEmitter {
    binaryPath = resolveBrewBinary('colima');

    status = '';
    wasReady = false;
    activeInstance = 'default';
    private currentProcess: ChildProcess | null = null;

    _log(message: string, type: LogType = 'info') {
        this.emit('log', message, type);
    }

    _extractMessage(data: string): string {
        // Extract readable message from colima output
        const msgMatch = data.match(/msg="([^"]+)"/);
        if (msgMatch) return msgMatch[1];

        // Clean up the raw output
        return data.replace(/time="[^"]+"\s+level=\w+\s+/, '').trim();
    }

    _outputToStatus(data: string): string {
        const text = data.toLowerCase();

        // Output -> status mappings
        if (['starting', 'colima'].every(match => text.includes(match))) {
            return STATUS.COLIMA_START;
        }
        if (text.includes('provisioning')) {
            return STATUS.PROVISIONING;
        }
        if (['starting', 'docker'].every(match => text.includes(match))) {
            return STATUS.DOCKER_START;
        }
        if (text.includes('[ ok ]')) {
            return STATUS.FINISHING;
        }
        if (text.startsWith('done') || text.includes('msg=done') || text.includes('msg="done"')) {
            return STATUS.READY;
        }
        if (text.includes('already running')) {
            return STATUS.READY;
        }
        return this.status;
    }

    _handleOutput(data: Buffer) {
        const text = data.toString('utf8');
        const lines = text.split('\n').filter(line => line.trim());

        for (const line of lines) {
            // Log the readable message
            const message = this._extractMessage(line);
            if (message) {
                const isError = line.toLowerCase().includes('level=error');
                this._log(message, isError ? 'error' : 'info');
            }

            // Update status
            const newStatus = this._outputToStatus(line.toLowerCase());
            this._updateStatus(newStatus);
        }
    }

    _handleError(data: Buffer) {
        const text = data.toString('utf8').trim();
        if (text) {
            this._log(text, 'error');
        }
    }

    _updateStatus(newStatus: string) {
        if (newStatus && newStatus !== this.status) {
            this.status = newStatus;
            this.emit('status-update', this.status);
        }
    }

    getStats(): ColimaStats | null {
        try {
            const args = ['status', '-ej'];
            if (this.activeInstance !== 'default') {
                args.push('-p', this.activeInstance);
            }

            const output = execSync(`${this.binaryPath} ${args.join(' ')}`, {
                encoding: 'utf8',
                timeout: 5000,
                env: brewEnv,
            });
            const data = JSON.parse(output);
            return {
                cpu: data.cpus ?? data.cpu ?? 0,  // Lima uses "cpus", colima uses "cpu"
                memory: data.memory || 0,
                disk: data.disk || 0
            };
        } catch (err) {
            // If we were previously ready and stats now fail, colima has stopped
            if (this.wasReady) {
                this._log('Colima runtime unexpectedly stopped', 'error');
                this._updateStatus(STATUS.STOPPED);
                this.wasReady = false;
            }
            return null;
        }
    }

    isRunning(instanceName?: string): boolean {
        const instance = instanceName || this.activeInstance;
        try {
            const args = ['status'];
            if (instance !== 'default') {
                args.push('-p', instance);
            }

            const output = execSync(`${this.binaryPath} ${args.join(' ')}`, {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: brewEnv,
            });
            return output.toLowerCase().includes('running');
        } catch (err) {
            return false;
        }
    }

    setActiveInstance(instanceName: string) {
        this.activeInstance = instanceName;
    }

    getActiveInstance(): string {
        return this.activeInstance;
    }

    restart() {
        this._log('Restarting colima...', 'info');
        this.wasReady = false;
        this.start();
    }

    start(instanceName?: string) {
        const instance = instanceName || this.activeInstance;
        this._log(`Starting colima${instance !== 'default' ? ` (${instance})` : ''}...`, 'info');
        this._log(`Using binary: ${this.binaryPath}`, 'info');

        const args = ['start'];
        if (instance !== 'default') {
            args.push(instance);
        }

        this.currentProcess = spawn(this.binaryPath, args, { env: brewEnv });

        this.currentProcess.stdout?.on('data', (data) => this._handleOutput(data));
        this.currentProcess.stderr?.on('data', (data) => this._handleOutput(data));

        this.currentProcess.on('error', (err) => {
            this._log(`Failed to start colima: ${err.message}`, 'error');
            this._updateStatus('error');
        });

        this.currentProcess.on('exit', (code) => {
            this.currentProcess = null;
            if (code === 0) {
                this.wasReady = true;
            } else if (code !== null) {
                this._log(`Colima exited with code ${code}`, 'error');
                this._updateStatus('error');
            }
        });
    }

    async stop(instanceName?: string): Promise<void> {
        const instance = instanceName || this.activeInstance;
        this._log(`Stopping colima${instance !== 'default' ? ` (${instance})` : ''}...`, 'info');

        return new Promise((resolve, reject) => {
            const args = ['stop'];
            if (instance !== 'default') {
                args.push(instance);
            }

            const stopProcess = spawn(this.binaryPath, args, { env: brewEnv });

            stopProcess.on('exit', (code) => {
                if (code === 0) {
                    this._log('Colima stopped', 'info');
                    this._updateStatus(STATUS.STOPPED);
                    this.wasReady = false;
                    resolve();
                } else {
                    reject(new Error(`Colima stop failed with code ${code}`));
                }
            });

            stopProcess.on('error', reject);
        });
    }

    listInstances(): ColimaInstance[] {
        try {
            const output = execSync(`${this.binaryPath} list -j`, {
                encoding: 'utf8',
                timeout: 10000,
                env: brewEnv,
            });

            const lines = output.trim().split('\n').filter(line => line.trim());
            const instances: ColimaInstance[] = [];

            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    instances.push({
                        name: data.name || 'default',
                        cpu: data.cpu || 0,
                        memory: data.memory || 0,
                        disk: data.disk || 0,
                        runtime: data.runtime || 'docker',
                        arch: data.arch || 'host',
                        vmType: ((data.vmType || data.vm_type || 'qemu') as string).toLowerCase() as 'qemu' | 'vz',
                        network: data.network_address ? true : false,
                        kubernetes: data.kubernetes || false,
                        status: data.status === 'Running' ? 'Running' :
                               data.status === 'Stopped' ? 'Stopped' : 'Unknown'
                    });
                } catch {
                    // Skip malformed lines
                }
            }

            return instances;
        } catch (err) {
            this._log(`Failed to list instances: ${err}`, 'error');
            return [];
        }
    }

    async createInstance(options: ColimaCreateOptions): Promise<void> {
        const args = ['start'];

        if (options.name && options.name !== 'default') {
            args.push(options.name);
        }

        if (options.cpu) args.push('--cpu', options.cpu.toString());
        if (options.memory) args.push('--memory', options.memory.toString());
        if (options.disk) args.push('--disk', options.disk.toString());
        if (options.runtime) args.push('--runtime', options.runtime);
        if (options.arch) args.push('--arch', options.arch);
        if (options.vmType) args.push('--vm-type', options.vmType);
        if (options.network !== undefined) args.push('--network-address', options.network.toString());
        if (options.kubernetes) args.push('--kubernetes');
        if (options.kubernetesVersion) args.push('--kubernetes-version', options.kubernetesVersion);
        if (options.mountType) args.push('--mount-type', options.mountType);
        if (options.mountINotify) args.push('--mount-inotify');
        if (options.sshAgent) args.push('--ssh-agent');

        this._log(`Creating instance${options.name ? ` "${options.name}"` : ''}...`, 'info');

        return new Promise((resolve, reject) => {
            const createProcess = spawn(this.binaryPath, args, { env: brewEnv });

            createProcess.stdout?.on('data', (data) => this._handleOutput(data));
            createProcess.stderr?.on('data', (data) => this._handleOutput(data));

            createProcess.on('exit', (code) => {
                if (code === 0) {
                    this._log('Instance created successfully', 'info');
                    resolve();
                } else {
                    reject(new Error(`Failed to create instance (exit code ${code})`));
                }
            });

            createProcess.on('error', reject);
        });
    }

    async editInstance(instanceName: string, options: ColimaCreateOptions): Promise<void> {
        // Stop the instance first
        await this.stop(instanceName);

        // Start with new configuration
        const args = ['start'];

        if (instanceName !== 'default') {
            args.push(instanceName);
        }

        if (options.cpu) args.push('--cpu', options.cpu.toString());
        if (options.memory) args.push('--memory', options.memory.toString());
        if (options.disk) args.push('--disk', options.disk.toString());
        if (options.runtime) args.push('--runtime', options.runtime);
        if (options.vmType) args.push('--vm-type', options.vmType);

        this._log(`Restarting instance "${instanceName}" with new configuration...`, 'info');

        return new Promise((resolve, reject) => {
            const startProcess = spawn(this.binaryPath, args, { env: brewEnv });

            startProcess.stdout?.on('data', (data) => this._handleOutput(data));
            startProcess.stderr?.on('data', (data) => this._handleOutput(data));

            startProcess.on('exit', (code) => {
                if (code === 0) {
                    this._log('Instance updated successfully', 'info');
                    this.wasReady = true;
                    resolve();
                } else {
                    reject(new Error(`Failed to update instance (exit code ${code})`));
                }
            });

            startProcess.on('error', reject);
        });
    }

    async deleteInstance(instanceName: string): Promise<void> {
        if (instanceName === 'default') {
            throw new Error('Cannot delete the default instance');
        }

        this._log(`Deleting instance "${instanceName}"...`, 'info');

        return new Promise((resolve, reject) => {
            const deleteProcess = spawn(this.binaryPath, ['delete', instanceName, '-f'], { env: brewEnv });

            deleteProcess.on('exit', (code) => {
                if (code === 0) {
                    this._log('Instance deleted', 'info');
                    resolve();
                } else {
                    reject(new Error(`Failed to delete instance (exit code ${code})`));
                }
            });

            deleteProcess.on('error', reject);
        });
    }

    getInstanceStats(instanceName?: string): ColimaStats | null {
        const instance = instanceName || this.activeInstance;
        try {
            const args = ['status', '-ej'];
            if (instance !== 'default') {
                args.push('-p', instance);
            }

            const output = execSync(`${this.binaryPath} ${args.join(' ')}`, {
                encoding: 'utf8',
                timeout: 5000,
                env: brewEnv,
            });
            const data = JSON.parse(output);
            return {
                cpu: data.cpus ?? data.cpu ?? 0,  // Lima uses "cpus", colima uses "cpu"
                memory: data.memory || 0,
                disk: data.disk || 0
            };
        } catch (err) {
            return null;
        }
    }
}

export default Colima;
export { STATUS }
