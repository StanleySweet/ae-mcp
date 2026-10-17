import { readHeartbeat } from './heartbeat.js';

/** The release part of a bridge version: `1.4.1+abc1234-dirty` is `1.4.1`. */
export function releaseOf(version: string): string {
  const plus = version.indexOf('+');
  return plus < 0 ? version : version.slice(0, plus);
}

/** True when the bridge reports a different release than the server expects. */
export function bridgeVersionDiffers(expected: string, bridgeVersion: string): boolean {
  return releaseOf(bridgeVersion) !== releaseOf(expected);
}

/**
 * One-line warning for ae_do when the running bridge is a different release than
 * the server. Undefined when the versions match or no bridge has reported.
 */
export async function bridgeVersionWarning(
  root: string,
  expected: string,
  maxAgeMs = 90_000,
  now: () => number = Date.now,
): Promise<string | undefined> {
  const state = await readHeartbeat(root, maxAgeMs, now);
  if (state.status !== 'ok' && state.status !== 'stale') {
    return undefined;
  }
  const bridge = state.beat.bridgeVersion;
  if (!bridgeVersionDiffers(expected, bridge)) {
    return undefined;
  }
  return `The bridge is version ${bridge} but the server is ${expected}. Run check_setup for the fix.`;
}
