import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createApplicationContainer,
  type ApplicationContainer,
} from './application/composition-root';
import { loadRuntimeConfig } from './infrastructure/runtime-config';
import { createLifecycleManager, type LifecycleManager } from './infrastructure/lifecycle-manager';
import { createWindowEventPublisher } from './ipc/ipc-event-publisher';
import { registerIpcController } from './ipc/ipc-controller';
import { buildContentSecurityPolicy, isAllowedRendererUrl } from './security/security-policy';

const runtimeConfig = loadRuntimeConfig(process.env);
let mainWindow: BrowserWindow | null = null;
let applicationContainer: ApplicationContainer | null = null;
let lifecycleManager: LifecycleManager | null = null;
let ipcControllerRegistered = false;
let shutdownRequested = false;

function createMainWindow(): void {
  const packagedRendererRootUrl = pathToFileURL(path.join(__dirname, '../renderer/')).href;

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    backgroundColor: '#0d1117',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererUrl(url, MAIN_WINDOW_VITE_DEV_SERVER_URL, packagedRendererRootUrl)) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  if (applicationContainer === null) {
    const events = createWindowEventPublisher((channel, event) => {
      mainWindow?.webContents.send(channel, event);
    });
    applicationContainer = createApplicationContainer(events);
    lifecycleManager = createLifecycleManager(
      () => applicationContainer?.dispose() ?? Promise.resolve(),
    );
  }

  if (!ipcControllerRegistered && applicationContainer !== null) {
    registerIpcController(() => mainWindow, applicationContainer);
    ipcControllerRegistered = true;
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (runtimeConfig.openDevTools) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app.whenReady().then(() => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            buildContentSecurityPolicy(MAIN_WINDOW_VITE_DEV_SERVER_URL !== undefined),
          ],
        },
      });
    });

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (shutdownRequested || lifecycleManager === null) {
      return;
    }

    event.preventDefault();
    shutdownRequested = true;
    void lifecycleManager
      .shutdown()
      .catch((error: unknown) => {
        console.error('[screen-recorder] graceful shutdown failed.', error);
      })
      .finally(() => app.quit());
  });
}
