import { contextBridge } from 'electron';

// Keep this bridge intentionally small until the typed application IPC contract is added.
// Renderer code must never receive ipcRenderer or arbitrary native capabilities.
contextBridge.exposeInMainWorld('screenRecorderFoundation', {
  ready: true,
});
