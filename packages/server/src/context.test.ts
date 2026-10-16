import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outboxDir } from '@ae-mcp/protocol';
import { describe, it, expect } from 'vitest';
import { buildAeContext } from './context.js';

async function queueRoot(withHeartbeat: boolean): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-context-'));
  const root = join(home, '.ae-mcp');
  await mkdir(outboxDir(root), { recursive: true, mode: 0o700 });
  if (withHeartbeat) {
    await writeFile(
      join(outboxDir(root), 'heartbeat.json'),
      JSON.stringify({
        protocolVersion: 1,
        bridgeVersion: '0.0.0',
        aeVersion: '26.5',
        os: 'Macintosh',
        capabilities: ['comp.create'],
        busy: true,
        transport: 'osascript',
      }),
    );
  }
  return root;
}

describe('buildAeContext', () => {
  it('reports connection details from a fresh heartbeat', async () => {
    const context = await buildAeContext(await queueRoot(true));
    expect(context).toMatchObject({
      connected: true,
      transport: 'osascript',
      aeVersion: '26.5',
      bridgeVersion: '0.0.0',
      capabilities: ['comp.create'],
      busy: true,
    });
    expect(context.heartbeatAgeMs).toBeGreaterThanOrEqual(0);
  });

  it('reports disconnected with a fix when there is no heartbeat', async () => {
    const context = await buildAeContext(await queueRoot(false), { isAeRunning: async () => true });
    expect(context.connected).toBe(false);
    expect(context.fix).toMatch(/Open After Effects/);
  });

  it('reports aeRunning false with a launch fix when no process is running', async () => {
    const context = await buildAeContext(await queueRoot(false), {
      isAeRunning: async () => false,
    });
    expect(context).toMatchObject({
      connected: false,
      aeRunning: false,
      fix: 'Launch After Effects, then retry.',
    });
  });

  it('reports aeRunning true when the process is running', async () => {
    const context = await buildAeContext(await queueRoot(true), {
      isAeRunning: async () => true,
    });
    expect(context).toMatchObject({ connected: true, aeRunning: true });
    expect(context.fix).toBeUndefined();
  });
});