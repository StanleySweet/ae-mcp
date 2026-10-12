import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AEInstall } from './ae-discovery.js';
import { LOADER_FILE_NAME, installLoader, loaderStartupDir } from './install-loader.js';
import { installPayload, type InstallerCheck } from './install-payload.js';

export interface RepairOptions {
  root: string;
  install: AEInstall;
  payload: string;
  loader: string;
  fileName?: string;
}

export interface RepairResult {
  ok: boolean;
  checks: InstallerCheck[];
}

/**
 * Repairs an install by re-running the bridge install steps. Every step is
 * idempotent, so this is also the first-install path.
 */
export async function repairAeMcp(options: RepairOptions): Promise<RepairResult> {
  const payload = await installPayload({ root: options.root, payload: options.payload });
  const loader = await installLoader({
    install: options.install,
    loader: options.loader,
    fileName: options.fileName,
  });
  const checks = [payload, loader];
  return { ok: checks.every((check) => check.status === 'ok'), checks };
}

export interface UninstallOptions {
  root: string;
  install: AEInstall;
  fileName?: string;
}

export interface UninstallResult extends InstallerCheck {
  /** Paths that were removed. */
  removed: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes the bridge payload/folders and the Startup loader. Leaves settings and
 * the Claude Desktop extension alone. Idempotent: missing files are ignored.
 */
export async function uninstallAeMcp(options: UninstallOptions): Promise<UninstallResult> {
  const targets = [
    join(loaderStartupDir(options.install), options.fileName ?? LOADER_FILE_NAME),
    join(options.root, 'bridge'),
  ];
  const removed: string[] = [];
  try {
    for (const target of targets) {
      if (await exists(target)) {
        await rm(target, { recursive: true, force: true });
        removed.push(target);
      }
    }
    return { check: 'uninstall', status: 'ok', removed };
  } catch {
    return {
      check: 'uninstall',
      status: 'fail',
      removed,
      fix: 'Some files could not be removed; delete them with an administrator and quit After Effects first.',
    };
  }
}
