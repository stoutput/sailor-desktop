import { ipcMain } from 'electron';
import Colima, {STATUS as COLIMA_STATUS, ColimaCreateOptions} from '../api/colima';
import Docker from '../api/docker';
import SettingsManager from './settings';
import { SailorSettings, ColimaSettings, DockerSettings, DependencyName } from '@common/types';
import { DEPENDENCY_VERSIONS } from '@common/versions';
import {
    checkDependencies,
    isSetupRequired,
    checkForConflicts,
    uninstallDockerDesktop,
    removeNonHomebrewBinary,
    installHomebrew,
    installWithBrew,
    upgradeWithBrew,
    getUntestedVersionNotifications
} from './dependencies';

interface LogEntry {
    timestamp: number;
    message: string;
    type: string;
}

const MAX_LOG_BUFFER = 100;

export default function postrender(renderer: Electron.WebContents) {
    const colima = new Colima()
    const docker = new Docker()
    const settings = new SettingsManager()
    let containersReady = false;
    let setupComplete = false;
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

    // Apply settings on startup
    settings.applyAllSettings();

    // Set active colima instance from settings
    const colimaSettings = settings.getColima();
    colima.setActiveInstance(colimaSettings.activeInstance);

    // Function to start the runtime (called after setup is complete)
    function startRuntime() {
        if (!setupComplete) return;
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

    // Internet connectivity check
    ipcMain.handle('check-internet-connection', async () => {
        try {
            const https = await import('https');
            return new Promise<boolean>((resolve) => {
                const req = https.default.request('https://brew.sh', { method: 'HEAD', timeout: 5000 }, (res) => {
                    resolve(res.statusCode !== undefined && res.statusCode < 500);
                });
                req.on('error', () => resolve(false));
                req.on('timeout', () => {
                    req.destroy();
                    resolve(false);
                });
                req.end();
            });
        } catch {
            return false;
        }
    });

    // Dependency management handlers
    ipcMain.handle('check-dependencies', async () => {
        return checkDependencies();
    });

    ipcMain.handle('is-setup-required', async () => {
        return isSetupRequired();
    });

    ipcMain.handle('install-dependency', async (_event, name: DependencyName, version?: 'recommended' | 'latest') => {
        const onProgress = (progress: { dependency: string; phase: string; message: string; error?: string }) => {
            renderer.send('install-progress', progress);
        };

        // Get the specific version to install based on user selection
        const getVersionToInstall = (depName: 'colima' | 'docker'): string | undefined => {
            if (version === 'recommended') {
                // Extract version number without 'v' prefix for brew extract
                return DEPENDENCY_VERSIONS[depName].recommended.replace(/^v/, '');
            }
            // 'latest' or undefined means install latest available
            return undefined;
        };

        if (name === 'homebrew') {
            await installHomebrew(onProgress);
        } else if (name === 'colima') {
            const versionToInstall = getVersionToInstall('colima');
            await installWithBrew('colima', 'Colima', onProgress, versionToInstall);
        } else if (name === 'docker') {
            const versionToInstall = getVersionToInstall('docker');
            await installWithBrew('docker', 'Docker CLI', onProgress, versionToInstall);
        }
    });

    ipcMain.handle('complete-setup', async () => {
        setupComplete = true;
        startRuntime();
    });

    // Conflict detection and resolution handlers
    ipcMain.handle('check-conflicts', () => {
        return checkForConflicts();
    });

    ipcMain.handle('uninstall-docker-desktop', async () => {
        return uninstallDockerDesktop();
    });

    ipcMain.handle('remove-non-homebrew-binary', async (_event, binaryPath: string, name: string) => {
        return removeNonHomebrewBinary(binaryPath, name);
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

    // Upgrade handler
    ipcMain.handle('upgrade-dependency', async (_event, name: DependencyName) => {
        const onProgress = (progress: { dependency: string; phase: string; message: string; error?: string }) => {
            renderer.send('install-progress', progress);
        };

        if (name === 'colima') {
            await upgradeWithBrew('colima', 'Colima', onProgress);
        } else if (name === 'docker') {
            await upgradeWithBrew('docker', 'Docker CLI', onProgress);
        }
    });

    // Check if setup is required on startup
    isSetupRequired().then((required) => {
        if (required) {
            // Notify renderer that setup is needed
            renderer.send('setup-required');
        } else {
            // All dependencies met, start normally
            setupComplete = true;
            startRuntime();
        }
    });
}