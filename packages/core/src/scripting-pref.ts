import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isAfterEffectsRunning, type IsRunning } from './ae-process.js';
import type { InstallerCheck } from './install-payload.js';

export const SCRIPTING_PREF_KEY = 'Pref_SCRIPTING_FILE_NETWORK_SECURITY';
export const MAIN_PREF_SECTION = '[Main Pref Section v2]';
const BACKUP_SUFFIX = '.ae-mcp-backup';

const VERSION_PATTERN = /^\d+(?:\.\d+)*$/;

/** `~/Library/Preferences/Adobe/After Effects` — where AE keeps its prefs. */
export function aePrefsRoot(homeDir = homedir()): string {
  return join(homeDir, 'Library', 'Preferences', 'Adobe', 'After Effects');
}

export interface AEPrefsDir {
  /** AE version, e.g. `26.5`. */
  version: string;
  dir: string;
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Lists AE version folders under `aeDir`, newest first (macOS only). */
export async function discoverPrefsDirs(aeDir = aePrefsRoot()): Promise<AEPrefsDir[]> {
  let entries: string[];
  try {
    entries = await readdir(aeDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => VERSION_PATTERN.test(name))
    .sort(compareVersions)
    .map((version) => ({ version, dir: join(aeDir, version) }));
}

/** Finds the single `… Prefs.txt` file in a version folder, or null. */
export async function findPrefsFile(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const match = entries.find((name) => name.endsWith('Prefs.txt'));
  return match === undefined ? null : join(dir, match);
}

function valuePattern(): RegExp {
  return new RegExp(`(?:^|[\\r\\n])[ \\t]*"?${SCRIPTING_PREF_KEY}"?[ \\t]*=[ \\t]*"?(-?\\d+)"?`);
}

/** Reads the scripting file-access preference value, or null when unset. */
export function readScriptingPref(content: string): number | null {
  const match = valuePattern().exec(content);
  return match === null ? null : Number(match[1]);
}

export interface ScriptingPrefEdit {
  content: string;
  changed: boolean;
  /** Whether the key already existed in the file. */
  found: boolean;
}

/**
 * Sets `Pref_SCRIPTING_FILE_NETWORK_SECURITY` to `1`. When the key is missing it
 * is inserted into the main pref section (created if absent).
 */
export function setScriptingPref(content: string): ScriptingPrefEdit {
  if (readScriptingPref(content) === 1) {
    return { content, changed: false, found: true };
  }
  const line = new RegExp(
    `(^|[\\r\\n])([ \\t]*"?${SCRIPTING_PREF_KEY}"?[ \\t]*=[ \\t]*"?)\\d+("?)`,
  );
  if (line.test(content)) {
    return {
      content: content.replace(line, (_match, before: string, prefix: string, quote: string) =>
        `${before}${prefix}1${quote}`,
      ),
      changed: true,
      found: true,
    };
  }
  const entry = `"${SCRIPTING_PREF_KEY}" = "1"`;
  if (content.includes(MAIN_PREF_SECTION)) {
    return {
      content: content.replace(MAIN_PREF_SECTION, `${MAIN_PREF_SECTION}\n${entry}`),
      changed: true,
      found: false,
    };
  }
  return {
    content: `${content.replace(/\s*$/, '')}\n${MAIN_PREF_SECTION}\n${entry}\n`,
    changed: true,
    found: false,
  };
}

export interface EnableScriptingPrefOptions {
  prefsFile: string;
}

export interface EnableScriptingPrefResult extends InstallerCheck {
  changed: boolean;
  value: number;
  /** Backup file left next to the prefs file when it was rewritten. */
  backup?: string;
}

/**
 * Enables the scripting file-access preference in `prefsFile`, backing it up
 * first and verifying the write. After Effects must be closed: it rewrites the
 * prefs file on quit. Idempotent; never throws — failures return a `fix` row.
 */
export async function enableScriptingPref(
  options: EnableScriptingPrefOptions,
): Promise<EnableScriptingPrefResult> {
  let content: string;
  try {
    content = await readFile(options.prefsFile, 'utf8');
  } catch {
    return {
      check: 'scripting_pref',
      status: 'fail',
      changed: false,
      value: 0,
      fix: 'Open After Effects once so it writes its preferences, then run Setup again.',
    };
  }
  const edit = setScriptingPref(content);
  if (!edit.changed) {
    return { check: 'scripting_pref', status: 'ok', changed: false, value: 1 };
  }
  const backup = `${options.prefsFile}${BACKUP_SUFFIX}`;
  try {
    await copyFile(options.prefsFile, backup);
    await writeFile(options.prefsFile, edit.content, 'utf8');
  } catch {
    return {
      check: 'scripting_pref',
      status: 'fail',
      changed: false,
      value: 0,
      fix: `Grant write access to ${options.prefsFile} and quit After Effects before retrying.`,
    };
  }
  const verify = readScriptingPref(await readFile(options.prefsFile, 'utf8'));
  if (verify !== 1) {
    return {
      check: 'scripting_pref',
      status: 'fail',
      changed: false,
      value: verify ?? 0,
      fix: 'After Effects did not keep the scripting preference; set it by hand in Preferences > Scripting & Expressions.',
    };
  }
  return { check: 'scripting_pref', status: 'ok', changed: true, value: 1, backup };
}

export interface EnsureScriptingPrefOptions {
  /** AE application name, e.g. `Adobe After Effects 2026`. */
  appName: string;
  /** AE prefs root; defaults to `aePrefsRoot()`. */
  prefsRoot?: string;
  /** AE-running probe; defaults to `isAfterEffectsRunning`. Injectable for tests. */
  isRunning?: IsRunning;
}

/**
 * Enables the scripting preference for the newest AE prefs folder, refusing
 * while AE is running (it rewrites prefs on quit). Returns a `scripting_pref`
 * row; the row carries `needsQuit: true` when AE must be quit and retried.
 * Never throws.
 */
export async function ensureScriptingPref(
  options: EnsureScriptingPrefOptions,
): Promise<InstallerCheck> {
  const dirs = await discoverPrefsDirs(options.prefsRoot ?? aePrefsRoot());
  const newest = dirs[0];
  if (newest === undefined) {
    return {
      check: 'scripting_pref',
      status: 'fail',
      fix: 'Open After Effects once so it writes its preferences, then run Setup again.',
    };
  }
  const isRunning = options.isRunning ?? isAfterEffectsRunning;
  if (await isRunning(options.appName)) {
    return {
      check: 'scripting_pref',
      status: 'fail',
      needsQuit: true,
      fix: 'Quit After Effects (Cmd+Q), then click Retry.',
    };
  }
  const prefsFile = await findPrefsFile(newest.dir);
  if (prefsFile === null) {
    return {
      check: 'scripting_pref',
      status: 'fail',
      fix: 'Open After Effects once so it writes its preferences, then run Setup again.',
    };
  }
  return enableScriptingPref({ prefsFile });
}
