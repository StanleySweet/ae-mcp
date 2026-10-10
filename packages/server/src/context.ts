import { readHeartbeat } from './heartbeat.js';

export interface AeContext {
  connected: boolean;
  transport?: string;
  aeVersion?: string;
  bridgeVersion?: string;
  capabilities?: string[];
  busy?: boolean;
  heartbeatAgeMs?: number;
  fix?: string;
}

export interface AeContextOptions {
  now?: () => number;
  maxAgeMs?: number;
}

/** Ambient connection context for Claude, derived from the bridge heartbeat. */
export async function buildAeContext(
  root: string,
  options: AeContextOptions = {},
): Promise<AeContext> {
  const state = await readHeartbeat(root, options.maxAgeMs ?? 90_000, options.now);
  if (state.status !== 'ok') {
    return { connected: false, fix: 'Open After Effects, then run check_setup for details.' };
  }
  return {
    connected: true,
    transport: state.beat.transport,
    aeVersion: state.beat.aeVersion,
    bridgeVersion: state.beat.bridgeVersion,
    capabilities: state.beat.capabilities,
    busy: state.beat.busy,
    heartbeatAgeMs: Math.round(state.ageMs),
  };
}