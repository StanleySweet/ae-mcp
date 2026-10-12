import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type InstallStatus = 'ok' | 'fail';

/** One installer step's outcome, shaped for the Setup checklist. */
export interface InstallerCheck {
  check: string;
  status: InstallStatus;
  fix?: string;
  /** Set when the step needs After Effects quit before it can run (E10-12). */
  needsQuit?: boolean;
}

export interface InstallPayloadOptions {
  /** Queue root, usually `~/.ae-mcp`. */
  root: string;
  /** Built payload source (`packages/bridge/dist/payload.jsx`). */
  payload: string;
}

export interface InstallPayloadResult extends InstallerCheck {
  /** Bridge version parsed from the payload stamp. */
  version: string;
  /** Whether `current.jsx` was (re)written. */
  changed: boolean;
}

const VERSION_MARKER = 'AEMCP_BRIDGE_VERSION = "';

/** Reads the bridge version from the generated payload's stamp, or null. */
export function payloadVersion(source: string): string | null {
  const at = source.indexOf(VERSION_MARKER);
  if (at < 0) {
    return null;
  }
  const start = at + VERSION_MARKER.length;
  const end = source.indexOf('"', start);
  if (end < 0) {
    return null;
  }
  return source.slice(start, end);
}

/**
 * Installs the bridge payload at `<root>/bridge/current.jsx`, creating the
 * bridge folders. Safe to run repeatedly: a matching payload is left untouched
 * (`changed: false`). Never throws — failures come back as a `fix` row.
 */
export async function installPayload(
  options: InstallPayloadOptions,
): Promise<InstallPayloadResult> {
  const version = payloadVersion(options.payload);
  if (version === null) {
    return {
      check: 'bridge_payload',
      status: 'fail',
      version: '',
      changed: false,
      fix: 'The bridge payload is missing its version stamp; rebuild with npm run bridge:build.',
    };
  }
  const bridgeDir = join(options.root, 'bridge');
  try {
    await mkdir(join(bridgeDir, 'inbox'), { recursive: true });
    await mkdir(join(bridgeDir, 'outbox'), { recursive: true });
    const currentPath = join(bridgeDir, 'current.jsx');
    const previous = await readFile(currentPath, 'utf8').catch(() => null);
    const changed = previous !== options.payload;
    if (changed) {
      await writeFile(currentPath, options.payload);
    }
    return { check: 'bridge_payload', status: 'ok', version, changed };
  } catch {
    return {
      check: 'bridge_payload',
      status: 'fail',
      version,
      changed: false,
      fix: `Grant write access to ${options.root}, or rerun the ae-mcp Setup app.`,
    };
  }
}
