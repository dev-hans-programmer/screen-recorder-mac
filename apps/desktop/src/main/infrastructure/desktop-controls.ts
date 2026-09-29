import { app, globalShortcut, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';
import {
  ipcChannels,
  type AppPreferencesDto,
  type ShortcutAction,
} from '@screen-recorder/contracts';

type ShortcutPreferences = AppPreferencesDto['shortcuts'];

interface DesktopControlsOptions {
  readonly getMainWindow: () => BrowserWindow | null;
  readonly onWarning?: (message: string) => void;
}

/** Coordinates global shortcuts and the menu-bar entry without exposing Electron APIs to React. */
export class DesktopControls {
  private readonly getMainWindow: () => BrowserWindow | null;

  private readonly onWarning: (message: string) => void;

  private tray: Tray | undefined;

  private registeredAccelerators = new Set<string>();

  public constructor(options: DesktopControlsOptions) {
    this.getMainWindow = options.getMainWindow;
    this.onWarning = options.onWarning ?? (() => undefined);
  }

  public register(shortcuts: ShortcutPreferences): void {
    this.unregisterShortcuts();
    this.registerShortcut(shortcuts.startStop, 'toggle-start-stop');
    this.registerShortcut(shortcuts.pauseResume, 'toggle-pause-resume');
    this.ensureTray();
  }

  public update(shortcuts: ShortcutPreferences): void {
    this.register(shortcuts);
  }

  public dispose(): void {
    this.unregisterShortcuts();
    if (this.tray !== undefined) {
      this.tray.destroy();
      this.tray = undefined;
    }
  }

  private registerShortcut(accelerator: string, action: ShortcutAction): void {
    if (this.registeredAccelerators.has(accelerator)) return;
    const registered = globalShortcut.register(accelerator, () => this.sendAction(action));
    if (!registered) {
      this.onWarning(`The shortcut ${accelerator} is unavailable and was not registered.`);
      return;
    }
    this.registeredAccelerators.add(accelerator);
  }

  private unregisterShortcuts(): void {
    for (const accelerator of this.registeredAccelerators) globalShortcut.unregister(accelerator);
    this.registeredAccelerators.clear();
  }

  private sendAction(action: ShortcutAction): void {
    this.getMainWindow()?.webContents.send(ipcChannels.shortcut, { action });
  }

  private ensureTray(): void {
    if (this.tray !== undefined) return;
    this.tray = new Tray(nativeImage.createEmpty());
    this.tray.setTitle('Capture');
    this.tray.setToolTip('Screen Recorder');
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Start / Stop Recording', click: () => this.sendAction('toggle-start-stop') },
        { label: 'Pause / Resume Recording', click: () => this.sendAction('toggle-pause-resume') },
        { type: 'separator' },
        {
          label: 'Show Capture',
          click: () => {
            const window = this.getMainWindow();
            if (window === null) return;
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
          },
        },
        { label: 'Quit Capture', click: () => process.nextTick(() => this.quit()) },
      ]),
    );
  }

  private quit(): void {
    app.quit();
  }
}
