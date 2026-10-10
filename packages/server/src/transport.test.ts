import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer } from '@ae-mcp/fake-bridge';
import { PROTOCOL_VERSION, errorHints, type JobMessage } from '@ae-mcp/protocol';
import { describe, it, expect } from 'vitest';
import { FileQueueTransport } from './file-queue-transport.js';

async function queueRoot(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-fqt-'));
  return join(home, '.ae-mcp');
}

function job(id: string, tool: string, args: unknown, deadline = Date.now() + 5000): JobMessage {
  return { protocolVersion: PROTOCOL_VERSION, id, tool, args, deadline };
}

describe('file queue transport', () => {
  it('round trips a job through the fake bridge, correlated by id', async () => {
    const root = await queueRoot();
    const consumer = createQueueConsumer(root, { echo: (args) => args });
    await consumer.start();
    try {
      const transport = new FileQueueTransport(root);
      const result = await transport.call(job('t-roundtrip', 'echo', { n: 1 }));
      expect(result).toMatchObject({ ok: true, result: { n: 1 } });
    } finally {
      await consumer.stop();
    }
  });

  it('surfaces an error result from the bridge', async () => {
    const root = await queueRoot();
    const consumer = createQueueConsumer(root, {
      boom: () => {
        throw new Error('kaboom');
      },
    });
    await consumer.start();
    try {
      const transport = new FileQueueTransport(root);
      const result = await transport.call(job('t-boom', 'boom', {}));
      if (result.ok) {
        throw new Error(`expected a failure, got ${JSON.stringify(result)}`);
      }
      expect(result.error.code).toBe('SCRIPT_ERROR');
    } finally {
      await consumer.stop();
    }
  });

  it('returns a TIMEOUT error with the canonical hint when nothing answers', async () => {
    const root = await queueRoot();
    const transport = new FileQueueTransport(root);
    const result = await transport.call(job('t-timeout', 'echo', {}, Date.now() - 1));
    if (result.ok) {
      throw new Error(`expected a timeout, got ${JSON.stringify(result)}`);
    }
    expect(result.error.code).toBe('TIMEOUT');
    expect(result.error.hint).toBe(errorHints.TIMEOUT);
  });
});