import { contextBridge, ipcRenderer } from 'electron';
import { ContainerData, ColimaStats, ContainerStats } from '@common/types';

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
    }
}

function attachIPCListeners() {
    contextBridge.exposeInMainWorld('api', API)
}

attachIPCListeners();
