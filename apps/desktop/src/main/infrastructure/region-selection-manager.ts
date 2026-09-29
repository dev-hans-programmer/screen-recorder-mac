import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type WebContents } from 'electron';
import {
  ipcChannels,
  regionSelectionMessageSchema,
  type CaptureRegionDto,
} from '@screen-recorder/contracts';

interface RegionSelectionManagerOptions {
  readonly preloadPath: string;
  readonly devServerUrl: string | undefined;
  readonly packagedRendererFile: string;
}

interface PendingSelection {
  readonly window: BrowserWindow;
  readonly promise: Promise<CaptureRegionDto | null>;
  readonly resolve: (region: CaptureRegionDto | null) => void;
}

/**
 * Owns the short-lived, transparent region picker window. The picker only returns geometry;
 * video frames never enter this process or the renderer IPC boundary.
 */
export class RegionSelectionManager {
  private pending: PendingSelection | undefined;

  private listenerRegistered = false;

  private readonly handleMessage = (event: IpcMainEvent, rawPayload: unknown): void => {
    if (!this.isOverlayWindow(event.sender)) return;
    const payload = regionSelectionMessageSchema.safeParse(rawPayload);
    if (!payload.success) {
      this.finish(null);
      return;
    }
    this.finish(payload.data.type === 'selected' ? payload.data.region : null);
  };

  public constructor(private readonly options: RegionSelectionManagerOptions) {
    this.registerMessageListener();
  }

  public isOverlayWindow(sender: WebContents): boolean {
    return this.pending?.window.webContents === sender;
  }

  public open(displayId: string): Promise<CaptureRegionDto | null> {
    if (this.pending !== undefined) {
      // A second request shares the active picker rather than creating competing overlays.
      return this.pending.promise;
    }

    const display = this.findDisplay(displayId);
    const query = {
      window: 'region-selector',
      displayId,
      scaleFactor: String(display.scaleFactor),
    };

    let resolveSelection: (region: CaptureRegionDto | null) => void = () => undefined;
    const promise = new Promise<CaptureRegionDto | null>((resolve) => {
      resolveSelection = resolve;
    });

    const selectionWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      show: false,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        preload: this.options.preloadPath,
      },
    });

    this.pending = { window: selectionWindow, promise, resolve: resolveSelection };
    selectionWindow.setAlwaysOnTop(true, 'floating');
    selectionWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    selectionWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    selectionWindow.once('ready-to-show', () => {
      if (!selectionWindow.isDestroyed()) selectionWindow.show();
    });
    selectionWindow.once('closed', () => {
      if (this.pending?.window === selectionWindow) {
        this.finish(null);
      }
    });

    if (this.options.devServerUrl !== undefined) {
      const url = new URL(this.options.devServerUrl);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      void selectionWindow.loadURL(url.toString()).catch(() => this.finish(null));
    } else {
      void selectionWindow
        .loadFile(this.options.packagedRendererFile, { query })
        .catch(() => this.finish(null));
    }

    return promise;
  }

  public dispose(): void {
    if (this.pending !== undefined) this.finish(null);
    if (this.listenerRegistered) {
      ipcMain.removeListener(ipcChannels.regionSelection, this.handleMessage);
      this.listenerRegistered = false;
    }
  }

  private findDisplay(displayId: string) {
    const numericId = Number(displayId.replace(/^display:/, ''));
    const display = screen.getAllDisplays().find((candidate) => candidate.id === numericId);
    if (display === undefined) {
      throw new Error('The display selected for region capture is no longer available.');
    }
    return display;
  }

  private registerMessageListener(): void {
    if (this.listenerRegistered) return;
    this.listenerRegistered = true;
    ipcMain.on(ipcChannels.regionSelection, this.handleMessage);
  }

  private finish(region: CaptureRegionDto | null): void {
    const current = this.pending;
    if (current === undefined) return;
    this.pending = undefined;
    current.resolve(region);
    if (!current.window.isDestroyed()) current.window.close();
  }
}
