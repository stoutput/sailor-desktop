const Colima = require('./utils/cli/colima')

module.exports.postrender = (renderer) => {
    colima = new Colima()
    colima.start()
    colima.on('status-update', (status) => {
        renderer.send('update-status', status);
    })
}