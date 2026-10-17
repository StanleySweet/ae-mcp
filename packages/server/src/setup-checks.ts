import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverAEVersions, discoverAeExtensions } from '@ae-mcp/core';
import { bridgeVersionDiffers } from './bridge-version.js';
import { readHeartbeat } from './heartbeat.js';
import { checkForUpdate, type UpdateCheckOptions } from './update-check.js';

export type CheckStatus = 'ok' | 'fail';

export interface SetupCheck {
  check: string;
  status: CheckStatus;
  fix?: string;
  /** Informational value (e.g. the detected extensions); ignored by the installer UI. */
  detail?: string;
}

export interface SetupDeps {
  root: string;
  applicationsDir?: string;
  homeDir?: string;
  now?: () => number;
  heartbeatMaxAgeMs?: number;
  /** Operation names the installed bridge payload must report (the server's op registry). */
  expectedOperations?: string[];
  /** The server's version; the bridge heartbeat must report the same release. */
  expectedBridgeVersion?: string;
  /** The running server version; when given, check_setup also looks for a newer release. */
  serverVersion?: string;
  /** Test seams and opt-out for the update check (see update-check.ts). */
  updateCheck?: Pick<UpdateCheckOptions, 'env' | 'fetchLatest' | 'now' | 'timeoutMs'>;
  /** Invalid files found in `<root>/snippets` (#246), each with its reason. */
  snippetProblems?: Array<{ file: string; reason: string }>;
}

async function updateCheckRow(deps: SetupDeps): Promise<SetupCheck | null> {
  if (!deps.serverVersion) {
    return null;
  }
  const result = await checkForUpdate({
    root: deps.root,
    current: deps.serverVersion,
    ...deps.updateCheck,
  });
  switch (result.status) {
    case 'disabled':
      return null;
    case 'up_to_date':
      return { check: 'extension_update', status: 'ok', detail: `up to date (${result.latest})` };
    case 'update_available':
      return {
        check: 'extension_update',
        status: 'ok',
        detail: `update available: ${result.latest} at ${result.url}`,
      };
    case 'unavailable':
      return { check: 'extension_update', status: 'ok', detail: `update check unavailable: ${result.reason}` };
  }
}


function snippetsCheck(problems: Array<{ file: string; reason: string }> = []): SetupCheck {
  if (problems.length === 0) {
    return { check: 'user_snippets', status: 'ok' };
  }
  const detail = problems.map((problem) => `${problem.file}: ${problem.reason}`).join('; ');
  return {
    check: 'user_snippets',
    status: 'fail',
    fix: `These files in ~/.ae-mcp/snippets are skipped; fix or delete them. ${detail}`,
    detail,
  };
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

async function bridgePayloadCheck(
  root: string,
  maxAgeMs: number,
  now: () => number,
  expected: string[] | undefined,
): Promise<SetupCheck> {
  if (!expected || expected.length === 0) {
    return { check: 'bridge_capabilities', status: 'ok', detail: 'no operations to compare' };
  }
  const state = await readHeartbeat(root, maxAgeMs, now);
  if (state.status === 'missing' || state.status === 'unreadable') {
    return { check: 'bridge_capabilities', status: 'ok', detail: 'bridge not reporting; see bridge_heartbeat' };
  }
  const present = state.beat.capabilities;
  const missing = expected.filter((name) => present.indexOf(name) === -1);
  if (missing.length === 0) {
    return { check: 'bridge_capabilities', status: 'ok' };
  }
  return fail(
    'bridge_capabilities',
    `The bridge payload is out of date: it is missing ${missing.length} operation(s) — ` +
      `${missing.join(', ')}. Refresh the bridge (run Setup, then restart After Effects).`,
  );
}

async function bridgeVersionCheck(
  root: string,
  maxAgeMs: number,
  now: () => number,
  expected: string | undefined,
): Promise<SetupCheck> {
  if (!expected) {
    return { check: 'bridge_version', status: 'ok', detail: 'no expected version to compare' };
  }
  const state = await readHeartbeat(root, maxAgeMs, now);
  if (state.status === 'missing' || state.status === 'unreadable') {
    return { check: 'bridge_version', status: 'ok', detail: 'bridge not reporting; see bridge_heartbeat' };
  }
  const bridge = state.beat.bridgeVersion;
  if (!bridgeVersionDiffers(expected, bridge)) {
    return { check: 'bridge_version', status: 'ok' };
  }
  return fail(
    'bridge_version',
    `The After Effects bridge is version ${bridge}, but this server is ${expected}. ` +
      'Run Setup to reinstall the bridge, then restart After Effects.',
  );
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

async function projectSavedVersionCheck(root: string): Promise<SetupCheck> {
  const file = join(root, 'bridge', 'last-saved-version');
  const neverSaved = fail(
    'project_saved_version',
    'The project has never been saved. Save it once: ask Claude to run project.save with a path, or use File > Save.',
  );
  let savedPath: string;
  try {
    savedPath = (await readFile(file, 'utf8')).trim();
  } catch {
    return neverSaved;
  }
  if (!savedPath) {
    return neverSaved;
  }
  try {
    const info = await stat(savedPath);
    if (!info.isFile()) {
      return fail('project_saved_version', `The saved version is not a file: ${savedPath}.`);
    }
  } catch {
    return fail('project_saved_version', `The saved version no longer exists on disk: ${savedPath}.`);
  }
  return {
    check: 'project_saved_version',
    status: 'ok',
    fix: `The saved project version is: ${savedPath}`,
  };
}

async function extensionsCheck(homeDir?: string): Promise<SetupCheck> {
  const extensions = await discoverAeExtensions({ homeDir });
  if (extensions.length === 0) {
    return { check: 'third_party_extensions', status: 'ok', detail: 'none detected' };
  }
  const names = extensions.map((e) => (e.scope === 'system' ? `${e.name} (system)` : e.name));
  return { check: 'third_party_extensions', status: 'ok', detail: names.join(', ') };
}

export async function runSetupChecks(deps: SetupDeps): Promise<SetupCheck[]> {
  const now = deps.now ?? Date.now;
  const heartbeatMaxAgeMs = deps.heartbeatMaxAgeMs ?? 90_000;
  const checks = [
    await afterEffectsCheck(deps.applicationsDir),
    await heartbeatCheck(deps.root, heartbeatMaxAgeMs, now),
    await bridgePayloadCheck(deps.root, heartbeatMaxAgeMs, now, deps.expectedOperations),
    await bridgeVersionCheck(deps.root, heartbeatMaxAgeMs, now, deps.expectedBridgeVersion),
    await queueDirCheck(deps.root),
    await projectSavedVersionCheck(deps.root),
    await extensionsCheck(deps.homeDir),
    snippetsCheck(deps.snippetProblems),
  ];
  const update = await updateCheckRow(deps);
  if (update !== null) {
    checks.push(update);
  }
  return checks;
}