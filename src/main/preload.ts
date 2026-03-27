import { contextBridge, ipcRenderer } from 'electron';
import { ContainerData, ColimaStats, ContainerStats, AppSettings, SailorSettings, ColimaSettings, DockerSettings, ColimaInstance, DockerContext, DependencyCheckResult, DependencyName, ConflictInfo, UninstallResult, InstallProgress, DependencyNotification, NotificationSettings } from '@common/types';
import { ColimaCreateOptions } from '../api/colima';

export const API = {
    onUpdateStatus: (callback: (event: Electron.IpcRendererEvent, status: string) => void) => {
        ipcRenderer.on('update-status', callback)
        return () => {
            ipcRenderer.removeListener('update-status', callback);
        };
    },
    onContainersUpdate: (callback: (event: Electron.IpcRendererEvent, containers: ContainerData[]) => void) => {
        ipcRenderer.on('containers-update', callback)
        return () => {
            ipcRenderer.removeListener('containers-update', callback);
        };
    },
    onContainersReady: (callback: (event: Electron.IpcRendererEvent) => void) => {
        ipcRenderer.on('containers-ready', callback)
        return () => {
            ipcRenderer.removeListener('containers-ready', callback);
        };
    },
    getContainersReady: (): Promise<boolean> => {
        return ipcRenderer.invoke('get-containers-ready');
    },
    getBufferedLogs: (): Promise<{ timestamp: number; message: string; type: string }[]> => {
        return ipcRenderer.invoke('get-buffered-logs');
    },
    getCurrentStatus: (): Promise<string | null> => {
        return ipcRenderer.invoke('get-current-status');
    },
    onLogMessage: (callback: (event: Electron.IpcRendererEvent, message: string, type: string) => void) => {
        ipcRenderer.on('log-message', callback)
        return () => {
            ipcRenderer.removeListener('log-message', callback);
        };
    },
    getContainers: (): Promise<ContainerData[]> => {
        return ipcRenderer.invoke('get-containers');
    },
    startContainer: (id: string): Promise<ContainerData[]> => {
        return ipcRenderer.invoke('container-start', id);
    },
    stopContainer: (id: string): Promise<ContainerData[]> => {
        return ipcRenderer.invoke('container-stop', id);
    },
    startContainerLogs: (id: string): Promise<void> => {
        return ipcRenderer.invoke('container-logs-start', id);
    },
    stopContainerLogs: (id: string): Promise<void> => {
        return ipcRenderer.invoke('container-logs-stop', id);
    },
    onContainerLogLine: (callback: (event: Electron.IpcRendererEvent, containerId: string, line: string) => void) => {
        ipcRenderer.on('container-log-line', callback);
        return () => {
            ipcRenderer.removeListener('container-log-line', callback);
        };
    },
    getColimaStats: (): Promise<ColimaStats | null> => {
        return ipcRenderer.invoke('get-colima-stats');
    },
    startContainerStats: (): Promise<void> => {
        return ipcRenderer.invoke('container-stats-start');
    },
    stopContainerStats: (): Promise<void> => {
        return ipcRenderer.invoke('container-stats-stop');
    },
    onContainerStats: (callback: (event: Electron.IpcRendererEvent, stats: ContainerStats) => void) => {
        ipcRenderer.on('container-stats', callback);
        return () => {
            ipcRenderer.removeListener('container-stats', callback);
        };
    },
    // Shell session methods
    createShellSession: (containerId: string): Promise<string> => {
        return ipcRenderer.invoke('shell-create', containerId);
    },
    writeToShell: (containerId: string, data: string): Promise<boolean> => {
        return ipcRenderer.invoke('shell-write', containerId, data);
    },
    closeShellSession: (containerId: string): Promise<void> => {
        return ipcRenderer.invoke('shell-close', containerId);
    },
    onShellData: (callback: (event: Electron.IpcRendererEvent, containerId: string, data: string) => void) => {
        ipcRenderer.on('shell-data', callback);
        return () => {
            ipcRenderer.removeListener('shell-data', callback);
        };
    },
    onShellExit: (callback: (event: Electron.IpcRendererEvent, containerId: string, code: number | null) => void) => {
        ipcRenderer.on('shell-exit', callback);
        return () => {
            ipcRenderer.removeListener('shell-exit', callback);
        };
    },
    // Colima methods
    restartColima: (): Promise<void> => {
        return ipcRenderer.invoke('restart-colima');
    },
    isColimaRunning: (): Promise<boolean> => {
        return ipcRenderer.invoke('is-colima-running');
    },
    // Compose project methods
    getComposeProjects: (): Promise<{ name: string; containers: import('@common/types').ContainerData[] }[]> => {
        return ipcRenderer.invoke('get-compose-projects');
    },
    composeUp: (projectName: string): Promise<import('@common/types').ContainerData[]> => {
        return ipcRenderer.invoke('compose-up', projectName);
    },
    composeDown: (projectName: string): Promise<import('@common/types').ContainerData[]> => {
        return ipcRenderer.invoke('compose-down', projectName);
    },

    // Settings methods
    getSettings: (): Promise<AppSettings> => {
        return ipcRenderer.invoke('get-settings');
    },
    getSailorSettings: (): Promise<SailorSettings> => {
        return ipcRenderer.invoke('get-sailor-settings');
    },
    setSailorSettings: (settings: Partial<SailorSettings>): Promise<SailorSettings> => {
        return ipcRenderer.invoke('set-sailor-settings', settings);
    },
    getColimaSettings: (): Promise<ColimaSettings> => {
        return ipcRenderer.invoke('get-colima-settings');
    },
    setColimaSettings: (settings: Partial<ColimaSettings>): Promise<ColimaSettings> => {
        return ipcRenderer.invoke('set-colima-settings', settings);
    },
    getDockerSettings: (): Promise<DockerSettings> => {
        return ipcRenderer.invoke('get-docker-settings');
    },
    setDockerSettings: (settings: Partial<DockerSettings>): Promise<DockerSettings> => {
        return ipcRenderer.invoke('set-docker-settings', settings);
    },

    // Colima instance management
    getColimaInstances: (): Promise<ColimaInstance[]> => {
        return ipcRenderer.invoke('get-colima-instances');
    },
    createColimaInstance: (options: ColimaCreateOptions): Promise<void> => {
        return ipcRenderer.invoke('create-colima-instance', options);
    },
    editColimaInstance: (name: string, options: ColimaCreateOptions): Promise<void> => {
        return ipcRenderer.invoke('edit-colima-instance', name, options);
    },
    deleteColimaInstance: (name: string): Promise<void> => {
        return ipcRenderer.invoke('delete-colima-instance', name);
    },
    startColimaInstance: (name: string): Promise<void> => {
        return ipcRenderer.invoke('start-colima-instance', name);
    },
    stopColimaInstance: (name: string): Promise<void> => {
        return ipcRenderer.invoke('stop-colima-instance', name);
    },
    switchColimaInstance: (name: string): Promise<void> => {
        return ipcRenderer.invoke('switch-colima-instance', name);
    },

    // Docker context management
    getDockerContexts: (): Promise<DockerContext[]> => {
        return ipcRenderer.invoke('get-docker-contexts');
    },
    switchDockerContext: (name: string): Promise<void> => {
        return ipcRenderer.invoke('switch-docker-context', name);
    },

    // Dependency management
    checkInternetConnection: (): Promise<boolean> => {
        return ipcRenderer.invoke('check-internet-connection');
    },
    checkDependencies: (): Promise<DependencyCheckResult> => {
        return ipcRenderer.invoke('check-dependencies');
    },
    isSetupRequired: (): Promise<boolean> => {
        return ipcRenderer.invoke('is-setup-required');
    },
    installDependency: (name: DependencyName, version?: 'recommended' | 'latest'): Promise<void> => {
        return ipcRenderer.invoke('install-dependency', name, version);
    },
    upgradeDependency: (name: DependencyName): Promise<void> => {
        return ipcRenderer.invoke('upgrade-dependency', name);
    },
    onInstallProgress: (callback: (event: Electron.IpcRendererEvent, progress: InstallProgress) => void) => {
        ipcRenderer.on('install-progress', callback);
        return () => {
            ipcRenderer.removeListener('install-progress', callback);
        };
    },
    onSetupRequired: (callback: (event: Electron.IpcRendererEvent) => void) => {
        ipcRenderer.on('setup-required', callback);
        return () => {
            ipcRenderer.removeListener('setup-required', callback);
        };
    },
    completeSetup: (): Promise<void> => {
        return ipcRenderer.invoke('complete-setup');
    },

    // Conflict detection and resolution
    checkConflicts: (): Promise<ConflictInfo> => {
        return ipcRenderer.invoke('check-conflicts');
    },
    uninstallDockerDesktop: (): Promise<UninstallResult> => {
        return ipcRenderer.invoke('uninstall-docker-desktop');
    },
    removeNonHomebrewBinary: (binaryPath: string, name: string): Promise<UninstallResult> => {
        return ipcRenderer.invoke('remove-non-homebrew-binary', binaryPath, name);
    },

    // Notification management
    getUntestedVersionNotifications: (): Promise<DependencyNotification[]> => {
        return ipcRenderer.invoke('get-untested-notifications');
    },
    getNotificationSettings: (): Promise<NotificationSettings> => {
        return ipcRenderer.invoke('get-notification-settings');
    },
    acknowledgeNotification: (notificationId: string, version: string): Promise<NotificationSettings> => {
        return ipcRenderer.invoke('acknowledge-notification', notificationId, version);
    },
    isNotificationAcknowledged: (notificationId: string, currentVersion: string): Promise<boolean> => {
        return ipcRenderer.invoke('is-notification-acknowledged', notificationId, currentVersion);
    },
    onNotificationsUpdate: (callback: (event: Electron.IpcRendererEvent, notifications: DependencyNotification[]) => void) => {
        ipcRenderer.on('notifications-update', callback);
        return () => {
            ipcRenderer.removeListener('notifications-update', callback);
        };
    }
}

function attachIPCListeners() {
    contextBridge.exposeInMainWorld('api', API)
}

attachIPCListeners();
