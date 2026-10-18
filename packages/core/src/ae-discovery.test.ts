import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { MIN_SUPPORTED_AE_YEAR, discoverAEVersions } from './ae-discovery.js';

async function fakeApplications(...names: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ae-mcp-apps-'));
  for (const name of names) {
    await mkdir(join(dir, name), { recursive: true });
  }
  return dir;
}

describe('discoverAEVersions', () => {
  it('returns supported versions newest first and ignores older ones', async () => {
    const dir = await fakeApplications(
      'Adobe After Effects 2024',
      'Adobe After Effects 2026.app',
      'Adobe After Effects 2025.app',
      'Adobe Photoshop 2025.app',
      'Safari.app',
    );
    await mkdir(join(dir, 'Adobe After Effects 2024', 'Adobe After Effects 2024.app'), {
      recursive: true,
    });
    const installs = await discoverAEVersions(dir);
    expect(installs.map((i) => i.year)).toEqual([2026, 2025]);
    expect(installs[0]).toMatchObject({
      appName: 'Adobe After Effects 2026',
      path: join(dir, 'Adobe After Effects 2026.app'),
    });
  });

  it('finds the nested versioned-folder layout', async () => {
    const dir = await fakeApplications('Adobe After Effects 2026');
    await mkdir(join(dir, 'Adobe After Effects 2026', 'Adobe After Effects 2026.app'), {
      recursive: true,
    });
    const installs = await discoverAEVersions(dir);
    expect(installs).toEqual([
      {
        appName: 'Adobe After Effects 2026',
        year: 2026,
        path: join(dir, 'Adobe After Effects 2026', 'Adobe After Effects 2026.app'),
        beta: false,
      },
    ]);
  });

  it('ignores a versioned folder with no app bundle inside', async () => {
    const dir = await fakeApplications('Adobe After Effects 2025');
    expect(await discoverAEVersions(dir)).toEqual([]);
  });

  it('returns an empty list when the directory is missing', async () => {
    expect(await discoverAEVersions('/nope/not/here')).toEqual([]);
  });

  it('returns an empty list when nothing supported is installed', async () => {
    const dir = await fakeApplications('Adobe After Effects 2024.app');
    expect(await discoverAEVersions(dir)).toEqual([]);
  });

  it('lists the beta after the stable installs, with its major version as year', async () => {
    const dir = await fakeApplications('Adobe After Effects 2026.app', 'Adobe After Effects (Beta).app');
    const beta = join(dir, 'Adobe After Effects (Beta).app');
    await mkdir(join(beta, 'Contents'), { recursive: true });
    await writeFile(
      join(beta, 'Contents', 'Info.plist'),
      '<key>CFBundleShortVersionString</key>\n<string>27.1.0</string>',
    );
    const installs = await discoverAEVersions(dir);
    expect(installs).toEqual([
      { appName: 'Adobe After Effects 2026', year: 2026, path: join(dir, 'Adobe After Effects 2026.app'), beta: false },
      { appName: 'Adobe After Effects (Beta)', year: 2027, path: beta, beta: true },
    ]);
  });

  it('finds the beta in the versioned folder layout', async () => {
    const dir = await fakeApplications('Adobe After Effects (Beta)');
    await mkdir(join(dir, 'Adobe After Effects (Beta)', 'Adobe After Effects (Beta).app'), { recursive: true });
    const installs = await discoverAEVersions(dir);
    expect(installs).toEqual([
      {
        appName: 'Adobe After Effects (Beta)',
        year: MIN_SUPPORTED_AE_YEAR,
        path: join(dir, 'Adobe After Effects (Beta)', 'Adobe After Effects (Beta).app'),
        beta: true,
      },
    ]);
  });

  it('gives the beta the newest stable year + 1 when its version is unreadable', async () => {
    const dir = await fakeApplications('Adobe After Effects 2026.app', 'Adobe After Effects (Beta).app');
    const installs = await discoverAEVersions(dir);
    expect(installs.map((i) => [i.appName, i.year, i.beta])).toEqual([
      ['Adobe After Effects 2026', 2026, false],
      ['Adobe After Effects (Beta)', 2027, true],
    ]);
  });
});
