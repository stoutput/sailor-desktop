import EventEmitter from 'events'
import Dockerode from 'dockerode';
import path from 'path';
import { binariesPath } from '@common/constants';
import events from '@common/events';
import {app} from 'electron';

class Docker extends EventEmitter {
    binaryPath = path.resolve(path.join(binariesPath, './docker'))
    docker = new Dockerode({socketPath: app.getPath('home') + '/.colima/default/docker.sock'})
    containers: {[key: string]: {status: string, data: Dockerode.Container}}
    containerPoll: NodeJS.Timer

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

    _pollContainers() {
        this.docker.listContainers((err, containerList: Array<Dockerode.ContainerInfo>) => {
            const containerIds = new Set();
            containerList.forEach((containerInfo) => {
                this._updateContainerStatus(containerInfo.Id, containerInfo.State);
                containerIds.add(containerInfo.Id);
            });
            // Remove containers that are no longer present in containerList
            for (var id in this.containers) {
                if (!containerIds.has(id)) {
                    delete(this.containers[id])
                    this.emit('container-change')
                }
            }
        });
    }

    _startContainerPolling(interval: number = 5000) {
        this._stopContainerPolling(); // Ensure previous polling interval has been stopped
        this.containerPoll = setInterval(this._pollContainers, interval)
    }

    _stopContainerPolling() {
        if (this.containerPoll !== null) {
            clearInterval(this.containerPoll)
            this.containerPoll = null
        }
    }

    _updateContainerStatus(containerId: string, status: string) {
        if (typeof this.containers[containerId] === 'undefined' || this.containers[containerId].status !== status) {
            // Our container statuses can be in one of four states: 'created', 'paused', 'booting', or 'running'
            const lowerStatus = status.toLowerCase()
            switch (lowerStatus) {
                case 'created':
                case 'paused':
                case 'running':
                    status = lowerStatus
                    break;
                default:
                    status = 'booting'
            }
            this.containers[containerId] = {
                status: status,
                data: this.docker.getContainer(containerId)
            }
            this.emit('container-change', status, this.containers[containerId].data)
        }
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
        this._listen_to_events();
        this._startContainerPolling();
    }

    stop() {
        this._stopContainerPolling();
    }
}

export default Docker;