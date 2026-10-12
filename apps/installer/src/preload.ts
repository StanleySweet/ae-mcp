import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type InstallerApi } from './ipc.js';

const api: InstallerApi = {
  detect: () => ipcRenderer.invoke(IPC_CHANNELS.detect),
  repair: (install) => ipcRenderer.invoke(IPC_CHANNELS.repair, install),
  uninstall: (install) => ipcRenderer.invoke(IPC_CHANNELS.uninstall, install),
};

contextBridge.exposeInMainWorld('installer', api);
