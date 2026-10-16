import { defaultRunner, type Runner } from './osascript-transport.js';

/** True when an After Effects process is running. `pgrep` exits 1 (rejects) when none matches. */
export async function isAeRunning(runner: Runner = defaultRunner): Promise<boolean> {
  try {
    await runner('pgrep', ['-x', 'After Effects'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}
