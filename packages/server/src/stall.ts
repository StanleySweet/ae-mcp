import { readHeartbeat } from './heartbeat.js';

export interface StallDetectionOptions {
  now?: () => number;
  maxAgeMs?: number;
}

export type Stall =
  | { stalled: true; ageMs: number }
  | { stalled: false; reason: 'fresh' | 'no_heartbeat' | 'idle' | 'unreadable' };

/**
 * A stall is a stale heartbeat whose last beat was busy: a job started, then
 * After Effects stopped reporting, which means a modal dialog is blocking it
 * (the bridge cannot run while a modal waits for an answer).
 */
export async function detectStall(
  root: string,
  options: StallDetectionOptions = {},
): Promise<Stall> {
  const state = await readHeartbeat(root, options.maxAgeMs ?? 90_000, options.now);
  switch (state.status) {
    case 'stale':
      return state.beat.busy
        ? { stalled: true, ageMs: Math.round(state.ageMs) }
        : { stalled: false, reason: 'idle' };
    case 'ok':
      return { stalled: false, reason: 'fresh' };
    case 'missing':
      return { stalled: false, reason: 'no_heartbeat' };
    case 'unreadable':
      return { stalled: false, reason: 'unreadable' };
  }
}