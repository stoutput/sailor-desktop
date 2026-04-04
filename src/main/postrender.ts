import { ipcMain } from 'electron';
import Colima, {STATUS as COLIMA_STATUS, ColimaCreateOptions} from '../api/colima';
import Docker from '../api/docker';
import SettingsManager from './settings';
import { SailorSettings, ColimaSettings, DockerSettings } from '@common/types';
import {
    checkDependencies,
    checkForConflicts,
    getUntestedVersionNotifications
} from './dependencies';
import { ensureDockerCliPlugins } from './dockerConfig';

interface LogEntry {
    timestamp: number;
    message: string;
    type: string;
}

const MAX_LOG_BUFFER = 100;

export default function postrender(renderer: Electron.WebContents) {
    const settings = new SettingsManager()
    const colimaSettings = settings.getColima();
    const colima = new Colima()
    const docker = new Docker(colimaSettings.activeInstance)
    let containersReady = false;
    let currentStatus: string | null = null;
    const logBuffer: LogEntry[] = [];

    // Helper to buffer and send logs
    function emitLog(message: string, type: string) {
        const entry = { timestamp: Date.now(), message, type };
        logBuffer.push(entry);
        if (logBuffer.length > MAX_LOG_BUFFER) {
            logBuffer.shift();
        }
        renderer.send('log-message', message, type);
    }

    // Ensure Homebrew docker CLI plugins (buildx, compose) are on Docker's search path
    ensureDockerCliPlugins();

    // Apply settings on startup
    settings.applyAllSettings();

    // Set active colima instance from settings
    colima.setActiveInstance(colimaSettings.activeInstance);

    function startRuntime() {
        colima.start();
        docker.setup();
    }

    // Attach event handlers
    colima.on('status-update', (status) => {
        currentStatus = status;
        if (status == COLIMA_STATUS.READY) {
            docker.start()
        } else {
            docker.stop()
        }
        renderer.send('update-status', status);
    })

    colima.on('log', (message: string, type: string) => {
        emitLog(message, type);
    })

    docker.on('containers-update', (containers) => {
        if (!containersReady) {
            containersReady = true;
            emitLog('Containers loaded', 'info');
            renderer.send('containers-ready');
        }
        renderer.send('containers-update', containers);
    })

    ipcMain.handle('get-containers-ready', () => {
        return containersReady;
    });

    ipcMain.handle('get-buffered-logs', () => {
        return logBuffer;
    });

    ipcMain.handle('get-current-status', () => {
        return currentStatus;
    });

    docker.on('log', (message: string, type: string) => {
        emitLog(message, type);
    })

    // IPC handlers for container actions
    ipcMain.handle('get-containers', () => {
        return docker.getContainers();
    });

    ipcMain.handle('container-start', async (_event, containerId: string) => {
        await docker.startContainer(containerId);
        return docker.getContainers();
    });

    ipcMain.handle('container-stop', async (_event, containerId: string) => {
        await docker.stopContainer(containerId);
        return docker.getContainers();
    });

    // Container log streaming
    ipcMain.handle('container-logs-start', async (_event, containerId: string) => {
        await docker.startLogStream(containerId, (line: string) => {
            renderer.send('container-log-line', containerId, line);
        });
    });

    ipcMain.handle('container-logs-stop', (_event, containerId: string) => {
        docker.stopLogStream(containerId);
    });

    // Colima stats
    ipcMain.handle('get-colima-stats', () => {
        return colima.getStats();
    });

    // Container stats streaming
    ipcMain.handle('container-stats-start', async () => {
        await docker.startStatsStreaming((stats) => {
            renderer.send('container-stats', stats);
        });
    });

    ipcMain.handle('container-stats-stop', () => {
        docker.stopStatsStreaming();
    });

    // Shell session handlers
    ipcMain.handle('shell-create', (_event, containerId: string) => {
        return docker.createShellSession(
            containerId,
            (data: string) => {
                renderer.send('shell-data', containerId, data);
            },
            (code: number | null) => {
                renderer.send('shell-exit', containerId, code);
            }
        );
    });

    ipcMain.handle('shell-write', (_event, containerId: string, data: string) => {
        return docker.writeToShell(containerId, data);
    });

    ipcMain.handle('shell-close', (_event, containerId: string) => {
        docker.closeShellSession(containerId);
    });

    // Colima handlers
    ipcMain.handle('restart-colima', () => {
        colima.restart();
    });

    ipcMain.handle('is-colima-running', () => {
        return colima.isRunning();
    });

    // Compose project handlers
    ipcMain.handle('get-compose-projects', () => {
        return docker.getComposeProjects();
    });

    ipcMain.handle('compose-up', async (_event, projectName: string) => {
        await docker.composeUp(projectName);
        return docker.getContainers();
    });

    ipcMain.handle('compose-down', async (_event, projectName: string) => {
        await docker.composeDown(projectName);
        return docker.getContainers();
    });

    // Settings handlers
    ipcMain.handle('get-settings', () => {
        return settings.getAll();
    });

    ipcMain.handle('get-sailor-settings', () => {
        return settings.getSailor();
    });

    ipcMain.handle('set-sailor-settings', (_event, newSettings: Partial<SailorSettings>) => {
        return settings.setSailor(newSettings);
    });

    ipcMain.handle('get-colima-settings', () => {
        return settings.getColima();
    });

    ipcMain.handle('set-colima-settings', (_event, newSettings: Partial<ColimaSettings>) => {
        const updated = settings.setColima(newSettings);
        if (newSettings.activeInstance) {
            colima.setActiveInstance(newSettings.activeInstance);
        }
        return updated;
    });

    ipcMain.handle('get-docker-settings', () => {
        return settings.getDocker();
    });

    ipcMain.handle('set-docker-settings', (_event, newSettings: Partial<DockerSettings>) => {
        return settings.setDocker(newSettings);
    });

    // Colima instance management
    ipcMain.handle('get-colima-instances', () => {
        return colima.listInstances();
    });

    ipcMain.handle('create-colima-instance', async (_event, options: ColimaCreateOptions) => {
        await colima.createInstance(options);
    });

    ipcMain.handle('edit-colima-instance', async (_event, name: string, options: ColimaCreateOptions) => {
        await colima.editInstance(name, options);
    });

    ipcMain.handle('delete-colima-instance', async (_event, name: string) => {
        await colima.deleteInstance(name);
    });

    ipcMain.handle('start-colima-instance', async (_event, name: string) => {
        colima.start(name);
    });

    ipcMain.handle('stop-colima-instance', async (_event, name: string) => {
        await colima.stop(name);
    });

    ipcMain.handle('switch-colima-instance', async (_event, name: string) => {
        colima.setActiveInstance(name);
        settings.setColima({ activeInstance: name });
        // If the instance isn't running, start it
        if (!colima.isRunning(name)) {
            colima.start(name);
        }
    });

    // Docker context management
    ipcMain.handle('get-docker-contexts', () => {
        return docker.listContexts();
    });

    ipcMain.handle('switch-docker-context', async (_event, name: string) => {
        await docker.switchContext(name);
        settings.setDocker({ activeContext: name });
    });

    // Dependency management handlers
    ipcMain.handle('check-dependencies', async () => {
        return checkDependencies();
    });

    // Conflict detection handler
    ipcMain.handle('check-conflicts', () => {
        return checkForConflicts();
    });

    // Notification management handlers
    ipcMain.handle('get-untested-notifications', async () => {
        const deps = await checkDependencies();
        return getUntestedVersionNotifications(deps);
    });

    ipcMain.handle('get-notification-settings', () => {
        return settings.getNotifications();
    });

    ipcMain.handle('acknowledge-notification', (_event, notificationId: string, version: string) => {
        return settings.acknowledgeNotification(notificationId, version);
    });

    ipcMain.handle('is-notification-acknowledged', (_event, notificationId: string, currentVersion: string) => {
        return settings.isNotificationAcknowledged(notificationId, currentVersion);
    });

    startRuntime();
}