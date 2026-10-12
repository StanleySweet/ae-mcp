import type { InstallerApi } from './ipc.js';

declare global {
  interface Window {
    /** Typed bridge exposed by `preload.ts`. */
    installer: InstallerApi;
  }
}

export {};
