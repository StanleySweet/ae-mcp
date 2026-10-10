import { mkdir, mkdtemp, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer } from '@ae-mcp/fake-bridge';
import {
  PROTOCOL_VERSION,
  errorHints,
  inboxDir,
  makeError,
  outboxDir,
  type JobMessage,
  type ResultMessage,
} from '@ae-mcp/protocol';
import { describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import type { Transport } from './transport.js';

async function queueRoot(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-client-'));
  return join(home, '.ae-mcp');
}

class RecordingTransport implements Transport {
  readonly name = 'recording';
  readonly jobs: JobMessage[] = [];
  private readonly results: ResultMessage[] = [];

  enqueue(result: ResultMessage): void {
    this.results.push(result);
  }

  async call(job: JobMessage): Promise<ResultMessage> {
    this.jobs.push(job);
    const result = this.results.shift();
    if (result === undefined) {
      throw new Error('no queued result');
    }
    return result;
  }
}

function ok(result: unknown): ResultMessage {
  return { protocolVersion: PROTOCOL_VERSION, ok: true, result };
}

describe('ae client', () => {
  it('assigns a unique id and a deadline offset by the timeout', async () => {
    const transport = new RecordingTransport();
    transport.enqueue(ok('a'));
    transport.enqueue(ok('b'));
    const client = createAEClient({ transport, root: '/unused', timeoutMs: 1000 });

    const before = Date.now();
    const first = await client.call('echo', { n: 1 });
    const second = await client.call('echo', { n: 2 });

    expect(transport.jobs).toHaveLength(2);
    expect(transport.jobs[0]!.id).not.toBe(transport.jobs[1]!.id);
    expect(transport.jobs[0]!.deadline - before).toBeGreaterThanOrEqual(1000);
    expect(first).toMatchObject({ ok: true, result: 'a' });
    expect(second).toMatchObject({ ok: true, result: 'b' });
  });

  it('correlates results to their request against the fake bridge', async () => {
    const root = await queueRoot();
    const consumer = createQueueConsumer(root, { echo: (args) => args });
    await consumer.start();
    try {
      const client = createAEClient({ transport: new FileQueueTransport(root), root });
      const [a, b] = await Promise.all([
        client.call('echo', { n: 1 }),
        client.call('echo', { n: 2 }),
      ]);
      expect(a).toMatchObject({ ok: true, result: { n: 1 } });
      expect(b).toMatchObject({ ok: true, result: { n: 2 } });
    } finally {
      await consumer.stop();
    }
  });

  it('returns a TIMEOUT error with the canonical hint', async () => {
    const root = await queueRoot();
    const client = createAEClient({
      transport: new FileQueueTransport(root),
      root,
      timeoutMs: 40,
    });
    const result = await client.call('echo', {});
    if (result.ok) {
      throw new Error(`expected a timeout, got ${JSON.stringify(result)}`);
    }
    expect(result.error.code).toBe('TIMEOUT');
    expect(result.error.hint).toBe(errorHints.TIMEOUT);
  });

  it('maps a transport throw to BRIDGE_NOT_LOADED', async () => {
    const transport: Transport = {
      name: 'broken',
      call: () => Promise.reject(new Error('boom')),
    };
    const client = createAEClient({ transport, root: '/unused' });
    const result = await client.call('echo');
    if (result.ok) {
      throw new Error(`expected a failure, got ${JSON.stringify(result)}`);
    }
    expect(result.error.code).toBe('BRIDGE_NOT_LOADED');
  });

  it('purges stale queue files and keeps fresh ones', async () => {
    const root = await queueRoot();
    await mkdir(inboxDir(root), { recursive: true });
    await mkdir(outboxDir(root), { recursive: true });
    const stale = new Date(Date.now() - 10 * 60_000);
    const oldInbox = join(inboxDir(root), 'old.json');
    const oldOutbox = join(outboxDir(root), 'old.json');
    const freshInbox = join(inboxDir(root), 'fresh.json');
    for (const path of [oldInbox, oldOutbox, freshInbox]) {
      await writeFile(path, '{}');
    }
    await utimes(oldInbox, stale, stale);
    await utimes(oldOutbox, stale, stale);

    const client = createAEClient({ transport: new FileQueueTransport(root), root });
    expect(await client.purgeStale()).toBe(2);
    await expect(stat(freshInbox)).resolves.toBeDefined();
    await expect(stat(oldInbox)).rejects.toThrow();
    await expect(stat(oldOutbox)).rejects.toThrow();
  });

  it('reports a modal-dialog stall instead of a bare timeout', async () => {
    const root = await queueRoot();
    await mkdir(outboxDir(root), { recursive: true });
    const heartbeat = join(outboxDir(root), 'heartbeat.json');
    await writeFile(
      heartbeat,
      JSON.stringify({
        protocolVersion: 1,
        bridgeVersion: '0.0.0',
        aeVersion: '26.5',
        os: 'Macintosh',
        capabilities: [],
        busy: true,
        transport: 'startup-loader',
      }),
    );
    const old = new Date(Date.now() - 5 * 60_000);
    await utimes(heartbeat, old, old);

    const transport: Transport = {
      name: 'timeout',
      call: async () => ({
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: makeError('TIMEOUT', 'job exceeded its deadline'),
      }),
    };
    const client = createAEClient({ transport, root });
    const result = await client.call('echo');
    if (result.ok) {
      throw new Error(`expected a failure, got ${JSON.stringify(result)}`);
    }
    expect(result.error.message).toMatch(/modal dialog/);
    expect(result.error.hint).toMatch(/Close the dialog/);
  });
});