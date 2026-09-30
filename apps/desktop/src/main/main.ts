import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createApplicationContainer,
  type ApplicationContainer,
} from './application/composition-root';
import { loadRuntimeConfig } from './infrastructure/runtime-config';
import { createLifecycleManager, type LifecycleManager } from './infrastructure/lifecycle-manager';
import { resolveCaptureServicePath } from './infrastructure/native/native-service-path';
import { DesktopControls } from './infrastructure/desktop-controls';
import { ElectronDiagnosticsReport } from './infrastructure/electron-diagnostics-report';
import { StructuredFileLogger } from './infrastructure/logger';
import {
  runPackagedSmokeProbe,
  writePackagedSmokeReport,
} from './infrastructure/packaged-smoke-probe';
import { RegionSelectionManager } from './infrastructure/region-selection-manager';
import { createWindowEventPublisher } from './ipc/ipc-event-publisher';
import { registerIpcController } from './ipc/ipc-controller';
import { buildContentSecurityPolicy, isAllowedRendererUrl } from './security/security-policy';

const runtimeConfig = loadRuntimeConfig(process.env);
const packagedSmokeReportPath = process.env['SCREEN_RECORDER_PACKAGED_SMOKE_REPORT'];
const packagedSmokeUserData = process.env['SCREEN_RECORDER_PACKAGED_SMOKE_USER_DATA'];
if (packagedSmokeReportPath !== undefined && packagedSmokeUserData !== undefined) {
  // Isolate smoke-test state from a developer's real library and preferences.
  app.setPath('userData', packagedSmokeUserData);
}
let mainWindow: BrowserWindow | null = null;
let applicationContainer: ApplicationContainer | null = null;
let lifecycleManager: LifecycleManager | null = null;
let ipcControllerRegistered = false;
let shutdownRequested = false;
let regionSelectionManager: RegionSelectionManager | null = null;
let desktopControls: DesktopControls | null = null;
let applicationLogger: StructuredFileLogger | null = null;

function createMainWindow(): void {
  const packagedRendererRootUrl = pathToFileURL(path.join(__dirname, '../renderer/')).href;

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#10141e',
    ...(process.platform === 'darwin'
      ? {
          // Keep the native traffic lights visible while the renderer draws the inset title area.
          trafficLightPosition: { x: 16, y: 16 },
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const,
        }
      : {}),
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
    if (applicationLogger === null) throw new Error('Application logging is unavailable.');
    const logger = applicationLogger;
    const events = createWindowEventPublisher((channel, event) => {
      mainWindow?.webContents.send(channel, event);
    }, logger);
    regionSelectionManager = new RegionSelectionManager({
      preloadPath: path.join(__dirname, 'preload.js'),
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
      packagedRendererFile: path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    });
    desktopControls = new DesktopControls({
      getMainWindow: () => mainWindow,
      onWarning: (message) => logger.warn(message),
    });
    const diagnosticsReport = new ElectronDiagnosticsReport({ logger });
    applicationContainer = createApplicationContainer(
      events,
      {
        nativeServicePath: resolveCaptureServicePath({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          workingDirectory: process.cwd(),
          moduleDirectory: __dirname,
          architecture: process.arch,
          platform: process.platform,
        }),
        defaultOutputDirectory: () =>
          packagedSmokeUserData === undefined
            ? path.join(app.getPath('videos'), 'Screen Recorder')
            : path.join(packagedSmokeUserData, 'recordings'),
        libraryDatabasePath: path.join(app.getPath('userData'), 'library', 'recordings.sqlite3'),
        thumbnailCacheDirectory: path.join(app.getPath('userData'), 'library', 'thumbnails'),
        preferencesFilePath: path.join(app.getPath('userData'), 'preferences.json'),
        diagnosticsFilePath: path.join(app.getPath('userData'), 'diagnostics', 'recordings.json'),
        diagnosticsReport,
      },
      logger,
    );
    lifecycleManager = createLifecycleManager(async () => {
      logger.info('Application shutdown started.');
      desktopControls?.dispose();
      regionSelectionManager?.dispose();
      await applicationContainer?.dispose();
      logger.info('Application shutdown completed.');
      await logger.flush();
    });
    logger.info('Main window and application services were created.');
  }

  if (!ipcControllerRegistered && applicationContainer !== null) {
    registerIpcController(
      () => mainWindow,
      applicationContainer,
      regionSelectionManager ?? undefined,
      (preferences) => desktopControls?.update(preferences.shortcuts),
      async () => {
        await lifecycleManager?.shutdown();
        app.relaunch();
        app.exit(0);
      },
    );
    ipcControllerRegistered = true;
    void applicationContainer.useCases.getPreferences.execute().then((preferences) => {
      desktopControls?.register(preferences.shortcuts);
    });
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (packagedSmokeReportPath !== undefined) {
    mainWindow.webContents.once('did-finish-load', () => {
      const window = mainWindow;
      const container = applicationContainer;
      if (window === null || container === null) return;
      void runPackagedSmokeProbe({
        record: process.env['SCREEN_RECORDER_PACKAGED_SMOKE_RECORD'] !== '0',
        window,
        container,
      }).then(async (report) => {
        await writePackagedSmokeReport(packagedSmokeReportPath, report);
        await container.dispose();
        app.exit(
          report.error === undefined && (!report.recordingRequested || report.recordingCompleted)
            ? 0
            : 1,
        );
      });
    });
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
    applicationLogger = new StructuredFileLogger({
      directory: path.join(app.getPath('userData'), 'logs'),
      minimumLevel: runtimeConfig.logLevel,
      mirrorToConsole: !app.isPackaged,
    });
    applicationLogger.info('Application became ready.', {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: process.platform,
      architecture: process.arch,
    });
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
        applicationLogger?.error('Graceful shutdown failed.', { error });
      })
      .finally(() => app.quit());
  });
}
