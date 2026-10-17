import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HistoryLog } from './history.js';
import { OperationRegistry } from './operations.js';
import { defaultScriptsDir, sanitizeScriptName, saveReplayScript, ScriptSaveError, writeScript } from './script-save.js';

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(prefix);
}

function registry(): OperationRegistry {
  const registry = new OperationRegistry();
  const schema = { comp: { type: 'string' }, index: { type: 'number' }, name: { type: 'string' } };
  registry.register({
    name: 'layer.rename',
    category: 'layer',
    description: 'rename',
    readOnly: false,
    destructive: false,
    schema,
  });
  return registry;
}

describe('sanitizeScriptName', () => {
  it('keeps letters, digits, spaces, dashes and underscores', () => {
    expect(sanitizeScriptName('My Replay_v2-final')).toBe('My Replay_v2-final');
  });

  it('drops every other character and trims the ends', () => {
    expect(sanitizeScriptName('  ../../evil; rm -rf!  ')).toBe('evil rm -rf');
  });

  it('returns an empty string when nothing is left', () => {
    expect(sanitizeScriptName('.../%%')).toBe('');
  });
});

describe('writeScript', () => {
  it('writes <name>.jsx into the scripts folder', async () => {
    const dir = await tempDir(join(tmpdir(), 'ae-mcp-scripts-'));
    const file = await writeScript(dir, 'Replay', 'body();\n', false);
    expect(file).toBe(join(dir, 'Replay.jsx'));
    expect(await readFile(file, 'utf8')).toBe('body();\n');
  });

  it('refuses an existing script unless overwrite is true', async () => {
    const dir = await tempDir(join(tmpdir(), 'ae-mcp-scripts-'));
    await writeFile(join(dir, 'Replay.jsx'), 'old');
    await expect(writeScript(dir, 'Replay', 'new', false)).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    expect(await readFile(join(dir, 'Replay.jsx'), 'utf8')).toBe('old');
    await writeScript(dir, 'Replay', 'new', true);
    expect(await readFile(join(dir, 'Replay.jsx'), 'utf8')).toBe('new');
  });

  it('names the path when the folder is not writable', async () => {
    if (process.getuid?.() === 0) return;
    const dir = await tempDir(join(tmpdir(), 'ae-mcp-scripts-'));
    await chmod(dir, 0o500);
    try {
      await expect(writeScript(dir, 'Replay', 'x', false)).rejects.toThrow(ScriptSaveError);
      await expect(writeScript(dir, 'Replay', 'x', false)).rejects.toThrow(join(dir, 'Replay.jsx'));
    } finally {
      await chmod(dir, 0o700);
    }
  });

  it('refuses a name that sanitizes to nothing', async () => {
    const dir = await tempDir(join(tmpdir(), 'ae-mcp-scripts-'));
    await expect(writeScript(dir, '%%%', 'x', false)).rejects.toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('defaultScriptsDir', () => {
  it('picks the newest install folder and its Scripts folder', async () => {
    const apps = await tempDir(join(tmpdir(), 'ae-mcp-apps-'));
    for (const year of [2025, 2026]) {
      await mkdir(join(apps, `Adobe After Effects ${year}`, `Adobe After Effects ${year}.app`), { recursive: true });
    }
    expect(await defaultScriptsDir(apps)).toBe(join(apps, 'Adobe After Effects 2026', 'Scripts'));
  });

  it('returns null when no install is found', async () => {
    expect(await defaultScriptsDir(await tempDir(join(tmpdir(), 'ae-mcp-apps-')))).toBeNull();
  });
});

describe('saveReplayScript', () => {
  async function setup(): Promise<{ root: string; scripts: string; history: HistoryLog }> {
    const root = await tempDir(join(tmpdir(), 'ae-mcp-root-'));
    await mkdir(join(root, 'bridge'), { recursive: true });
    await writeFile(join(root, 'bridge', 'current.jsx'), '// payload\n');
    const scripts = await tempDir(join(tmpdir(), 'ae-mcp-scripts-'));
    const history = new HistoryLog(root);
    await history.append({
      op: 'layer.rename',
      args: { comp: 'Main', index: 1, name: 'A' },
      mutating: true,
      ok: true,
    });
    return { root, scripts, history };
  }

  it('writes the replay as a script and says a restart may be needed', async () => {
    const { root, scripts, history } = await setup();
    const result = await saveReplayScript(
      { root, history, operations: registry(), scriptsDir: scripts },
      { name: 'Fix titles', overwrite: false },
    );
    expect(result.isError).toBe(false);
    const value = result.value as { file: string; steps: number; note: string };
    expect(value.file).toBe(join(scripts, 'Fix titles.jsx'));
    expect(value.steps).toBe(1);
    expect(value.note).toMatch(/may need a restart/);
    const jsx = await readFile(value.file, 'utf8');
    expect(jsx).toContain('// payload');
    expect(jsx).toContain('layer.rename');
  });

  it('retargets the steps to comp when given', async () => {
    const { root, scripts, history } = await setup();
    await saveReplayScript(
      { root, history, operations: registry(), scriptsDir: scripts },
      { name: 'Retarget', comp: 'Other', overwrite: false },
    );
    const jsx = await readFile(join(scripts, 'Retarget.jsx'), 'utf8');
    expect(jsx).toContain('var AEMCP_REPLAY_COMP = "Other";');
  });

  it('returns an error when the history is empty', async () => {
    const root = await tempDir(join(tmpdir(), 'ae-mcp-root-'));
    const result = await saveReplayScript(
      { root, history: new HistoryLog(root), operations: registry(), scriptsDir: root },
      { name: 'Empty', overwrite: false },
    );
    expect(result.isError).toBe(true);
  });

  it('returns an error when no After Effects install is found and no scripts folder is given', async () => {
    const { root, history } = await setup();
    const result = await saveReplayScript(
      { root, history, operations: registry(), applicationsDir: await tempDir(join(tmpdir(), 'ae-mcp-apps-')) },
      { name: 'Nowhere', overwrite: false },
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.value)).toMatch(/After Effects/);
  });
});
