import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outboxDir } from '@ae-mcp/protocol';
import { describe, it, expect } from 'vitest';
import { launchAE } from './launch.js';

async function makeRoot(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-launch-'));
  const root = join(home, '.ae-mcp');
  await mkdir(outboxDir(root), { recursive: true, mode: 0o700 });
  return root;
}

async function writeHeartbeat(root: string): Promise<void> {
  await writeFile(
    join(outboxDir(root), 'heartbeat.json'),
    JSON.stringify({
      protocolVersion: 1,
      bridgeVersion: '0.0.0',
      aeVersion: '26.5',
      os: 'Macintosh',
      capabilities: [],
      busy: false,
      transport: 'startup-loader',
    }),
  );
}

describe('launchAE', () => {
  it('returns ready without launching when a heartbeat is already fresh', async () => {
    const root = await makeRoot();
    await writeHeartbeat(root);
    let launched = false;
    const result = await launchAE({
      root,
      runner: async () => {
        launched = true;
        return { stdout: '' };
      },
    });
    expect(result).toEqual({ status: 'ready', waitedMs: 0 });
    expect(launched).toBe(false);
  });

  it('launches and waits for the heartbeat to appear', async () => {
    const root = await makeRoot();
    const result = await launchAE({
      root,
      runner: async () => {
        await writeHeartbeat(root);
        return { stdout: '' };
      },
    });
    expect(result.status).toBe('ready');
  });

  it('reports a timeout when no heartbeat appears', async () => {
    const root = await makeRoot();
    const result = await launchAE({
      root,
      runner: async () => ({ stdout: '' }),
      timeoutMs: 40,
      pollMs: 10,
    });
    expect(result.status).toBe('timeout');
  });

  it('reports launch_failed when open fails', async () => {
    const root = await makeRoot();
    const result = await launchAE({
      root,
      runner: async () => {
        throw new Error('open: no such application');
      },
    });
    expect(result).toMatchObject({ status: 'launch_failed' });
  });
});