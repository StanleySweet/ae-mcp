import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compOperationHandlers,
  createQueueConsumer,
  FakeProject,
  observeHandlers,
} from '@ae-mcp/fake-bridge';
import { errorSchema, operationDefinitionSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { defaultOperationRegistry } from './operations.js';
import { createServer } from './server.js';

const COMP_OPERATIONS = [
  'comp.create',
  'comp.diff',
  'comp.duplicate',
  'comp.info',
  'comp.layer_clip_frames',
  'comp.precompose',
  'comp.set_settings',
  'comp.snapshot',
];

async function connect(
  project: FakeProject,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-comp-ops-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const consumer = createQueueConsumer(
    root,
    { ...observeHandlers(project), ...compOperationHandlers(project) },
    10,
  );
  await consumer.start();
  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ root, client: aeClient });
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

async function run(
  client: Client,
  op: string,
  args?: Record<string, unknown>,
): Promise<{ isError: boolean; body: Record<string, unknown> }> {
  const result = await client.callTool({ name: 'ae_do', arguments: { op, args } });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return { isError: result.isError === true, body: JSON.parse(first!.text) };
}

describe('comp operations registry', () => {
  it('registers exactly the six comp operations with valid definitions', () => {
    const operations = defaultOperationRegistry().list('comp');
    const names = operations.map((op) => operationDefinitionSchema.parse(op).name);
    expect(names).toEqual(expect.arrayContaining(COMP_OPERATIONS));
    for (const op of operations) {
      expect(op.category).toBe('comp');
      expect(op.description.length).toBeGreaterThan(10);
    }
  });

  it('marks only comp.info as read-only', () => {
    const readOnly = defaultOperationRegistry()
      .list('comp')
      .filter((op) => op.readOnly)
      .map((op) => op.name);
    expect(readOnly).toEqual(expect.arrayContaining(['comp.info']));
  });

  it('documents every argument the bridge reads', () => {
    const registry = defaultOperationRegistry();
    expect(Object.keys(registry.get('comp.create')!.schema)).toEqual(
      expect.arrayContaining(['name', 'width', 'height', 'duration', 'fps']),
    );
    expect(Object.keys(registry.get('comp.precompose')!.schema)).toEqual(
      expect.arrayContaining(['layers']),
    );
    expect(Object.keys(registry.get('comp.layer_clip_frames')!.schema)).toEqual(
      expect.arrayContaining(['from', 'to']),
    );
  });

  it('lists the comp operations through ae_catalog', async () => {
    const { client, close } = await connect(new FakeProject());
    try {
      const result = await client.callTool({ name: 'ae_catalog', arguments: { category: 'comp' } });
      const [first] = result.content as Array<{ type: string; text: string }>;
      const { operations } = JSON.parse(first!.text) as { operations: { name: string }[] };
      expect(operations.map((op) => op.name)).toEqual(COMP_OPERATIONS);
    } finally {
      await close();
    }
  });
});

describe('comp operations through ae_do', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  async function start(layerCount = 0): Promise<{ client: Client; project: FakeProject }> {
    const project = new FakeProject();
    const comp = project.addComp('Main', 1920, 1080, 25, { duration: 10 });
    for (let i = 1; i <= layerCount; i += 1) {
      project.addLayer(comp, `Layer ${i}`);
    }
    const { client, close } = await connect(project);
    closes.push(close);
    return { client, project };
  }

  it('creates, reconfigures, duplicates and inspects a comp', async () => {
    const { client, project } = await start();
    const created = await run(client, 'comp.create', { name: 'Intro', width: 1280, height: 720 });
    expect(created.isError).toBe(false);
    expect(created.body.result).toMatchObject({ name: 'Intro', width: 1280, height: 720 });

    const changed = await run(client, 'comp.set_settings', { comp: 'Intro', fps: 24, duration: 5 });
    expect(changed.body.result).toMatchObject({ frameRate: 24, duration: 5 });

    const copy = await run(client, 'comp.duplicate', { comp: 'Intro', newName: 'Intro B' });
    expect(copy.body.result).toMatchObject({ name: 'Intro B', frameRate: 24 });

    const info = await run(client, 'comp.info', { comp: 'Intro B' });
    expect(info.body.result).toMatchObject({ name: 'Intro B', width: 1280 });
    expect(project.comps.map((comp) => comp.name)).toEqual(['Main', 'Intro', 'Intro B']);
  });

  it('precomposes layers and clips them by frames', async () => {
    const { client, project } = await start(3);
    const precomposed = await run(client, 'comp.precompose', {
      comp: 'Main',
      layers: [1, 2],
      name: 'Inner',
    });
    expect(precomposed.body.result).toMatchObject({ numLayers: 2, precomp: { name: 'Inner' } });

    const clipped = await run(client, 'comp.layer_clip_frames', { comp: 'Main', from: 25, to: 75 });
    expect(clipped.body.result).toMatchObject({ inPoint: 1, outPoint: 3 });
    expect(project.comps[0]!.layers.every((layer) => layer.inPoint === 1)).toBe(true);
  });

  it('rejects wrongly typed arguments before reaching After Effects', async () => {
    const { client, project } = await start();
    for (const [op, args] of [
      ['comp.create', { width: '1920' }],
      ['comp.create', { fps: 'fast' }],
      ['comp.precompose', { comp: 'Main', layers: 'all' }],
      ['comp.layer_clip_frames', { comp: 'Main', from: 1.5, to: 10 }],
      ['comp.precompose', { comp: 'Main', layers: [1], moveAllAttributes: 'no' }],
      ['comp.set_settings', { comp: 'Main', size: [1, 1] }],
    ] as [string, Record<string, unknown>][]) {
      const { isError, body } = await run(client, op, args);
      expect(isError).toBe(true);
      expect(errorSchema.parse(body).code).toBe('INVALID_ARGS');
    }
    expect(project.comps).toHaveLength(1);
  });

  it('surfaces bridge-side INVALID_ARGS for an unknown comp', async () => {
    const { client } = await start();
    const { isError, body } = await run(client, 'comp.info', { comp: 'Nope' });
    expect(isError).toBe(true);
    const error = errorSchema.parse(body);
    expect(error.code).toBe('INVALID_ARGS');
    expect(error.message).toContain('Nope');
  });
});
