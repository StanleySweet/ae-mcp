import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { readHeartbeat } from './heartbeat.js';
import { aeAppName, type Runner } from './osascript-transport.js';

const execFileAsync = promisify(execFile);

const defaultRunner: Runner = (command, args, options) =>
  execFileAsync(command, args, options) as Promise<{ stdout: string }>;

export interface LaunchAEOptions {
  root: string;
  appName?: string;
  runner?: Runner;
  now?: () => number;
  timeoutMs?: number;
  pollMs?: number;
  heartbeatMaxAgeMs?: number;
}

export type LaunchResult =
  | { status: 'ready'; waitedMs: number }
  | { status: 'timeout'; waitedMs: number; fix: string }
  | { status: 'launch_failed'; error: string };

async function isFresh(root: string, maxAgeMs: number, now: () => number): Promise<boolean> {
  return (await readHeartbeat(root, maxAgeMs, now)).status === 'ok';
}

/**
 * Opens After Effects if it is not already reporting, then waits for a fresh
 * heartbeat. `open -a` is a no-op when the app is already running, so this is
 * safe to call on every cold start.
 */
export async function launchAE(options: LaunchAEOptions): Promise<LaunchResult> {
  const now = options.now ?? Date.now;
  const maxAgeMs = options.heartbeatMaxAgeMs ?? 90_000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollMs = options.pollMs ?? 500;
  const appName = options.appName ?? aeAppName();

  if (await isFresh(options.root, maxAgeMs, now)) {
    return { status: 'ready', waitedMs: 0 };
  }

  const runner = options.runner ?? defaultRunner;
  try {
    await runner('open', ['-a', appName], { encoding: 'utf8' });
  } catch (error) {
    return { status: 'launch_failed', error: String(error) };
  }

  const start = now();
  while (now() - start < timeoutMs) {
    if (await isFresh(options.root, maxAgeMs, now)) {
      return { status: 'ready', waitedMs: now() - start };
    }
    await delay(pollMs);
  }
  return {
    status: 'timeout',
    waitedMs: now() - start,
    fix: 'After Effects did not report a heartbeat; open it manually and run check_setup.',
  };
}