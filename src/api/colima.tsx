import EventEmitter from 'events'
import path from 'path';
import { binariesPath } from '@common/constants';
import { spawn, execSync } from 'child_process';
import { ColimaStats } from '@common/types';

const STATUS = {
    COLIMA_START: 'Booting...',
    PROVISIONING: 'Provisioning...',
    DOCKER_START: 'Starting docker...',
    FINISHING: 'Finishing up...',
    READY: 'Ready',
}

type LogType = 'info' | 'error' | 'status';

class Colima extends EventEmitter {
    binaryPath = path.resolve(path.join(binariesPath, './colima'));

    status = '';

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
        if (text.startsWith('done')) {
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
            const output = execSync(`${this.binaryPath} status -ej`, {
                encoding: 'utf8',
                timeout: 5000
            });
            const data = JSON.parse(output);
            return {
                cpu: data.cpu || 0,
                memory: data.memory || 0,
                disk: data.disk || 0
            };
        } catch (err) {
            return null;
        }
    }

    start() {
        this._log('Starting colima...', 'info');

        const colimaStart = spawn(this.binaryPath, ['start']);

        colimaStart.stdout.on('data', (data) => this._handleOutput(data));
        colimaStart.stderr.on('data', (data) => this._handleOutput(data));

        colimaStart.on('error', (err) => {
            this._log(`Failed to start colima: ${err.message}`, 'error');
            this._updateStatus('error');
        });

        colimaStart.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                this._log(`Colima exited with code ${code}`, 'error');
                this._updateStatus('error');
            }
        });
    }
}

export default Colima;
export { STATUS }