import { mkdtemp, readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { backupFolder, backupStamp, copyToBackups } from './backup.js';

async function fixture(): Promise<{ root: string; saved: string }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-backup-'));
  const root = join(home, '.ae-mcp');
  const projects = join(home, 'Projects');
  await mkdir(root, { recursive: true });
  await mkdir(projects, { recursive: true });
  const saved = join(projects, 'Latent.aep');
  await writeFile(saved, 'version one');
  return { root, saved };
}

const at = (iso: string): Date => new Date(iso);

describe('copyToBackups', () => {
  it('writes the backup folder under <root>/backups/<project name>', () => {
    expect(backupFolder('/r', '/Users/me/Documents/Latent.aep')).toBe('/r/backups/Latent');
  });

  it('formats the increment stamp as YYYYMMDD-HHMMSS in local time', () => {
    expect(backupStamp(new Date(2026, 9, 18, 7, 5, 9))).toBe('20261018-070509');
  });

  it('single mode overwrites one <name>.backup.aep and leaves the open project alone', async () => {
    const { root, saved } = await fixture();
    const first = await copyToBackups(root, saved, 'single', 5);
    expect(first).toBe(join(root, 'backups', 'Latent', 'Latent.backup.aep'));
    expect(await readFile(first!, 'utf8')).toBe('version one');

    await writeFile(saved, 'version two');
    const second = await copyToBackups(root, saved, 'single', 5);
    expect(second).toBe(first);
    expect(await readFile(second!, 'utf8')).toBe('version two');
    expect(await readdir(backupFolder(root, saved))).toEqual(['Latent.backup.aep']);
    expect(await readFile(saved, 'utf8')).toBe('version two');
  });

  it('increment mode adds a timestamped copy per call', async () => {
    const { root, saved } = await fixture();
    const copy = await copyToBackups(root, saved, 'increment', 5, at('2026-10-18T09:30:00'));
    expect(copy).toBe(join(root, 'backups', 'Latent', 'Latent-20261018-093000.aep'));
    expect(await readFile(copy!, 'utf8')).toBe('version one');
  });

  it('increment mode keeps the newest backupKeep copies and deletes the oldest', async () => {
    const { root, saved } = await fixture();
    const stamps = ['2026-10-18T09:00:00', '2026-10-18T09:01:00', '2026-10-18T09:02:00', '2026-10-18T09:03:00'];
    for (const stamp of stamps) {
      await copyToBackups(root, saved, 'increment', 2, at(stamp));
    }
    expect((await readdir(backupFolder(root, saved))).sort()).toEqual([
      'Latent-20261018-090200.aep',
      'Latent-20261018-090300.aep',
    ]);
  });

  it('increment mode does not delete files that only share the project name as a prefix', async () => {
    const { root, saved } = await fixture();
    const folder = backupFolder(root, saved);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'Latent-Old-20200101-000000.aep'), 'other');
    await writeFile(join(folder, 'Latent.backup.aep'), 'single');
    await copyToBackups(root, saved, 'increment', 1, at('2026-10-18T09:00:00'));
    await copyToBackups(root, saved, 'increment', 1, at('2026-10-18T09:01:00'));
    const names = (await readdir(folder)).sort();
    expect(names).toEqual(['Latent-20261018-090100.aep', 'Latent-Old-20200101-000000.aep', 'Latent.backup.aep']);
  });

  it('never overwrites an increment copy made in the same second', async () => {
    const { root, saved } = await fixture();
    const now = at('2026-10-18T09:00:00');
    const first = await copyToBackups(root, saved, 'increment', 5, now);
    await writeFile(saved, 'version two');
    const second = await copyToBackups(root, saved, 'increment', 5, now);
    expect(second).not.toBe(first);
    expect(await readFile(first!, 'utf8')).toBe('version one');
    expect(await readFile(second!, 'utf8')).toBe('version two');
  });

  it('off mode copies nothing and creates no folder', async () => {
    const { root, saved } = await fixture();
    expect(await copyToBackups(root, saved, 'off', 5)).toBeNull();
    await expect(stat(join(root, 'backups'))).rejects.toThrow();
  });
});
