import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  aePrefsRoot,
  discoverPrefsDirs,
  enableScriptingPref,
  findPrefsFile,
  readScriptingPref,
  SCRIPTING_PREF_KEY,
  setScriptingPref,
} from './scripting-pref.js';

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

const PREFS = [
  '[Main Pref Section v2]',
  `"${SCRIPTING_PREF_KEY}" = "0"`,
  '"Pref_OTHER" = "3"',
  '',
].join('\n');

describe('scripting preference content', () => {
  it('reads the current value', () => {
    expect(readScriptingPref(PREFS)).toBe(0);
    expect(readScriptingPref(`"${SCRIPTING_PREF_KEY}" = "1"`)).toBe(1);
  });

  it('returns null when the key is absent', () => {
    expect(readScriptingPref('[Main Pref Section v2]\n')).toBeNull();
  });

  it('enables an existing key, preserving the rest of the file', () => {
    const { content, changed, found } = setScriptingPref(PREFS);
    expect(changed).toBe(true);
    expect(found).toBe(true);
    expect(readScriptingPref(content)).toBe(1);
    expect(content).toContain('"Pref_OTHER" = "3"');
  });

  it('is a no-op when already enabled', () => {
    const enabled = `"${SCRIPTING_PREF_KEY}" = "1"`;
    expect(setScriptingPref(enabled)).toMatchObject({ changed: false, found: true });
  });

  it('inserts the key into the main section when missing', () => {
    const { content, changed, found } = setScriptingPref('[Main Pref Section v2]\n');
    expect(changed).toBe(true);
    expect(found).toBe(false);
    expect(readScriptingPref(content)).toBe(1);
    expect(content).toContain('[Main Pref Section v2]');
  });
});

describe('discoverPrefsDirs', () => {
  it('lists version folders newest first', async () => {
    const root = await tempDir('ae-mcp-prefs-');
    await mkdir(join(root, '25.1'), { recursive: true });
    await mkdir(join(root, '26.5'), { recursive: true });
    await mkdir(join(root, 'not-a-version'), { recursive: true });

    const dirs = await discoverPrefsDirs(root);

    expect(dirs.map((d) => d.version)).toEqual(['26.5', '25.1']);
    expect(dirs[0]!.dir).toBe(join(root, '26.5'));
  });

  it('returns an empty list when nothing is installed', async () => {
    expect(await discoverPrefsDirs(await tempDir('ae-mcp-prefs-'))).toEqual([]);
  });
});

describe('aePrefsRoot', () => {
  it('points under Library/Preferences/Adobe', () => {
    expect(aePrefsRoot('/Users/example')).toBe(
      join('/Users/example', 'Library', 'Preferences', 'Adobe', 'After Effects'),
    );
  });
});

describe('findPrefsFile', () => {
  it('finds the Prefs.txt in a version folder', async () => {
    const dir = await tempDir('ae-mcp-prefs-');
    await writeFile(join(dir, 'Adobe After Effects 26.5 Prefs.txt'), PREFS);

    expect(await findPrefsFile(dir)).toBe(join(dir, 'Adobe After Effects 26.5 Prefs.txt'));
  });

  it('returns null when there is no prefs file', async () => {
    expect(await findPrefsFile(await tempDir('ae-mcp-prefs-'))).toBeNull();
  });
});

describe('enableScriptingPref', () => {
  it('backs up the prefs file, enables the pref and verifies it', async () => {
    const dir = await tempDir('ae-mcp-prefs-');
    const prefsFile = join(dir, 'Adobe After Effects 26.5 Prefs.txt');
    await writeFile(prefsFile, PREFS);

    const result = await enableScriptingPref({ prefsFile });

    expect(result).toMatchObject({ check: 'scripting_pref', status: 'ok', changed: true, value: 1 });
    expect(readScriptingPref(await readFile(prefsFile, 'utf8'))).toBe(1);
    expect(await readFile(result.backup!, 'utf8')).toBe(PREFS);
  });

  it('is idempotent and leaves no backup when already enabled', async () => {
    const dir = await tempDir('ae-mcp-prefs-');
    const prefsFile = join(dir, 'Adobe After Effects 26.5 Prefs.txt');
    await writeFile(prefsFile, `"${SCRIPTING_PREF_KEY}" = "1"`);

    const result = await enableScriptingPref({ prefsFile });

    expect(result).toMatchObject({ status: 'ok', changed: false, value: 1 });
    expect(result.backup).toBeUndefined();
  });

  it('reports a fix when the prefs file is missing', async () => {
    const dir = await tempDir('ae-mcp-prefs-');

    const result = await enableScriptingPref({ prefsFile: join(dir, 'nope Prefs.txt') });

    expect(result.status).toBe('fail');
    expect(result.fix).toBeTruthy();
  });
});
