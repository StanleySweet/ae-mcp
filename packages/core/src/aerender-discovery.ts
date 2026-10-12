import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { discoverAEVersions, type AEInstall } from './ae-discovery.js';

export interface AerenderInstall extends AEInstall {
  /** Absolute path to the aerender executable for this install. */
  aerender: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Candidate aerender locations for an install. aerender ships in the version
 * folder next to the app bundle (macOS `/Applications/Adobe After Effects 2026/aerender`),
 * so the bundle's parent is checked first; the in-bundle Resources path is a
 * fallback for layouts that keep it there.
 *   https://helpx.adobe.com/after-effects/desktop/render-and-export/automate-rendering/automated-rendering-network-rendering.html
 */
function aerenderCandidates(install: AEInstall): string[] {
  return [
    join(dirname(install.path), 'aerender'),
    join(install.path, 'Contents', 'Resources', 'aerender'),
  ];
}

/** Returns the aerender path for an install, or null when none exists. */
export async function discoverAerender(install: AEInstall): Promise<string | null> {
  for (const candidate of aerenderCandidates(install)) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Lists After Effects installs at `applicationsDir` that also ship an aerender,
 * newest first (macOS only).
 */
export async function discoverAerenders(
  applicationsDir = '/Applications',
): Promise<AerenderInstall[]> {
  const installs = await discoverAEVersions(applicationsDir);
  const found: AerenderInstall[] = [];
  for (const install of installs) {
    const aerender = await discoverAerender(install);
    if (aerender !== null) {
      found.push({ ...install, aerender });
    }
  }
  return found;
}
