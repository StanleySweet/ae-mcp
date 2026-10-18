import { mkdir, mkdtemp, readFile, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderClean, wildcardToRegExp } from './render-clean.js';

const MINUTE = 60_000;

async function rootWithRenders(): Promise<{ root: string; render: string; outside: string }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-render-clean-'));
  const root = join(home, '.ae-mcp');
  const render = join(root, 'render');
  const outside = join(home, 'outside');
  await mkdir(join(render, 'sub'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(render, 'Main-01.png'), 'a');
  await writeFile(join(render, 'Main-02.png'), 'bb');
  await writeFile(join(render, 'sub', 'Deep-03.png'), 'ccc');
  await writeFile(join(root, 'keep.txt'), 'keep');
  await writeFile(join(outside, 'secret.png'), 'secret');
  return { root, render, outside };
}

describe('renderClean', () => {
  it('lists the files under render/ by default and deletes nothing', async () => {
    const { root, render } = await rootWithRenders();

    const result = await renderClean({ root });

    expect(result.dryRun).toBe(true);
    expect(result.matched.map((f) => f.path).sort()).toEqual(['Main-01.png', 'Main-02.png', join('sub', 'Deep-03.png')].sort());
    expect(result.deleted).toEqual([]);
    expect(await readFile(join(render, 'Main-01.png'), 'utf8')).toBe('a');
  });

  it('deletes the matched files when dryRun is false, and nothing outside render/', async () => {
    const { root, render, outside } = await rootWithRenders();

    const result = await renderClean({ root, dryRun: false });

    expect(result.deleted.length).toBe(3);
    await expect(readFile(join(render, 'Main-01.png'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('keep');
    expect(await readFile(join(outside, 'secret.png'), 'utf8')).toBe('secret');
  });

  it('keeps files younger than olderThanMinutes', async () => {
    const { root, render } = await rootWithRenders();
    const now = Date.now();
    const old = new Date(now - 120 * MINUTE);
    await utimes(join(render, 'Main-01.png'), old, old);

    const result = await renderClean({ root, olderThanMinutes: 60, now });

    expect(result.matched.map((f) => f.path)).toEqual(['Main-01.png']);
  });

  it('keeps only names matching the pattern', async () => {
    const { root } = await rootWithRenders();

    const result = await renderClean({ root, pattern: 'Main-*.png' });

    expect(result.matched.map((f) => f.path).sort()).toEqual(['Main-01.png', 'Main-02.png']);
  });

  it('never follows a symlink that points out of render/', async () => {
    const { root, render, outside } = await rootWithRenders();
    await symlink(join(outside, 'secret.png'), join(render, 'link.png'));
    await symlink(outside, join(render, 'outdir'));

    const listed = await renderClean({ root });
    expect(listed.matched.map((f) => f.path)).not.toContain('link.png');
    expect(listed.matched.map((f) => f.path).some((p) => p.startsWith('outdir'))).toBe(false);
    expect(listed.skipped.sort()).toEqual(['link.png', 'outdir']);

    await renderClean({ root, dryRun: false });
    expect(await readFile(join(outside, 'secret.png'), 'utf8')).toBe('secret');
  });

  it('returns an empty result when there is no render folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-render-clean-none-'));
    const result = await renderClean({ root: join(home, '.ae-mcp'), dryRun: false });
    expect(result.matched).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it('matches wildcards literally apart from * and ?', () => {
    expect(wildcardToRegExp('a.b*').test('a.bc.png')).toBe(true);
    expect(wildcardToRegExp('a.b*').test('axbc.png')).toBe(false);
    expect(wildcardToRegExp('?.png').test('a.png')).toBe(true);
    expect(wildcardToRegExp('?.png').test('ab.png')).toBe(false);
  });
});
