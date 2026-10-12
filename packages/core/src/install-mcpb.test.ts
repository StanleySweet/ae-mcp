import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import type { ClaudeDesktopInstall } from './claude-discovery.js';
import { claudeOpenArgs, handMcpbToClaude } from './install-mcpb.js';

const CLAUDE: ClaudeDesktopInstall = {
  appName: 'Claude',
  path: '/Applications/Claude.app',
  configDir: '/Users/example/Library/Application Support/Claude',
  configPath: '/Users/example/Library/Application Support/Claude/claude_desktop_config.json',
};

async function fakeMcpb(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ae-mcp-mcpb-'));
  const path = join(dir, 'ae-mcp.mcpb');
  await writeFile(path, 'zip bytes');
  return path;
}

describe('claudeOpenArgs', () => {
  it('opens the bundle with Claude Desktop', () => {
    expect(claudeOpenArgs('/tmp/ae-mcp.mcpb')).toEqual(['-a', 'Claude', '/tmp/ae-mcp.mcpb']);
  });
});

describe('handMcpbToClaude', () => {
  it('hands the bundle to Claude Desktop', async () => {
    const mcpbPath = await fakeMcpb();
    const openFile = vi.fn(async () => true);

    const result = await handMcpbToClaude({ mcpbPath, claude: CLAUDE, openFile });

    expect(result).toMatchObject({ check: 'claude_extension', status: 'ok', handed: true, path: mcpbPath });
    expect(openFile).toHaveBeenCalledWith(mcpbPath);
  });

  it('reports a fix when Claude Desktop is not installed', async () => {
    const openFile = vi.fn(async () => true);

    const result = await handMcpbToClaude({
      mcpbPath: '/tmp/ae-mcp.mcpb',
      claude: null,
      openFile,
    });

    expect(result.status).toBe('fail');
    expect(result.fix).toBeTruthy();
    expect(openFile).not.toHaveBeenCalled();
  });

  it('reports a fix when the bundle is missing', async () => {
    const openFile = vi.fn(async () => true);

    const result = await handMcpbToClaude({
      mcpbPath: '/nope/ae-mcp.mcpb',
      claude: CLAUDE,
      openFile,
    });

    expect(result.status).toBe('fail');
    expect(result.fix).toBeTruthy();
    expect(openFile).not.toHaveBeenCalled();
  });

  it('reports a fix when Claude declines to open the bundle', async () => {
    const mcpbPath = await fakeMcpb();
    const openFile = vi.fn(async () => false);

    const result = await handMcpbToClaude({ mcpbPath, claude: CLAUDE, openFile });

    expect(result.status).toBe('fail');
    expect(result.fix).toBeTruthy();
  });
});
