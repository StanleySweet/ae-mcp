import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { discoverAeExtensions } from './ae-extensions.js';

describe('discoverAeExtensions', () => {
  it('lists user and system extension folders, sorted by name', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const userDir = join(home, 'Library/Application Support/Adobe/CEP/extensions');
    await mkdir(join(userDir, 'com.misterhorse.animationcomposer'), { recursive: true });
    const systemDir = await mkdtemp(join(tmpdir(), 'ae-mcp-sys-'));
    await mkdir(join(systemDir, 'com.mtmograph.motion'), { recursive: true });

    const found = await discoverAeExtensions({ homeDir: home, systemDir });

    expect(found).toEqual([
      {
        name: 'com.misterhorse.animationcomposer',
        path: join(userDir, 'com.misterhorse.animationcomposer'),
        scope: 'user',
      },
      {
        name: 'com.mtmograph.motion',
        path: join(systemDir, 'com.mtmograph.motion'),
        scope: 'system',
      },
    ]);
  });

  it('ignores files and returns [] when the folders are missing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-home-'));
    const userDir = join(home, 'Library/Application Support/Adobe/CEP/extensions');
    await mkdir(userDir, { recursive: true });
    await mkdir(join(userDir, 'not-a-dir'), { recursive: true });
    const found = await discoverAeExtensions({ homeDir: home, systemDir: join(home, 'missing') });
    expect(found.map((e) => e.name)).toEqual(['not-a-dir']);
  });
});
