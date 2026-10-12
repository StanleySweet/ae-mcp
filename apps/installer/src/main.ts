import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from './ipc.js';
import { createInstallerService } from './service.js';

const here = dirname(fileURLToPath(import.meta.url));

function registerIpc(): void {
  const service = createInstallerService({
    root: join(homedir(), '.ae-mcp'),
    payload: join(here, 'payload.jsx'),
    loader: join(here, 'loader.jsx'),
  });

  ipcMain.handle(IPC_CHANNELS.detect, () => service.detect());
  ipcMain.handle(IPC_CHANNELS.repair, (_event, install) => service.repair(install));
  ipcMain.handle(IPC_CHANNELS.uninstall, (_event, install) => service.uninstall(install));
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 720,
    height: 560,
    webPreferences: {
      preload: join(here, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void window.loadFile(join(here, '..', 'index.html'));
}

void app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
