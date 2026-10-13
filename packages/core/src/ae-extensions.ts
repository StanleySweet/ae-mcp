import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** A third-party extension installed for After Effects (a CEP extension bundle). */
export interface AeExtension {
  /** Folder name, e.g. `com.misterhorse.animationcomposer`. */
  name: string;
  /** Absolute path to the extension folder. */
  path: string;
  scope: 'user' | 'system';
}

export interface DiscoverExtensionsOptions {
  homeDir?: string;
  systemDir?: string;
}

/** CEP scans these two folders for extensions, per `docs/spike/third-party.md` (E14-1). */
export const CEP_USER_SUBDIR = 'Library/Application Support/Adobe/CEP/extensions';
export const CEP_SYSTEM_DIR = '/Library/Application Support/Adobe/CEP/extensions';

/**
 * Lists the After Effects extensions installed on the machine (macOS): the
 * per-user CEP folder plus the system-wide one. Each extension is a folder; we
 * report the folder names so `check_setup` can name the third-party tools a
 * user has (Animation Composer, Motion, …). Missing folders are not an error.
 */
export async function discoverAeExtensions(
  options: DiscoverExtensionsOptions = {},
): Promise<AeExtension[]> {
  const home = options.homeDir ?? homedir();
  const dirs: { dir: string; scope: 'user' | 'system' }[] = [
    { dir: join(home, CEP_USER_SUBDIR), scope: 'user' },
    { dir: options.systemDir ?? CEP_SYSTEM_DIR, scope: 'system' },
  ];
  const extensions: AeExtension[] = [];
  for (const { dir, scope } of dirs) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        extensions.push({ name: entry.name, path: join(dir, entry.name), scope });
      }
    }
  }
  extensions.sort((a, b) => a.name.localeCompare(b.name));
  return extensions;
}
