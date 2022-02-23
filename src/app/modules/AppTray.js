const { Tray, Menu } = require('electron');
const path = require('path');

class AppTray {
  tray = null;
  window = null;

  constructor(window) {
    this.window = window
  }

  animateChain = () => {

  };

  getWindowPosition = () => {
    const windowBounds = this.window.getBounds();
    const trayBounds = this.tray.getBounds();
    const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    const y = Math.round(trayBounds.y + trayBounds.height);
    return { x, y };
  };

  showWindow = () => {
    if (!this.window.isVisible()) {
      this.window.show();
      this.window.setVisibleOnAllWorkspaces(true);
      this.window.focus();
      this.window.setVisibleOnAllWorkspaces(false);
    }
  };

  leftClickMenu = () => {
    return Menu.buildFromTemplate([
      {label: "Open Sailor", click: (item, window, event) => {
          this.showWindow();
      }},
      {type: "separator"},
      {label: "Quit Sailor", role: "quit", accelerator: 'Command+Q'},
    ]);
  }

  rightClickMenu = () => {
    const menu = [
      {
        role: 'quit',
        accelerator: 'Command+Q'
      }
    ];
    this.tray.popUpContextMenu(Menu.buildFromTemplate(menu));
  }

  create = () => {
    this.tray = new Tray(path.join(__dirname, '../../assets/Anchor2Template@2x.png'));
    this.tray.setIgnoreDoubleClickEvents(true);
    this.tray.setContextMenu(this.leftClickMenu());
    this.tray.on('right-click', this.rightClickMenu);
    return this;
  };
}

module.exports = AppTray;