import { defaultRunner, type Runner } from './osascript-transport.js';

/** Which After Effects app is running: the stable release or the beta. */
export type RunningAeApp = 'stable' | 'beta';

const PROCESS_NAMES: ReadonlyArray<readonly [RunningAeApp, string]> = [
  ['stable', 'After Effects'],
  ['beta', 'After Effects (Beta)'],
];

/**
 * The running After Effects process and its pid, checking stable before beta.
 * `pgrep` exits 1 (rejects) when no process matches.
 */
async function findRunningAe(runner: Runner): Promise<{ app: RunningAeApp; pid: string | null } | null> {
  for (const [app, processName] of PROCESS_NAMES) {
    try {
      const { stdout } = await runner('pgrep', ['-x', processName], { encoding: 'utf8' });
      return { app, pid: stdout.trim().split(/\s+/)[0] || null };
    } catch {
      // No process with this name: try the next one.
    }
  }
  return null;
}

/** Which After Effects app runs (stable or beta), or null when neither runs. */
export async function runningAeApp(runner: Runner = defaultRunner): Promise<RunningAeApp | null> {
  return (await findRunningAe(runner))?.app ?? null;
}

/** True when an After Effects process (stable or beta) is running. */
export async function isAeRunning(runner: Runner = defaultRunner): Promise<boolean> {
  return (await findRunningAe(runner)) !== null;
}

/** Process id of the running After Effects, or null when none runs. Tells a relaunched AE from the one a job was sent to. */
export async function aeProcessId(runner: Runner = defaultRunner): Promise<string | null> {
  return (await findRunningAe(runner))?.pid ?? null;
}
