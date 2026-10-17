import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { discoverAEVersions } from '@ae-mcp/core';
import { makeError } from '@ae-mcp/protocol';
import { checkEs3 } from './es3-check.js';
import { type HistoryEntry, type HistoryLog, MAX_HISTORY_LIST } from './history.js';
import type { OperationRegistry } from './operations.js';
import { replayJsx, replaySteps } from './replay.js';

/** What `saveReplayScript` returns: the tool result value and whether it is an error. */
export interface ScriptSaveResult {
  value: unknown;
  isError: boolean;
}

/** A refusal or write failure with an error code the MCP result carries. */
export class ScriptSaveError extends Error {
  constructor(
    readonly code: 'INVALID_ARGS' | 'SCRIPT_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'ScriptSaveError';
  }
}

/** Keeps letters, digits, spaces, dashes and underscores; collapses spaces; trims. Empty means refused. */
export function sanitizeScriptName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .replace(/ +/g, ' ')
    .trim();
}

/**
 * The Scripts folder of the newest After Effects install under `applicationsDir`
 * (`<install folder>/Scripts`, the layout AE uses on macOS). Null when there is none.
 */
export async function defaultScriptsDir(applicationsDir?: string): Promise<string | null> {
  const [newest] = await discoverAEVersions(applicationsDir ?? '/Applications');
  if (newest === undefined) {
    return null;
  }
  // Only the folder layout (`Adobe After Effects <year>/Adobe After Effects <year>.app`) has a Scripts folder beside the app.
  const installFolder = dirname(newest.path);
  if (basename(installFolder) !== newest.appName) {
    return null;
  }
  return join(installFolder, 'Scripts');
}

/**
 * Writes `<scriptsDir>/<name>.jsx`. An existing file is refused unless `overwrite`
 * is true (the 'wx' flag makes the check atomic). Returns the written path.
 */
export async function writeScript(scriptsDir: string, name: string, content: string, overwrite: boolean): Promise<string> {
  const clean = sanitizeScriptName(name);
  if (clean === '') {
    throw new ScriptSaveError('INVALID_ARGS', 'the name has no letters, digits, spaces, dashes or underscores');
  }
  const file = join(scriptsDir, `${clean}.jsx`);
  try {
    await writeFile(file, content, { flag: overwrite ? 'w' : 'wx' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new ScriptSaveError('INVALID_ARGS', `${file} already exists; pass overwrite: true to replace it`);
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new ScriptSaveError(
        'SCRIPT_ERROR',
        `cannot write ${file}: permission denied. The After Effects folder may need admin rights; check its permissions`,
      );
    }
    throw new ScriptSaveError('SCRIPT_ERROR', `cannot write ${file}: ${(error as Error).message}`);
  }
  return file;
}

export interface ScriptSaveDeps {
  root: string;
  history: HistoryLog;
  operations: OperationRegistry;
  /** Test seam: the folder to write into. When omitted it is the newest install's Scripts folder. */
  scriptsDir?: string;
  applicationsDir?: string;
}

export interface ScriptSaveArgs {
  name: string;
  n?: number;
  comp?: string;
  /** ExtendScript Claude wrote; saved as is (after the ES3 check) instead of the replay. Excludes n and comp. */
  source?: string;
  overwrite: boolean;
}

/** `script_save`: `source` saves the script Claude wrote, otherwise the replay of recent steps. */
export function saveScript(deps: ScriptSaveDeps, args: ScriptSaveArgs): Promise<ScriptSaveResult> {
  return args.source === undefined ? saveReplayScript(deps, args) : saveSourceScript(deps, args);
}

/**
 * `script_save` with `source`: checks the ExtendScript (it must parse and use no ES6 syntax),
 * then writes it as `<name>.jsx` with a header comment. The script is never run.
 */
export async function saveSourceScript(deps: ScriptSaveDeps, args: ScriptSaveArgs): Promise<ScriptSaveResult> {
  try {
    if (args.source === undefined) {
      return fail('INVALID_ARGS', 'source is missing');
    }
    if (args.n !== undefined || args.comp !== undefined) {
      return fail('INVALID_ARGS', 'source cannot be combined with n or comp: those save the replay of recent steps');
    }
    const check = checkEs3(args.source);
    if (!check.ok) {
      const where = check.line === null ? '' : ` at line ${check.line}`;
      return fail('INVALID_ARGS', `source is not ES3 (After Effects runs ES3)${where}: ${check.message}`);
    }
    const scriptsDir = deps.scriptsDir ?? (await defaultScriptsDir(deps.applicationsDir));
    if (scriptsDir === null) {
      return fail('SCRIPT_ERROR', 'no After Effects install found; install After Effects or set the applications folder');
    }
    const clean = sanitizeScriptName(args.name);
    const header = `// Generated by Claude through ae-mcp on ${new Date().toISOString()}: ${clean}\n`;
    const file = await writeScript(scriptsDir, args.name, `${header}${args.source}`, args.overwrite);
    return {
      value: {
        name: clean,
        file,
        note: 'After Effects lists the script under File > Scripts after a restart; it may need a restart. The script was not run.',
      },
      isError: false,
    };
  } catch (error) {
    if (error instanceof ScriptSaveError) {
      return fail(error.code, error.message);
    }
    throw error;
  }
}

/**
 * `script_save`: writes Claude's recent steps (the same replay as `history_export` with
 * format jsx) into After Effects' Scripts folder as `<name>.jsx`.
 */
export async function saveReplayScript(deps: ScriptSaveDeps, args: ScriptSaveArgs): Promise<ScriptSaveResult> {
  try {
    const all = await deps.history.all();
    const entries: HistoryEntry[] = args.n === undefined ? all : all.slice(-Math.min(args.n, MAX_HISTORY_LIST));
    if (entries.length === 0) {
      return fail('INVALID_ARGS', 'the history is empty: nothing to save');
    }
    const plan = replaySteps(entries, deps.operations, args.comp);
    if (plan.ops.length === 0) {
      return fail('INVALID_ARGS', 'the history has no steps that can be replayed (only read-only or failed calls)');
    }
    const payloadPath = join(deps.root, 'bridge', 'current.jsx');
    let payload: string;
    try {
      payload = await readFile(payloadPath, 'utf8');
    } catch {
      return fail('SCRIPT_ERROR', `no installed bridge payload at ${payloadPath}; run the Setup app to install it`);
    }
    const scriptsDir = deps.scriptsDir ?? (await defaultScriptsDir(deps.applicationsDir));
    if (scriptsDir === null) {
      return fail('SCRIPT_ERROR', 'no After Effects install found; install After Effects or set the applications folder');
    }
    const content = replayJsx(plan, payload, args.comp ?? null, new Date().toISOString());
    const file = await writeScript(scriptsDir, args.name, content, args.overwrite);
    return {
      value: {
        name: sanitizeScriptName(args.name),
        file,
        steps: plan.ops.length,
        skipped: plan.skipped,
        note: 'After Effects lists the script under File > Scripts after a restart; it may need a restart.',
      },
      isError: false,
    };
  } catch (error) {
    if (error instanceof ScriptSaveError) {
      return fail(error.code, error.message);
    }
    throw error;
  }
}

function fail(code: 'INVALID_ARGS' | 'SCRIPT_ERROR', message: string): ScriptSaveResult {
  return { value: makeError(code, message), isError: true };
}
