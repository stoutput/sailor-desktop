import { ipcMain } from 'electron';
import Colima, {STATUS as COLIMA_STATUS} from '../api/colima';
import Docker from '../api/docker';

export default function postrender(renderer: Electron.WebContents) {
    const colima = new Colima()
    const docker = new Docker()

    // Attach event handlers
    colima.on('status-update', (status) => {
        if (status == COLIMA_STATUS.READY) {
            docker.start()
        } else {
            docker.stop()
        }
        renderer.send('update-status', status);
    })

    colima.on('log', (message: string, type: string) => {
        renderer.send('log-message', message, type);
    })

    docker.on('containers-update', (containers) => {
        renderer.send('containers-update', containers);
    })

    docker.on('log', (message: string, type: string) => {
        renderer.send('log-message', message, type);
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

    colima.start()

    // TODO: make setup a stored state, only run once
    docker.setup()
}