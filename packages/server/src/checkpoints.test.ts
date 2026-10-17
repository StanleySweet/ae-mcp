import { chmod, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer, HandlerError } from '@ae-mcp/fake-bridge';
import { errorSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { readCheckpoints } from './checkpoints.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { createServer } from './server.js';
import type { Settings } from './settings.js';

interface Recorded {
  op: string;
  args: unknown;
}

interface HarnessOptions {
  /** Result of project.increment_save; defaults to the next versioned file. */
  increment?: () => unknown;
  settings?: Partial<Settings>;
}

let nextVersion = 8;

async function connect(
  options: HarnessOptions = {},
): Promise<{ client: Client; close: () => Promise<void>; root: string; calls: Recorded[] }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-checkpoints-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  const calls: Recorded[] = [];
  const consumer = createQueueConsumer(root, {
    'project.increment_save': () => {
      calls.push({ op: 'project.increment_save', args: null });
      if (options.increment) {
        return options.increment();
      }
      const file = `/projects/P_v${String(nextVersion).padStart(3, '0')}.aep`;
      nextVersion += 1;
      return { success: true, file };
    },
    'project.open': (args: unknown) => {
      calls.push({ op: 'project.open', args });
      return { success: true };
    },
  });
  await consumer.start();

  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({
    root,
    client: aeClient,
    settings: {
      readOnly: false,
      allowedCategories: null,
      evalEnabled: false,
      incrementBeforeDestructive: true,
      ...options.settings,
    },
  });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    root,
    calls,
    close: async () => {
      await client.close();
      await server.close();
      await consumer.stop();
    },
  };
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; json: Record<string, unknown>; text: string }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  const text = result.content[0]!.text;
  return { isError: result.isError === true, json: JSON.parse(text) as Record<string, unknown>, text };
}

describe('named checkpoints', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  async function start(options?: HarnessOptions) {
    const harness = await connect(options);
    closes.push(harness.close);
    return harness;
  }

  it('checkpoint_create runs an incremental save and records the new file under the name', async () => {
    const { client, root, calls } = await start({
      increment: () => ({ success: true, file: '/projects/P_v042.aep' }),
    });
    const result = await call(client, 'checkpoint_create', { name: 'drive-a' });

    expect(result.isError).toBe(false);
    expect(result.json).toMatchObject({ name: 'drive-a', file: '/projects/P_v042.aep' });
    expect(calls.map((c) => c.op)).toEqual(['project.increment_save']);
    const stored = await readCheckpoints(root);
    expect(stored).toEqual([
      { name: 'drive-a', file: '/projects/P_v042.aep', createdAt: result.json.createdAt },
    ]);
    expect(JSON.parse(await readFile(join(root, 'checkpoints.json'), 'utf8'))).toEqual({
      checkpoints: stored,
    });
  });

  it('checkpoint_create refuses a project that was never saved', async () => {
    const { client, root, calls } = await start({
      increment: () => {
        throw new HandlerError('UNSAVED_PROJECT', 'project has never been saved');
      },
    });
    const result = await call(client, 'checkpoint_create', { name: 'early' });

    expect(result.isError).toBe(true);
    expect(errorSchema.parse(result.json).code).toBe('UNSAVED_PROJECT');
    expect(await readCheckpoints(root)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('checkpoint_create refuses an untitled project with no file', async () => {
    const { client } = await start({ increment: () => ({ success: true, file: null }) });
    const result = await call(client, 'checkpoint_create', { name: 'untitled' });
    expect(result.isError).toBe(true);
    expect(errorSchema.parse(result.json).code).toBe('UNSAVED_PROJECT');
  });

  it('checkpoint_create rejects a name outside 1-64 letters, digits, spaces, _ and -', async () => {
    const { client, calls } = await start();
    for (const name of ['', 'a'.repeat(65), 'bad/name', 'dot.name']) {
      const result = await call(client, 'checkpoint_create', { name });
      expect(result.isError).toBe(true);
      expect(errorSchema.parse(result.json).code).toBe('INVALID_ARGS');
    }
    expect(calls).toEqual([]);
  });

  it('checkpoint_list returns the checkpoints newest first', async () => {
    const { client } = await start({
      increment: (() => {
        let version = 1;
        return () => ({ success: true, file: `/projects/P_v00${version++}.aep` });
      })(),
    });
    await call(client, 'checkpoint_create', { name: 'first' });
    await call(client, 'checkpoint_create', { name: 'second' });
    await call(client, 'checkpoint_create', { name: 'third' });

    const listed = await call(client, 'checkpoint_list');
    const names = (listed.json.checkpoints as Array<{ name: string }>).map((entry) => entry.name);
    expect(names).toEqual(['third', 'second', 'first']);
  });

  it('checkpoint_list is empty before any checkpoint exists', async () => {
    const { client } = await start();
    const listed = await call(client, 'checkpoint_list');
    expect(listed.json).toEqual({ checkpoints: [] });
  });

  it('checkpoint_revert increments first, then reopens the named file with force', async () => {
    const { client, calls } = await start({
      increment: () => ({ success: true, file: '/projects/P_v010.aep' }),
    });
    await call(client, 'checkpoint_create', { name: 'drive-a' });
    calls.length = 0;

    const result = await call(client, 'checkpoint_revert', { name: 'drive-a' });
    expect(result.isError).toBe(false);
    expect(result.json).toMatchObject({ name: 'drive-a', file: '/projects/P_v010.aep' });
    expect(calls).toEqual([
      { op: 'project.increment_save', args: null },
      { op: 'project.open', args: { path: '/projects/P_v010.aep', force: true } },
    ]);
  });

  it('checkpoint_revert refuses an unknown name without touching the project', async () => {
    const { client, calls } = await start();
    const result = await call(client, 'checkpoint_revert', { name: 'nope' });
    expect(result.isError).toBe(true);
    expect(errorSchema.parse(result.json).code).toBe('INVALID_ARGS');
    expect(calls).toEqual([]);
  });

  it('checkpoint_revert and checkpoint_create are refused in read-only mode', async () => {
    const { client, calls } = await start({ settings: { readOnly: true } });

    const created = await call(client, 'checkpoint_create', { name: 'drive-a' });
    expect(created.isError).toBe(true);
    expect(errorSchema.parse(created.json).code).toBe('FORBIDDEN');

    const reverted = await call(client, 'checkpoint_revert', { name: 'drive-a' });
    expect(reverted.isError).toBe(true);
    expect(errorSchema.parse(reverted.json).code).toBe('FORBIDDEN');
    expect(calls).toEqual([]);
  });
});
