import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { detectEnvironment } from './environment.js';

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe('detectEnvironment', () => {
  it('reports AE installs and the Claude Desktop install together', async () => {
    const applicationsDir = await tempDir('ae-mcp-apps-');
    const homeDir = await tempDir('ae-mcp-home-');
    await mkdir(join(applicationsDir, 'Adobe After Effects 2026.app'), { recursive: true });
    await mkdir(join(applicationsDir, 'Claude.app'), { recursive: true });

    const env = await detectEnvironment({ applicationsDir, homeDir });

    expect(env.afterEffects).toEqual([
      {
        appName: 'Adobe After Effects 2026',
        year: 2026,
        path: join(applicationsDir, 'Adobe After Effects 2026.app'),
      },
    ]);
    expect(env.claudeDesktop?.path).toBe(join(applicationsDir, 'Claude.app'));
  });

  it('returns empty installs and null Claude when nothing is installed', async () => {
    const applicationsDir = await tempDir('ae-mcp-apps-');
    const homeDir = await tempDir('ae-mcp-home-');

    const env = await detectEnvironment({ applicationsDir, homeDir });

    expect(env.afterEffects).toEqual([]);
    expect(env.claudeDesktop).toBeNull();
  });
});
