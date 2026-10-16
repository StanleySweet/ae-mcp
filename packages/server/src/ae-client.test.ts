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

function busy(message = 'a script is already running'): ResultMessage {
  return { protocolVersion: PROTOCOL_VERSION, ok: false, error: makeError('AE_BUSY', message) };
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
      checkDialogs: async () => [],
      isAeRunning: async () => true,
    });
    const result = await client.call('echo', {});
    if (result.ok) {
      throw new Error(`expected a timeout, got ${JSON.stringify(result)}`);
    }
    expect(result.error.code).toBe('TIMEOUT');
    expect(result.error.hint).toBe(errorHints.TIMEOUT);
  });

  it('returns AE_NOT_RUNNING on a timeout when no After Effects process runs', async () => {
    const root = await queueRoot();
    const client = createAEClient({
      transport: new FileQueueTransport(root),
      root,
      timeoutMs: 40,
      checkDialogs: async () => [],
      isAeRunning: async () => false,
    });
    const result = await client.call('echo', {});
    if (result.ok) {
      throw new Error(`expected a failure, got ${JSON.stringify(result)}`);
    }
    expect(result.error.code).toBe('AE_NOT_RUNNING');
    expect(result.error.hint).toBe(errorHints.AE_NOT_RUNNING);
  });

  it('returns AE_NOT_RUNNING when the transport throws and no process runs', async () => {
    const transport: Transport = {
      name: 'broken',
      call: () => Promise.reject(new Error('boom')),
    };
    const client = createAEClient({ transport, root: '/unused', isAeRunning: async () => false });
    const result = await client.call('echo');
    expect(result).toMatchObject({ ok: false, error: { code: 'AE_NOT_RUNNING' } });
  });

  it('keeps the TIMEOUT when the process check fails', async () => {
    const root = await queueRoot();
    const client = createAEClient({
      transport: new FileQueueTransport(root),
      root,
      timeoutMs: 40,
      checkDialogs: async () => [],
      isAeRunning: async () => {
        throw new Error('pgrep unavailable');
      },
    });
    const result = await client.call('echo', {});
    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
  });

  it('maps a transport throw to BRIDGE_NOT_LOADED', async () => {
    const transport: Transport = {
      name: 'broken',
      call: () => Promise.reject(new Error('boom')),
    };
    // Stub the process check: CI has no After Effects running (#198).
    const client = createAEClient({ transport, root: '/unused', isAeRunning: async () => true });
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

  it('retries AE_BUSY with exponential backoff until it succeeds', async () => {
    const transport = new RecordingTransport();
    transport.enqueue(busy());
    transport.enqueue(busy());
    transport.enqueue(ok('done'));
    const sleeps: number[] = [];
    const client = createAEClient({
      transport,
      root: '/unused',
      retry: { attempts: 4, baseDelayMs: 100, maxDelayMs: 1000, sleep: async (ms) => void sleeps.push(ms) },
    });

    const result = await client.call('echo');

    expect(result).toMatchObject({ ok: true, result: 'done' });
    expect(transport.jobs).toHaveLength(3);
    expect(sleeps).toEqual([100, 200]);
  });

  // A busy osascript call returns after 120 s; reusing the first job's 30 s
  // deadline made every retry expire before it ran (#183).
  it('gives each AE_BUSY retry a fresh deadline', async () => {
    const transport = new RecordingTransport();
    transport.enqueue(busy());
    transport.enqueue(ok('done'));
    let clock = 0;
    const client = createAEClient({
      transport,
      root: '/unused',
      timeoutMs: 1000,
      now: () => clock,
      retry: { attempts: 2, baseDelayMs: 100, sleep: async () => void (clock += 5000) },
    });

    await client.call('echo');

    expect(transport.jobs.map((job) => job.deadline)).toEqual([1000, 6000]);
  });

  it('gives up after the retry budget and returns the AE_BUSY error', async () => {
    const transport = new RecordingTransport();
    transport.enqueue(busy());
    transport.enqueue(busy());
    transport.enqueue(busy());
    const sleeps: number[] = [];
    const client = createAEClient({
      transport,
      root: '/unused',
      retry: { attempts: 3, baseDelayMs: 50, maxDelayMs: 1000, sleep: async (ms) => void sleeps.push(ms) },
    });

    const result = await client.call('echo');

    if (result.ok) {
      throw new Error(`expected a failure, got ${JSON.stringify(result)}`);
    }
    expect(result.error.code).toBe('AE_BUSY');
    expect(transport.jobs).toHaveLength(3);
    expect(sleeps).toEqual([50, 100]);
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
    const old = new Date(Date.now() - 120_000);
    await utimes(heartbeat, old, old);

    const transport: Transport = {
      name: 'timeout',
      call: async () => ({
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: makeError('TIMEOUT', 'job exceeded its deadline'),
      }),
    };
    const client = createAEClient({
      transport,
      root,
      checkDialogs: async () => [],
      isAeRunning: async () => true,
    });
    const result = await client.call('echo');
    if (result.ok) {
      throw new Error(`expected a failure, got ${JSON.stringify(result)}`);
    }
    expect(result.error.message).toMatch(/modal dialog/);
    expect(result.error.hint).toMatch(/Close the dialog/);
  });

  it('returns DIALOG_OPEN with the dialog text when a timeout finds a dialog', async () => {
    const root = await queueRoot();
    const transport: Transport = {
      name: 'timeout',
      call: async () => ({
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: makeError('TIMEOUT', 'job exceeded its deadline'),
      }),
    };
    const client = createAEClient({
      transport,
      root,
      checkDialogs: async () => [{ title: 'Warning', texts: ['Save changes?'] }],
      isAeRunning: async () => true,
    });
    const result = await client.call('echo');
    if (result.ok) {
      throw new Error(`expected a failure, got ${JSON.stringify(result)}`);
    }
    expect(result.error.code).toBe('DIALOG_OPEN');
    expect(result.error.message).toContain('Warning - Save changes?');
    expect(result.error.hint).toBe(errorHints.DIALOG_OPEN);
  });

  it('keeps the TIMEOUT when the dialog check fails', async () => {
    const root = await queueRoot();
    const transport: Transport = {
      name: 'timeout',
      call: async () => ({
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: makeError('TIMEOUT', 'job exceeded its deadline'),
      }),
    };
    const client = createAEClient({
      transport,
      root,
      checkDialogs: async () => {
        throw new Error('boom');
      },
      isAeRunning: async () => true,
    });
    const result = await client.call('echo');
    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
  });
});
