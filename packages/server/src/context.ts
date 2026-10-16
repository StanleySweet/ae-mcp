import { isAeRunning as defaultIsAeRunning } from './ae-process.js';
import { readHeartbeat } from './heartbeat.js';

export interface AeContext {
  connected: boolean;
  transport?: string;
  aeVersion?: string;
  bridgeVersion?: string;
  capabilities?: string[];
  busy?: boolean;
  heartbeatAgeMs?: number;
  /** False when no After Effects process is running; undefined when the check failed. */
  aeRunning?: boolean;
  fix?: string;
}

export interface AeContextOptions {
  now?: () => number;
  maxAgeMs?: number;
  /** Whether an After Effects process is running; default checks with `pgrep`. */
  isAeRunning?: () => Promise<boolean>;
}

/** Ambient connection context for Claude, derived from the bridge heartbeat. */
export async function buildAeContext(
  root: string,
  options: AeContextOptions = {},
): Promise<AeContext> {
  const state = await readHeartbeat(root, options.maxAgeMs ?? 90_000, options.now);
  const check = options.isAeRunning ?? (() => defaultIsAeRunning());
  const aeRunning = await check().catch((): undefined => undefined);
  const notRunning = aeRunning === false;
  if (state.status !== 'ok') {
    return {
      connected: false,
      aeRunning,
      fix: notRunning
        ? 'Launch After Effects, then retry.'
        : 'Open After Effects, then run check_setup for details.',
    };
  }
  return {
    connected: true,
    transport: state.beat.transport,
    aeVersion: state.beat.aeVersion,
    bridgeVersion: state.beat.bridgeVersion,
    capabilities: state.beat.capabilities,
    busy: state.beat.busy,
    heartbeatAgeMs: Math.round(state.ageMs),
    aeRunning,
    ...(notRunning ? { fix: 'Launch After Effects, then retry.' } : {}),
  };
}
