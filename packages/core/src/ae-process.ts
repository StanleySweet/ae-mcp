import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Probes whether a named application is running. Injectable for tests. */
export type IsRunning = (appName: string) => Promise<boolean>;

/**
 * Whether an After Effects process is running, via macOS `pgrep -f`. AE
 * rewrites its prefs on quit, so the scripting preference must be set while it
 * is closed (docs/spike/README.md Q4). `pgrep` exits non-zero when nothing
 * matches, which `execFile` rejects, so a miss becomes `false`.
 */
export async function isAfterEffectsRunning(
  appName = 'Adobe After Effects',
): Promise<boolean> {
  try {
    await execFileAsync('pgrep', ['-f', appName]);
    return true;
  } catch {
    return false;
  }
}
