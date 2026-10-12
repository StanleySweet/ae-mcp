import {
  detectEnvironment,
  repairAeMcp,
  uninstallAeMcp,
  type AEInstall,
  type DetectEnvironmentOptions,
  type RepairResult,
  type UninstallResult,
} from '@ae-mcp/core';
import type { InstallerApi } from './ipc.js';

export interface InstallerServiceOptions {
  /** Install root (i.e. `~/.ae-mcp`) where the bridge payload is written. */
  root: string;
  /** Bridge payload source (the built `payload.jsx`). */
  payload: string;
  /** Startup loader source (the built `loader.jsx`). */
  loader: string;
  environment?: DetectEnvironmentOptions;
  fileName?: string;
}

export type InstallerService = InstallerApi;

/**
 * Builds the installer service: the typed glue between IPC and `packages/core`.
 * Every method is idempotent and safe to call from the renderer.
 */
export function createInstallerService(options: InstallerServiceOptions): InstallerService {
  const resolve = async (install?: AEInstall): Promise<AEInstall | undefined> => {
    if (install) return install;
    const environment = await detectEnvironment(options.environment);
    return environment.afterEffects[0];
  };

  return {
    detect: () => detectEnvironment(options.environment),
    repair: async (install?: AEInstall): Promise<RepairResult> => {
      const resolved = await resolve(install);
      if (!resolved) {
        return {
          ok: false,
          checks: [
            {
              check: 'after_effects',
              status: 'fail',
              fix: 'Install After Effects, then reopen Setup.',
            },
          ],
        };
      }
      return repairAeMcp({
        root: options.root,
        install: resolved,
        payload: options.payload,
        loader: options.loader,
        fileName: options.fileName,
      });
    },
    uninstall: async (install?: AEInstall): Promise<UninstallResult> => {
      const resolved = await resolve(install);
      if (!resolved) {
        return {
          check: 'uninstall',
          status: 'fail',
          removed: [],
          fix: 'After Effects is not installed; nothing to remove.',
        };
      }
      return uninstallAeMcp({
        root: options.root,
        install: resolved,
        fileName: options.fileName,
      });
    },
  };
}
