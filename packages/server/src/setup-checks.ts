import { stat } from 'node:fs/promises';
import { discoverAEVersions } from '@ae-mcp/core';
import { readHeartbeat } from './heartbeat.js';

export type CheckStatus = 'ok' | 'fail';

export interface SetupCheck {
  check: string;
  status: CheckStatus;
  fix?: string;
}

export interface SetupDeps {
  root: string;
  applicationsDir?: string;
  now?: () => number;
  heartbeatMaxAgeMs?: number;
}

function fail(check: string, fix: string): SetupCheck {
  return { check, status: 'fail', fix };
}

async function afterEffectsCheck(applicationsDir?: string): Promise<SetupCheck> {
  const installs = await discoverAEVersions(applicationsDir);
  if (installs.length > 0) {
    return { check: 'after_effects', status: 'ok' };
  }
  return fail('after_effects', 'Install After Effects 2025 or later.');
}

async function heartbeatCheck(
  root: string,
  maxAgeMs: number,
  now: () => number,
): Promise<SetupCheck> {
  const state = await readHeartbeat(root, maxAgeMs, now);
  switch (state.status) {
    case 'ok':
      return { check: 'bridge_heartbeat', status: 'ok' };
    case 'missing':
      return fail(
        'bridge_heartbeat',
        'Open After Effects. If it persists, reinstall the bridge with Setup.',
      );
    case 'unreadable':
      return fail('bridge_heartbeat', 'The heartbeat is unreadable; restart After Effects.');
    case 'stale':
      return fail('bridge_heartbeat', 'The bridge stopped reporting; restart After Effects.');
  }
}

async function queueDirCheck(root: string): Promise<SetupCheck> {
  try {
    const info = await stat(root);
    if ((info.mode & 0o777) !== 0o700) {
      return fail('queue_permissions', `Queue directory must be chmod 700: chmod 700 "${root}".`);
    }
  } catch {
    return fail('queue_permissions', 'Run the ae-mcp Setup app to create the bridge folders.');
  }
  return { check: 'queue_permissions', status: 'ok' };
}

export async function runSetupChecks(deps: SetupDeps): Promise<SetupCheck[]> {
  const now = deps.now ?? Date.now;
  const heartbeatMaxAgeMs = deps.heartbeatMaxAgeMs ?? 90_000;
  return [
    await afterEffectsCheck(deps.applicationsDir),
    await heartbeatCheck(deps.root, heartbeatMaxAgeMs, now),
    await queueDirCheck(deps.root),
  ];
}