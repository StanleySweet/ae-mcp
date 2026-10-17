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

function registry(): OperationRegistry {
  const registry = new OperationRegistry();
  registry.register({
    name: 'layer.rename',
    category: 'layer',
    description: 'Rename a layer.',
    readOnly: false,
    destructive: false,
    schema: { index: { type: 'number' }, name: { type: 'string' } },
    required: ['index', 'name'],
  });
  registry.register({
    name: 'comp.create',
    category: 'comp',
    description: 'Create a comp.',
    readOnly: false,
    destructive: false,
    schema: { name: { type: 'string' } },
  });
  registry.register({
    name: 'project.info',
    category: 'project',
    description: 'Get project info.',
    readOnly: true,
    destructive: false,
    schema: {},
  });
  registry.register({
    name: 'project.big',
    category: 'project',
    description: 'Return a large result.',
    readOnly: true,
    destructive: false,
    schema: {},
  });
  registry.register({
    name: 'project.undo',
    category: 'project',
    description: 'Undo the last operation.',
    readOnly: true,
    destructive: false,
    schema: {},
  });
  return registry;
}

async function connectServer(
  project: FakeProject,
  calls: string[],
  maxResultBytes?: number,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-ae-do-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  const observe = observeHandlers(project);
  const handlers = {
    ...observe,
    get_selection: (args: unknown) => {
      calls.push('get_selection');
      return observe.get_selection!(args);
    },
    'layer.rename': (args: unknown) => {
      calls.push('layer.rename');
      const parsed = args as { index: number; name: string };
      return { index: parsed.index, name: parsed.name };
    },
    'project.big': () => Array.from({ length: 200 }, (_, i) => ({ index: i, name: `Layer ${i}` })),
  };
  const consumer = createQueueConsumer(root, handlers);
  await consumer.start();

  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ root, client: aeClient, operations: registry(), maxResultBytes });
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
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name: 'ae_do', arguments: args });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return { isError: result.isError === true, text: first!.text };
}

describe('ae_do', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  function project(): FakeProject {
    const project = new FakeProject();
    const comp = project.addComp('Main', 1920, 1080);
    project.addLayer(comp, 'Layer 1');
    return project;
  }

  // One AE round trip per call: no automatic get_selection context (#186).
  it('runs a registered operation in a single AE call', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const { isError, text } = await call(client, {
      op: 'layer.rename',
      args: { index: 1, name: 'Hero' },
    });
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({ result: { index: 1, name: 'Hero' } });
    expect(calls).toEqual(['layer.rename']);
  });

  it('refuses a result over maxResultBytes with INVALID_ARGS', async () => {
    const { client, close } = await connectServer(project(), [], 500);
    closes.push(close);

    const { isError, text } = await call(client, { op: 'project.big' });
    expect(isError).toBe(true);
    expect(errorSchema.parse(JSON.parse(text)).code).toBe('INVALID_ARGS');
    expect(text).toContain('over the 500-byte limit');
  });

  it('passes a result under maxResultBytes through unchanged', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, 500);
    closes.push(close);

    const { isError, text } = await call(client, {
      op: 'layer.rename',
      args: { index: 1, name: 'Hero' },
    });
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({ result: { index: 1, name: 'Hero' } });
  });

  it('rejects an unknown operation with the closest names and never reaches AE', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const { isError, text } = await call(client, { op: 'layer.renam' });
    expect(isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(text));
    expect(error.code).toBe('UNKNOWN_TOOL');
    expect(error.message).toContain('layer.rename');
    expect(calls).toEqual([]);
  });

  it('rejects an argument of the wrong type before reaching AE', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const { isError, text } = await call(client, {
      op: 'layer.rename',
      args: { index: 'one', name: 'Hero' },
    });
    expect(isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(text));
    expect(error.code).toBe('INVALID_ARGS');
    expect(calls).toEqual([]);
  });

  it('rejects a missing required argument, naming it, before reaching AE', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const { isError, text } = await call(client, { op: 'layer.rename', args: { index: 1 } });
    expect(isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(text));
    expect(error.code).toBe('INVALID_ARGS');
    expect(error.message).toContain("missing required argument 'name'");
    expect(error.hint).toBe("Call ae_catalog for the operation's schema and required arguments.");
    expect(calls).toEqual([]);
  });

  it('rejects an argument not declared in the schema', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls);
    closes.push(close);

    const { isError, text } = await call(client, {
      op: 'layer.rename',
      args: { index: 1, name: 'Hero', bogus: true },
    });
    expect(isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(text));
    expect(error.code).toBe('INVALID_ARGS');
    expect(calls).toEqual([]);
  });
});
