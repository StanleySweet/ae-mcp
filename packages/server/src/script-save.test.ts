import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HistoryLog } from './history.js';
import { OperationRegistry } from './operations.js';
import {
  defaultScriptsDir,
  sanitizeScriptName,
  saveReplayScript,
  saveScript,
  ScriptSaveError,
  writeScript,
} from './script-save.js';

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

describe('saveScript with source', () => {
  const offset = 'var n = 2;\nvar layers = app.project.activeItem.selectedLayers;\nfor (var i = 0; i < layers.length; i++) {\n  layers[i].startTime += n;\n}\n';

  async function deps(): Promise<{ root: string; scripts: string; history: HistoryLog }> {
    const root = await tempDir(join(tmpdir(), 'ae-mcp-root-'));
    const scripts = await tempDir(join(tmpdir(), 'ae-mcp-scripts-'));
    return { root, scripts, history: new HistoryLog(root) };
  }

  it('writes valid ES3 source with a header comment and does not run it', async () => {
    const { root, scripts, history } = await deps();
    const result = await saveScript(
      { root, history, operations: registry(), scriptsDir: scripts },
      { name: 'Offset layers', source: offset, overwrite: false },
    );
    expect(result.isError).toBe(false);
    const value = result.value as { file: string; note: string };
    expect(value.file).toBe(join(scripts, 'Offset layers.jsx'));
    expect(value.note).toMatch(/not run/);
    const written = await readFile(value.file, 'utf8');
    expect(written.split('\n')[0]).toMatch(
      /^\/\/ Generated by Claude through ae-mcp on \d{4}-\d{2}-\d{2}T[\d:.]+Z: Offset layers$/,
    );
    expect(written.slice(written.indexOf('\n') + 1)).toBe(offset);
  });

  it('refuses ES6 syntax and names the line, writing nothing', async () => {
    const { root, scripts, history } = await deps();
    const result = await saveScript(
      { root, history, operations: registry(), scriptsDir: scripts },
      { name: 'Bad', source: 'var a = 1;\nconst b = 2;\n', overwrite: false },
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.value)).toMatch(/line 2/);
    await expect(readFile(join(scripts, 'Bad.jsx'), 'utf8')).rejects.toThrow();
  });

  it('refuses source that does not parse', async () => {
    const { root, scripts, history } = await deps();
    const result = await saveScript(
      { root, history, operations: registry(), scriptsDir: scripts },
      { name: 'Broken', source: 'var a = ;\n', overwrite: false },
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.value)).toMatch(/does not parse/);
  });

  it('refuses source combined with n or comp', async () => {
    const { root, scripts, history } = await deps();
    for (const extra of [{ n: 1 }, { comp: 'Main' }]) {
      const result = await saveScript(
        { root, history, operations: registry(), scriptsDir: scripts },
        { name: 'Both', source: 'var a = 1;', overwrite: false, ...extra },
      );
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.value)).toMatch(/cannot be combined/);
    }
  });

  it('refuses an existing file unless overwrite is true', async () => {
    const { root, scripts, history } = await deps();
    await writeFile(join(scripts, 'Taken.jsx'), 'old');
    const refused = await saveScript(
      { root, history, operations: registry(), scriptsDir: scripts },
      { name: 'Taken', source: 'var a = 1;', overwrite: false },
    );
    expect(refused.isError).toBe(true);
    expect(await readFile(join(scripts, 'Taken.jsx'), 'utf8')).toBe('old');
    const replaced = await saveScript(
      { root, history, operations: registry(), scriptsDir: scripts },
      { name: 'Taken', source: 'var a = 1;', overwrite: true },
    );
    expect(replaced.isError).toBe(false);
  });

  it('keeps the replay mode when source is absent', async () => {
    const { root, scripts, history } = await deps();
    await mkdir(join(root, 'bridge'), { recursive: true });
    await writeFile(join(root, 'bridge', 'current.jsx'), '// payload\n');
    await history.append({ op: 'layer.rename', args: { comp: 'Main', index: 1, name: 'A' }, mutating: true, ok: true });
    const result = await saveScript(
      { root, history, operations: registry(), scriptsDir: scripts },
      { name: 'Replay', overwrite: false },
    );
    expect(result.isError).toBe(false);
    expect(await readFile(join(scripts, 'Replay.jsx'), 'utf8')).toContain('// payload');
  });
});
