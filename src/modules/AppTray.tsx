import { Tray, Menu, BrowserWindow, nativeImage } from 'electron';
import path from 'path';

export default class AppTray {
  tray: Tray
  window: BrowserWindow

  constructor(window: BrowserWindow) {
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
    const menu = Menu.buildFromTemplate([
      {label: "Quit Sailor", role: "quit", accelerator: 'Command+Q'},
    ]);
    this.tray.popUpContextMenu(menu);
  }

  create = () => {
    // Electron Tray requires PNG, not SVG. Use template image for macOS menu bar.
    const iconPath = path.resolve('assets/images/OffWhiteAnchor2Template@4x.png');
    const icon = nativeImage.createFromPath(iconPath);
    // Resize for menu bar (16x16 is standard, @2x for retina)
    const resized = icon.resize({ width: 18, height: 18 });
    resized.setTemplateImage(true);
    this.tray = new Tray(resized);
    this.tray.setIgnoreDoubleClickEvents(true);
    this.tray.setContextMenu(this.leftClickMenu());
    this.tray.on('right-click', this.rightClickMenu);
    return this;
  };
}