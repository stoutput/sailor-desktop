import { Tray, Menu, BrowserWindow, nativeImage } from 'electron';
import { assetPath } from '@main/assets';

/** macOS menu bar icons render at 16–22pt; 18 keeps the anchor legible. */
const MENU_BAR_ICON_SIZE = 18;

export default class AppTray {
  tray: Tray
  window: BrowserWindow

  constructor(window: BrowserWindow) {
    this.window = window
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  animateChain = () => {};

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
      {label: "Open Sailor", click: (_item, _window, _event) => {
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

  /**
   * Menu bar icon. The source art is transparent-backed, so flagging it as a
   * template image lets macOS tint it to match light/dark menu bars. Supplying
   * both @1x and @2x representations keeps it sharp on Retina displays.
   */
  createMenuBarIcon = () => {
    const iconPath = assetPath('images', 'OffWhiteAnchor2Template@4x.png');
    const source = nativeImage.createFromPath(iconPath);
    if (source.isEmpty()) {
      console.error(`Menu bar icon missing at ${iconPath}`);
      return source;
    }

    const icon = nativeImage.createEmpty();
    [1, 2].forEach(scaleFactor => {
      const size = MENU_BAR_ICON_SIZE * scaleFactor;
      icon.addRepresentation({
        scaleFactor,
        width: size,
        height: size,
        buffer: source.resize({ width: size, height: size, quality: 'best' }).toPNG(),
      });
    });
    icon.setTemplateImage(true);
    return icon;
  };

  create = () => {
    this.tray = new Tray(this.createMenuBarIcon());
    this.tray.setIgnoreDoubleClickEvents(true);
    this.tray.setContextMenu(this.leftClickMenu());
    this.tray.on('right-click', this.rightClickMenu);
    return this;
  };
}
