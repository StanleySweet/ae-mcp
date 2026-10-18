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

/** Process id of the running After Effects, or null when none runs. Tells a relaunched AE from the one a job was sent to. */
export async function aeProcessId(runner: Runner = defaultRunner): Promise<string | null> {
  try {
    const { stdout } = await runner('pgrep', ['-x', 'After Effects'], { encoding: 'utf8' });
    return stdout.trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}
