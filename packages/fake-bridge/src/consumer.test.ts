import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  PROTOCOL_VERSION,
  inboxDir,
  outboxDir,
  writeAtomic,
  type ResultMessage,
} from '@ae-mcp/protocol';
import { describe, it, expect } from 'vitest';
import { createQueueConsumer } from './consumer.js';
import { FakeProject } from './project.js';

async function resultFile(root: string, id: string): Promise<ResultMessage | undefined> {
  try {
    return JSON.parse(await readFile(join(outboxDir(root), `${id}.json`), 'utf8'));
  } catch {
    return undefined;
  }
}

async function waitForResult(root: string, id: string, timeoutMs = 5000): Promise<ResultMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await resultFile(root, id);
    if (res !== undefined) {
      return res;
    }
    await delay(25);
  }
  throw new Error(`timed out waiting for result ${id}`);
}

async function withQueue<T>(handlers: Record<string, (args: unknown) => unknown>, pollMs: number, fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'ae-mcp-fakebridge-'));
  const consumer = createQueueConsumer(root, handlers, pollMs);
  await consumer.start();
  try {
    return await fn(root);
  } finally {
    await consumer.stop();
    await rm(root, { recursive: true, force: true });
  }
}

describe('fake queue consumer', () => {
  it('consumes a job and writes a correlated result', async () => {
    await withQueue({ 'fake.echo': (args) => args }, 10, async (root) => {
      await writeAtomic(
        join(inboxDir(root), '1.json'),
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          id: '1',
          tool: 'fake.echo',
          args: { ping: true },
          deadline: Date.now() + 5000,
        }),
      );
      const res = await waitForResult(root, '1');
      if (!res.ok) throw new Error(`expected ok result, got ${JSON.stringify(res.error)}`);
      expect(res.result).toEqual({ ping: true });
    });
  });

  it('removes the job file after processing it', async () => {
    await withQueue({ 'fake.echo': (args) => args }, 10, async (root) => {
      await writeAtomic(
        join(inboxDir(root), '2.json'),
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          id: '2',
          tool: 'fake.echo',
          args: {},
          deadline: Date.now() + 5000,
        }),
      );
      await waitForResult(root, '2');
      expect(await readdir(inboxDir(root))).toEqual([]);
    });
  });

  it('stops consuming when stopped', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-fakebridge-'));
    const consumer = createQueueConsumer(root, { 'fake.echo': (args) => args }, 1000);
    await consumer.start();
    try {
      await consumer.stop();
      await writeAtomic(
        join(inboxDir(root), '3.json'),
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          id: '3',
          tool: 'fake.echo',
          args: {},
          deadline: Date.now() + 5000,
        }),
      );
      await delay(150);
      expect((await readdir(inboxDir(root))).length).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('in-memory project model', () => {
  it('adds a comp with a stable id', () => {
    const project = new FakeProject();
    const comp = project.addComp('Shots', 1920, 1080);
    expect(comp.id).toBeGreaterThan(0);
    expect(project.comps.length).toBe(1);
    expect(comp.layers).toEqual([]);
  });
});