import { contextBridge, ipcRenderer } from 'electron';

import { createScreenRecorderApi } from './api';

// Only purpose-built methods cross this boundary; ipcRenderer itself never reaches the renderer.
contextBridge.exposeInMainWorld('screenRecorder', createScreenRecorderApi(ipcRenderer));
