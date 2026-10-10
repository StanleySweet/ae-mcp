import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outboxDir, type HeartbeatMessage } from '@ae-mcp/protocol';
import { describe, it, expect } from 'vitest';
import { detectStall } from './stall.js';

function beat(busy: boolean): HeartbeatMessage {
  return {
    protocolVersion: 1,
    bridgeVersion: '0.0.0',
    aeVersion: '26.5',
    os: 'Macintosh',
    capabilities: [],
    busy,
    transport: 'startup-loader',
  };
}

async function rootWithHeartbeat(busy: boolean, stale: boolean): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-stall-'));
  const root = join(home, '.ae-mcp');
  const dir = outboxDir(root);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'heartbeat.json');
  await writeFile(file, JSON.stringify(beat(busy)));
  if (stale) {
    const old = new Date(Date.now() - 5 * 60_000);
    await utimes(file, old, old);
  }
  return root;
}

describe('detectStall', () => {
  it('flags a stall when the heartbeat is stale and the last beat was busy', async () => {
    const stall = await detectStall(await rootWithHeartbeat(true, true));
    expect(stall).toMatchObject({ stalled: true });
  });

  it('does not flag a stall when a stale heartbeat was idle', async () => {
    const stall = await detectStall(await rootWithHeartbeat(false, true));
    expect(stall).toEqual({ stalled: false, reason: 'idle' });
  });

  it('does not flag a stall when the heartbeat is fresh even if busy', async () => {
    const stall = await detectStall(await rootWithHeartbeat(true, false));
    expect(stall).toEqual({ stalled: false, reason: 'fresh' });
  });

  it('reports no_heartbeat when nothing is running', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-stall-'));
    const stall = await detectStall(join(home, '.ae-mcp'));
    expect(stall).toEqual({ stalled: false, reason: 'no_heartbeat' });
  });
});