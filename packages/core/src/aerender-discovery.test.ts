import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { discoverAerenders } from './aerender-discovery.js';

async function fakeApps(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ae-mcp-aerender-'));
}

async function touch(path: string): Promise<void> {
  await writeFile(path, '#!/bin/sh\n');
}

describe('discoverAerenders', () => {
  it('finds aerender in the version folder next to the app bundle', async () => {
    const dir = await fakeApps();
    const folder = join(dir, 'Adobe After Effects 2026');
    await mkdir(join(folder, 'Adobe After Effects 2026.app'), { recursive: true });
    await touch(join(folder, 'aerender'));

    const installs = await discoverAerenders(dir);
    expect(installs).toEqual([
      {
        appName: 'Adobe After Effects 2026',
        year: 2026,
        path: join(folder, 'Adobe After Effects 2026.app'),
        aerender: join(folder, 'aerender'),
      },
    ]);
  });

  it('falls back to the in-bundle Resources path', async () => {
    const dir = await fakeApps();
    const app = join(dir, 'Adobe After Effects 2026.app');
    await mkdir(join(app, 'Contents', 'Resources'), { recursive: true });
    await touch(join(app, 'Contents', 'Resources', 'aerender'));

    const installs = await discoverAerenders(dir);
    expect(installs[0]?.aerender).toBe(join(app, 'Contents', 'Resources', 'aerender'));
  });

  it('skips installs with no aerender and keeps newest first', async () => {
    const dir = await fakeApps();
    const older = join(dir, 'Adobe After Effects 2025');
    const newer = join(dir, 'Adobe After Effects 2026');
    await mkdir(join(older, 'Adobe After Effects 2025.app'), { recursive: true });
    await mkdir(join(newer, 'Adobe After Effects 2026.app'), { recursive: true });
    await touch(join(newer, 'aerender'));

    const installs = await discoverAerenders(dir);
    expect(installs.map((i) => i.year)).toEqual([2026]);
  });

  it('returns an empty list when the directory is missing', async () => {
    expect(await discoverAerenders('/nope/not/here')).toEqual([]);
  });
});
