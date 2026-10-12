import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { claudeConfigDir, discoverClaudeDesktop } from './claude-discovery.js';

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe('discoverClaudeDesktop', () => {
  it('finds Claude.app and computes the config paths', async () => {
    const applicationsDir = await tempDir('ae-mcp-apps-');
    const homeDir = await tempDir('ae-mcp-home-');
    await mkdir(join(applicationsDir, 'Claude.app'), { recursive: true });

    const found = await discoverClaudeDesktop({ applicationsDir, homeDir });

    expect(found).toEqual({
      appName: 'Claude',
      path: join(applicationsDir, 'Claude.app'),
      configDir: join(homeDir, 'Library', 'Application Support', 'Claude'),
      configPath: join(
        homeDir,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      ),
    });
  });

  it('returns null when Claude.app is not installed', async () => {
    const applicationsDir = await tempDir('ae-mcp-apps-');
    const homeDir = await tempDir('ae-mcp-home-');
    await mkdir(join(applicationsDir, 'Safari.app'), { recursive: true });

    expect(await discoverClaudeDesktop({ applicationsDir, homeDir })).toBeNull();
  });

  it('returns null when the applications directory is missing', async () => {
    const homeDir = await tempDir('ae-mcp-home-');
    expect(
      await discoverClaudeDesktop({ applicationsDir: '/nope/not/here', homeDir }),
    ).toBeNull();
  });
});

describe('claudeConfigDir', () => {
  it('points at the Claude config directory under the given home', () => {
    expect(claudeConfigDir('/Users/example')).toBe(
      join('/Users/example', 'Library', 'Application Support', 'Claude'),
    );
  });
});
