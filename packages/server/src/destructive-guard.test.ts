import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer, FakeProject, observeHandlers } from '@ae-mcp/fake-bridge';
import { errorSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { OperationRegistry } from './operations.js';
import { createServer } from './server.js';
import type { Settings } from './settings.js';

function registry(): OperationRegistry {
  const registry = new OperationRegistry();
  registry.register({
    name: 'layer.rename',
    category: 'layer',
    description: 'Rename a layer.',
    readOnly: false,
    destructive: false,
    schema: { index: { type: 'number' }, name: { type: 'string' } },
  });
  registry.register({
    name: 'layer.delete',
    category: 'layer',
    description: 'Delete a layer.',
    readOnly: false,
    destructive: true,
    schema: { index: { type: 'number' } },
  });
  registry.register({
    name: 'batch.run',
    category: 'batch',
    description: 'Run many operations as one undo step.',
    readOnly: false,
    destructive: false,
    schema: {
      ops: { type: 'array', items: { type: 'object' } },
    },
  });
  return registry;
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    readOnly: false,
    allowedCategories: null,
    evalEnabled: false,
    incrementBeforeDestructive: true,
    ...overrides,
  };
}

interface HarnessOptions {
  incrementResult?: unknown;
  settings?: Settings;
}

async function connectServer(
  project: FakeProject,
  calls: string[],
  options: HarnessOptions = {},
): Promise<{ client: Client; close: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-guard-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  const handlers = {
    ...observeHandlers(project),
    'project.increment_save': () => {
      calls.push('project.increment_save');
      return options.incrementResult ?? { success: true, file: '/projects/P_v008.aep' };
    },
    'layer.rename': (args: unknown) => {
      calls.push('layer.rename');
      return args;
    },
    'layer.delete': (args: unknown) => {
      calls.push('layer.delete');
      return { deleted: (args as { index: number }).index };
    },
    'batch.run': () => {
      calls.push('batch.run');
      return { results: [] };
    },
  };
  const consumer = createQueueConsumer(root, handlers);
  await consumer.start();

  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({
    root,
    client: aeClient,
    operations: registry(),
    settings: options.settings ?? settings(),
  });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
      await consumer.stop();
    },
  };
}

async function call(
  client: Client,
  op: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name: 'ae_do', arguments: { op, args } });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return { isError: result.isError === true, text: first!.text };
}

function project(): FakeProject {
  const project = new FakeProject();
  const comp = project.addComp('Main', 1920, 1080);
  project.addLayer(comp, 'Layer 1');
  return project;
}

describe('E13-3 destructive guard', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  it('increments the project before a destructive operation', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const result = await call(client, 'layer.delete', { index: 1 });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['project.increment_save', 'layer.delete']);
  });

  it('does not increment before a non-destructive operation', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const result = await call(client, 'layer.rename', { index: 1, name: 'Hero' });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['layer.rename']);
  });

  it('refuses a destructive operation when the project has never been saved', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      incrementResult: { success: false, error: 'project has never been saved' },
    });
    closes.push(close);

    const result = await call(client, 'layer.delete', { index: 1 });
    expect(result.isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(result.text));
    expect(error.code).toBe('UNSAVED_PROJECT');
    expect(calls).toEqual(['project.increment_save']);
  });

  it('skips the increment when incrementBeforeDestructive is off', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      settings: settings({ incrementBeforeDestructive: false }),
    });
    closes.push(close);

    const result = await call(client, 'layer.delete', { index: 1 });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['layer.delete']);
  });

  it('increments once for a batch.run with a destructive sub-operation', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const result = await call(client, 'batch.run', {
      ops: [
        { op: 'layer.rename', args: { index: 1, name: 'Hero' } },
        { op: 'layer.delete', args: { index: 1 } },
      ],
    });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['project.increment_save', 'batch.run']);
  });

  it('increments exactly once for a batch.run with several destructive sub-operations', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const result = await call(client, 'batch.run', {
      ops: [
        { op: 'layer.delete', args: { index: 1 } },
        { op: 'layer.delete', args: { index: 2 } },
      ],
    });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['project.increment_save', 'batch.run']);
  });

  it('does not increment for a batch.run without destructive sub-operations', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const result = await call(client, 'batch.run', {
      ops: [{ op: 'layer.rename', args: { index: 1, name: 'Hero' } }],
    });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['batch.run']);
  });

  it('refuses a batch.run with a destructive sub-operation when the project has never been saved', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      incrementResult: { success: false, error: 'project has never been saved' },
    });
    closes.push(close);

    const result = await call(client, 'batch.run', {
      ops: [{ op: 'layer.delete', args: { index: 1 } }],
    });
    expect(result.isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(result.text));
    expect(error.code).toBe('UNSAVED_PROJECT');
    expect(calls).toEqual(['project.increment_save']);
  });
});
