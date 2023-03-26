import Colima, {STATUS as COLIMA_STATUS} from './modules/colima';
import Docker from './modules/docker';

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

    docker.on('container-change', (status, container) => {
        renderer.send('container-change', status, container);
    })

    colima.start()
    
    // TODO: make setup a stored state, only run once
    docker.setup()
};