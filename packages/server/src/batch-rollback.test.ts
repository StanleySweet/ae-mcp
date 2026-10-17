import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect } from 'vitest';
import type { AEClient } from './ae-client.js';
import { createServer } from './server.js';
import { DEFAULT_SETTINGS } from './settings.js';

// Undo inside the batch script raised AE's modal "Undo group mismatch", so the
// bridge only flags the rollback and the server undoes in a separate job (#258).
async function connect(batchError: Record<string, unknown>): Promise<{ client: Client; calls: string[] }> {
  const calls: string[] = [];
  const aeClient: AEClient = {
    purgeStale: async () => 0,
    call: async (tool) => {
      calls.push(tool);
      if (tool === 'batch.run') return { protocolVersion: 1, ok: false, error: batchError as never };
      return { protocolVersion: 1, ok: true, result: null };
    },
  };
  const server = createServer({
    client: aeClient,
    settings: { ...DEFAULT_SETTINGS, incrementBeforeDestructive: false },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, calls };
}

const ops = { ops: [{ op: 'layer.rename', args: { index: 1, name: 'A' } }] };

describe('batch.run rollback', () => {
  it('runs project.undo as a separate job when the bridge flags a rollback', async () => {
    const { client, calls } = await connect({ code: 'SCRIPT_ERROR', message: 'batch rolled back', rollback: true });

    const result = await client.callTool({ name: 'ae_do', arguments: { op: 'batch.run', args: ops } });

    expect(result.isError).toBe(true);
    expect(calls).toEqual(['batch.run', 'project.undo']);
    const [first] = result.content as Array<{ text: string }>;
    expect(JSON.parse(first!.text)).not.toHaveProperty('rollback');
  });

  it('does not undo when the bridge did not flag a rollback', async () => {
    const { client, calls } = await connect({ code: 'SCRIPT_ERROR', message: 'boom' });

    await client.callTool({ name: 'ae_do', arguments: { op: 'batch.run', args: ops } });

    expect(calls).toEqual(['batch.run']);
  });
});
