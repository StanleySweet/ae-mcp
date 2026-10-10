import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const MIN_SUPPORTED_AE_YEAR = 2025;

export interface AEInstall {
  /** AppleScript application name, e.g. `Adobe After Effects 2026`. */
  appName: string;
  /** Release year parsed from the bundle name, e.g. `2026`. */
  year: number;
  /** Absolute path to the `.app` bundle. */
  path: string;
}

const AE_APP_PATTERN = /^Adobe After Effects (\d{4})\.app$/;
const AE_FOLDER_PATTERN = /^Adobe After Effects (\d{4})$/;

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Lists After Effects installs at `applicationsDir`, newest first (macOS only).
 * Handles both layouts: `/Applications/Adobe After Effects 2026.app` and the
 * versioned folder `/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app`.
 */
export async function discoverAEVersions(
  applicationsDir = '/Applications',
): Promise<AEInstall[]> {
  let entries: string[];
  try {
    entries = await readdir(applicationsDir);
  } catch {
    return [];
  }
  const installs: AEInstall[] = [];
  for (const name of entries) {
    const direct = AE_APP_PATTERN.exec(name);
    if (direct !== null) {
      const year = Number(direct[1]);
      if (year >= MIN_SUPPORTED_AE_YEAR) {
        installs.push({ appName: name.slice(0, -'.app'.length), year, path: join(applicationsDir, name) });
      }
      continue;
    }
    const folder = AE_FOLDER_PATTERN.exec(name);
    if (folder !== null) {
      const year = Number(folder[1]);
      if (year < MIN_SUPPORTED_AE_YEAR) {
        continue;
      }
      const appPath = join(applicationsDir, name, `${name}.app`);
      if (await isDirectory(appPath)) {
        installs.push({ appName: name, year, path: appPath });
      }
    }
  }
  installs.sort((a, b) => b.year - a.year);
  return installs;
}