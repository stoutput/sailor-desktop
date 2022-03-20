const EventEmitter = require('events').EventEmitter
const path = require('path');
const { binariesPath } = require('../constants');
const { spawn } = require('child_process');

const STATUS = {
    COLIMA_START: 'Booting...',
    PROVISIONING: 'Provisioning...',
    DOCKER_START: 'Starting docker...',
    FINISHING: 'Finishing up...',
    READY: 'Ready',
}

class Colima extends EventEmitter {
    binaryPath = path.resolve(path.join(binariesPath, './colima'));

    status = '';

    _outputToStatus(data) {
        // Converts colima output data to status
        let text = data.toString('utf8').toLowerCase()
        // Use msg if present
        const arr = text.split("msg=");
        if (arr.length > 1) {
            text = arr[1].split('"')?.[1] || arr[1]
        }
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
        return this.status;
    }

    _handleOutput(data) {
        this._updateStatus(this._outputToStatus(data))
    }

    _handleErrors(data) {
        this._updateStatus(data.toString('utf8'))
    }

    _updateStatus(newStatus) {
        if (newStatus != this.status) {
            this.status = newStatus
            this.emit('status-update', this.status)
        }
    }

    start() {
        const colimaStart = spawn(this.binaryPath, ['start'])
        colimaStart.stdout.on('data', (data) => this._handleOutput(data));
        colimaStart.stderr.on('data', (data) => this._handleOutput(data));
        colimaStart.on('exit', function (code, signal) {
            code === 0 || this._updateStatus('error')
        });
    }
}

module.exports = Colima