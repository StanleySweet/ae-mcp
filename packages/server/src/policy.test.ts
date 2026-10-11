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
import { DEFAULT_SETTINGS } from './settings.js';

function registry(): OperationRegistry {
  const registry = new OperationRegistry();
  registry.register({
    name: 'project.info',
    category: 'project',
    description: 'Report project info.',
    readOnly: true,
    destructive: false,
    schema: {},
  });
  registry.register({
    name: 'layer.rename',
    category: 'layer',
    description: 'Rename a layer.',
    readOnly: false,
    destructive: false,
    schema: { index: { type: 'number' }, name: { type: 'string' } },
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
    name: 'batch.run',
    category: 'batch',
    description: 'Run many operations as one undo step.',
    readOnly: false,
    destructive: false,
    schema: {
      ops: { type: 'array', items: { type: 'object' } },
    },
  });
  registry.register({
    name: 'eval.run',
    category: 'eval',
    description: 'Run arbitrary ExtendScript.',
    readOnly: false,
    destructive: true,
    schema: { code: { type: 'string' } },
  });
  return registry;
}

async function connectServer(
  project: FakeProject,
  calls: string[],
  settings: Settings,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-policy-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  const handlers = {
    ...observeHandlers(project),
    'project.info': () => {
      calls.push('project.info');
      return { file: null, numItems: 0 };
    },
    'layer.rename': (args: unknown) => {
      calls.push('layer.rename');
      const parsed = args as { index: number; name: string };
      return { index: parsed.index, name: parsed.name };
    },
    'batch.run': () => {
      calls.push('batch.run');
      return { results: [] };
    },
    'eval.run': () => {
      calls.push('eval.run');
      return { success: true };
    },
    'project.increment_save': () => {
      calls.push('project.increment_save');
      return { success: true, file: '/projects/P_v008.aep' };
    },
  };
  const consumer = createQueueConsumer(root, handlers);
  await consumer.start();

  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ root, client: aeClient, operations: registry(), settings });
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
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return { isError: result.isError === true, text: first!.text };
}

function project(): FakeProject {
  const project = new FakeProject();
  const comp = project.addComp('Main', 1920, 1080);
  project.addLayer(comp, 'Layer 1');
  return project;
}

function readOnly(): Settings {
  return { ...DEFAULT_SETTINGS, readOnly: true };
}

function allow(...categories: string[]): Settings {
  return { ...DEFAULT_SETTINGS, allowedCategories: categories };
}

function evalOn(): Settings {
  return { ...DEFAULT_SETTINGS, evalEnabled: true };
}

describe('E7-2 policy engine', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  it('hides mutating operations from the catalog in read-only mode', async () => {
    const projects = registry();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ operations: projects, settings: readOnly() });
    closes.push(() => server.close());
    await server.connect(serverTransport);
    const catalogOnly = new Client({ name: 'test-client', version: '0.0.0' });
    closes.push(() => catalogOnly.close());
    await catalogOnly.connect(clientTransport);

    const result = await catalogOnly.callTool({ name: 'ae_catalog', arguments: {} });
    const [first] = result.content as Array<{ type: string; text: string }>;
    const names = (JSON.parse(first!.text) as { operations: { name: string }[] }).operations.map(
      (op) => op.name,
    );
    expect(names).toEqual(['project.info']);
  });

  it('hides disallowed categories from the catalog', async () => {
    const projects = registry();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ operations: projects, settings: allow('layer') });
    closes.push(() => server.close());
    await server.connect(serverTransport);
    const catalogOnly = new Client({ name: 'test-client', version: '0.0.0' });
    closes.push(() => catalogOnly.close());
    await catalogOnly.connect(clientTransport);

    const result = await catalogOnly.callTool({ name: 'ae_catalog', arguments: {} });
    const [first] = result.content as Array<{ type: string; text: string }>;
    const names = (JSON.parse(first!.text) as { operations: { name: string }[] }).operations.map(
      (op) => op.name,
    );
    expect(names).toEqual(['layer.rename']);
  });

  it('refuses a mutating operation in read-only mode before reaching AE', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, readOnly());
    closes.push(close);

    const { isError, text } = await call(client, 'ae_do', {
      op: 'layer.rename',
      args: { index: 1, name: 'Hero' },
    });
    expect(isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(text));
    expect(error.code).toBe('FORBIDDEN');
    expect(calls).toEqual([]);
  });

  it('allows read-only operations in read-only mode', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, readOnly());
    closes.push(close);

    const result = await call(client, 'ae_do', { op: 'project.info' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({});
  });

  it('refuses an operation outside the category allowlist before reaching AE', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, allow('layer'));
    closes.push(close);

    const { isError, text } = await call(client, 'ae_do', {
      op: 'comp.create',
      args: { name: 'X' },
    });
    expect(isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(text));
    expect(error.code).toBe('FORBIDDEN');
    expect(calls).toEqual([]);
  });

  it('refuses a batch.run whose sub-operation is outside the policy', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, allow('batch'));
    closes.push(close);

    const result = await call(client, 'ae_do', {
      op: 'batch.run',
      args: { ops: [{ op: 'layer.rename', args: { index: 1, name: 'Hero' } }] },
    });
    expect(result.isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(result.text));
    expect(error.code).toBe('FORBIDDEN');
    expect(calls).toEqual([]);
  });

  it('lets an allowed operation run under the allowlist', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, allow('layer'));
    closes.push(close);

    const result = await call(client, 'ae_do', {
      op: 'layer.rename',
      args: { index: 1, name: 'Hero' },
    });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['layer.rename']);
  });
});

describe('E7-3 eval.run gate', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  async function catalogNames(settings: Settings): Promise<string[]> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ operations: registry(), settings });
    closes.push(() => server.close());
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    closes.push(() => client.close());
    await client.connect(clientTransport);
    const result = await client.callTool({ name: 'ae_catalog', arguments: {} });
    const [first] = result.content as Array<{ type: string; text: string }>;
    return (JSON.parse(first!.text) as { operations: { name: string }[] }).operations.map(
      (op) => op.name,
    );
  }

  it('hides eval.run from the catalog while eval is disabled', async () => {
    expect(await catalogNames(allow('eval'))).not.toContain('eval.run');
  });

  it('lists eval.run when eval is enabled', async () => {
    expect(await catalogNames(evalOn())).toContain('eval.run');
  });

  it('refuses eval.run while eval is disabled, before reaching AE', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, {
      ...DEFAULT_SETTINGS,
      evalEnabled: false,
    });
    closes.push(close);

    const result = await call(client, 'ae_do', { op: 'eval.run', args: { code: '1 + 1' } });
    expect(result.isError).toBe(true);
    const error = errorSchema.parse(JSON.parse(result.text));
    expect(error.code).toBe('FORBIDDEN');
    expect(calls).toEqual([]);
  });

  it('runs eval.run when eval is enabled', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(project(), calls, evalOn());
    closes.push(close);

    const result = await call(client, 'ae_do', { op: 'eval.run', args: { code: '1 + 1' } });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['project.increment_save', 'eval.run']);
  });
});