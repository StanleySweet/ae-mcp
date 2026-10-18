import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const MIN_SUPPORTED_AE_YEAR = 2025;

export interface AEInstall {
  /** AppleScript application name, e.g. `Adobe After Effects 2026`. */
  appName: string;
  /**
   * Release year parsed from the bundle name, e.g. `2026`. The beta has no year
   * in its name: its year is the major version from Info.plist + 2000 (27.x ->
   * 2027), or the newest stable year + 1 when the plist is unreadable.
   */
  year: number;
  /** Absolute path to the `.app` bundle. */
  path: string;
  /** True for `Adobe After Effects (Beta)`. */
  beta: boolean;
}

const AE_APP_PATTERN = /^Adobe After Effects (\d{4})\.app$/;
const AE_FOLDER_PATTERN = /^Adobe After Effects (\d{4})$/;
const AE_BETA_NAME = 'Adobe After Effects (Beta)';
const AE_BETA_APP_PATTERN = /^Adobe After Effects \(Beta\)\.app$/;
const AE_BETA_FOLDER_PATTERN = /^Adobe After Effects \(Beta\)$/;
const SHORT_VERSION_PATTERN = /<key>CFBundleShortVersionString<\/key>\s*<string>\s*(\d+)/;

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Major version from the bundle's Info.plist (`27.1.0` -> 27), or null when unreadable. */
async function betaMajorVersion(appPath: string): Promise<number | null> {
  try {
    const plist = await readFile(join(appPath, 'Contents', 'Info.plist'), 'utf8');
    const major = Number(SHORT_VERSION_PATTERN.exec(plist)?.[1]);
    return Number.isInteger(major) && major > 0 ? major : null;
  } catch {
    return null;
  }
}

/**
 * Lists After Effects installs at `applicationsDir` (macOS only): stable installs
 * newest first, then the beta. Handles both layouts: `/Applications/Adobe After
 * Effects 2026.app` and the versioned folder `/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app`.
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
  let betaPath: string | null = null;
  for (const name of entries) {
    const direct = AE_APP_PATTERN.exec(name);
    if (direct !== null) {
      const year = Number(direct[1]);
      if (year >= MIN_SUPPORTED_AE_YEAR) {
        installs.push({ appName: name.slice(0, -'.app'.length), year, path: join(applicationsDir, name), beta: false });
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
        installs.push({ appName: name, year, path: appPath, beta: false });
      }
      continue;
    }
    if (AE_BETA_APP_PATTERN.test(name)) {
      betaPath = betaPath ?? join(applicationsDir, name);
    } else if (AE_BETA_FOLDER_PATTERN.test(name)) {
      const appPath = join(applicationsDir, name, `${name}.app`);
      if (betaPath === null && (await isDirectory(appPath))) {
        betaPath = appPath;
      }
    }
  }
  installs.sort((a, b) => b.year - a.year);
  if (betaPath !== null) {
    const newestStable = installs[0]?.year ?? MIN_SUPPORTED_AE_YEAR - 1;
    const major = await betaMajorVersion(betaPath);
    installs.push({
      appName: AE_BETA_NAME,
      year: major !== null ? major + 2000 : newestStable + 1,
      path: betaPath,
      beta: true,
    });
  }
  return installs;
}
