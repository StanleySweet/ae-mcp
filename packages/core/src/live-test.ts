import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { InstallerCheck } from './install-payload.js';

const execFileAsync = promisify(execFile);

export const TEST_COMP_NAME = 'AE-MCP Test';

/** Opens AE and reports whether the `open` call succeeded. */
export type LaunchAE = (appName: string) => Promise<boolean>;

/** Runs one bridge operation and reports whether it succeeded. */
export type LiveCall = (tool: string, args: Record<string, unknown>) => Promise<boolean>;

async function openAE(appName: string): Promise<boolean> {
  try {
    await execFileAsync('open', ['-a', appName]);
    return true;
  } catch {
    return false;
  }
}

/** Whether the bridge heartbeat file exists and was modified within `maxAgeMs`. */
export async function isHeartbeatFresh(
  root: string,
  maxAgeMs: number,
  now: () => number = Date.now,
): Promise<boolean> {
  try {
    const info = await stat(join(root, 'bridge', 'outbox', 'heartbeat.json'));
    return now() - info.mtimeMs <= maxAgeMs;
  } catch {
    return false;
  }
}

export interface LiveTestOptions {
  root: string;
  appName: string;
  /** Bridge operation runner (inject the installer's AEClient). */
  call: LiveCall;
  launch?: LaunchAE;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
  heartbeatMaxAgeMs?: number;
}

/**
 * Install-time smoke test: launches After Effects if needed, waits for a fresh
 * heartbeat, then creates and removes a test comp through the bridge. Returns a
 * `live_test` row with a fix on any failure.
 */
export async function runLiveTest(options: LiveTestOptions): Promise<InstallerCheck> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollMs = options.pollMs ?? 500;
  const maxAgeMs = options.heartbeatMaxAgeMs ?? 90_000;

  if (!(await isHeartbeatFresh(options.root, maxAgeMs, now))) {
    const launch = options.launch ?? openAE;
    if (!(await launch(options.appName))) {
      return {
        check: 'live_test',
        status: 'fail',
        fix: 'After Effects could not be launched; open it manually, then run the test again.',
      };
    }
    const start = now();
    while (!(await isHeartbeatFresh(options.root, maxAgeMs, now)) && now() - start < timeoutMs) {
      await sleep(pollMs);
    }
    if (!(await isHeartbeatFresh(options.root, maxAgeMs, now))) {
      return {
        check: 'live_test',
        status: 'fail',
        fix: 'After Effects never reported a heartbeat; reopen it and reinstall the bridge.',
      };
    }
  }

  if (!(await options.call('comp.create', { name: TEST_COMP_NAME, width: 1920, height: 1080 }))) {
    return {
      check: 'live_test',
      status: 'fail',
      fix: 'After Effects could not create a test comp; check the scripting preference and reinstall.',
    };
  }
  if (!(await options.call('project.undo', {}))) {
    return {
      check: 'live_test',
      status: 'fail',
      fix: 'After Effects could not remove the test comp; undo the change by hand.',
    };
  }
  return { check: 'live_test', status: 'ok' };
}
