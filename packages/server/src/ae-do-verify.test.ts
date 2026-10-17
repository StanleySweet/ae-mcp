import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer } from '@ae-mcp/fake-bridge';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { OperationRegistry } from './operations.js';
import { createServer } from './server.js';

// A tiny comp: layers are [{index, name}]. comp.snapshot and comp.diff mirror the
// bridge's shapes (changed layers and fields only) so ae_do verify can be tested
// end to end without After Effects.
type Layer = { index: number; name: string };

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
    name: 'project.info',
    category: 'project',
    description: 'Get project info.',
    readOnly: true,
    destructive: false,
    schema: {},
  });
  return registry;
}

// Mirrors the bridge's comp.diff: layers match by index and name, so a rename
// shows as one added and one removed layer.
function diffLayers(before: Layer[], after: Layer[]): Record<string, unknown> {
  const added: string[] = [];
  const removed: string[] = [];
  for (const layer of after) {
    if (!before.some((old) => old.index === layer.index && old.name === layer.name)) {
      added.push(layer.name);
    }
  }
  for (const layer of before) {
    if (!after.some((now) => now.index === layer.index && now.name === layer.name)) {
      removed.push(layer.name);
    }
  }
  return { added, removed, changed: [] };
}

describe('ae_do verify (#233)', () => {
  const closes: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closes.length > 0) {
      await closes.pop()!();
    }
  });

  async function connect(): Promise<{ client: Client; snapshots: number; diffs: number; layers: Layer[] }> {
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-verify-'));
    const root = join(home, '.ae-mcp');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);

    const state = { snapshots: 0, diffs: 0, layers: [{ index: 1, name: 'Layer 1' }] as Layer[] };
    const consumer = createQueueConsumer(root, {
      'comp.snapshot': () => {
        state.snapshots += 1;
        return { comp: 'Main', layers: state.layers.map((layer) => ({ ...layer })) };
      },
      'comp.diff': (args: unknown) => {
        state.diffs += 1;
        const snapshot = (args as { snapshot: { layers: Layer[] } }).snapshot;
        return diffLayers(snapshot.layers, state.layers);
      },
      'layer.rename': (args: unknown) => {
        const parsed = args as { index: number; name: string };
        state.layers = state.layers.map((layer) =>
          layer.index === parsed.index ? { index: layer.index, name: parsed.name } : layer,
        );
        return { index: parsed.index, name: parsed.name };
      },
      'project.info': () => ({ name: 'Project' }),
    });
    await consumer.start();

    const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ root, client: aeClient, operations: registry() });
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);
    closes.push(async () => {
      await client.close();
      await server.close();
      await consumer.stop();
    });

    return {
      client,
      get snapshots() {
        return state.snapshots;
      },
      get diffs() {
        return state.diffs;
      },
      get layers() {
        return state.layers;
      },
    } as { client: Client; snapshots: number; diffs: number; layers: Layer[] };
  }

  async function call(client: Client, args: Record<string, unknown>): Promise<{ isError: boolean; body: Record<string, unknown> }> {
    const result = await client.callTool({ name: 'ae_do', arguments: args });
    const [first] = result.content as Array<{ type: string; text: string }>;
    return { isError: result.isError === true, body: JSON.parse(first!.text) as Record<string, unknown> };
  }

  it('adds a verify diff that shows the renamed layer as added and removed', async () => {
    const ctx = await connect();

    const { isError, body } = await call(ctx.client, {
      op: 'layer.rename',
      args: { index: 1, name: 'Hero' },
      verify: true,
    });

    expect(isError).toBe(false);
    expect(body.result).toEqual({ index: 1, name: 'Hero' });
    expect(body.verify).toEqual({ available: true, added: ['Hero'], removed: ['Layer 1'], changed: [] });
  });

  it('keeps the result shape unchanged when verify is off, and never snapshots', async () => {
    const ctx = await connect();

    const { isError, body } = await call(ctx.client, { op: 'layer.rename', args: { index: 1, name: 'Hero' } });

    expect(isError).toBe(false);
    expect(body).toEqual({ result: { index: 1, name: 'Hero' } });
    expect(ctx.snapshots).toBe(0);
    expect(ctx.diffs).toBe(0);
  });

  it('reports an empty diff when the change leaves the comp as it was', async () => {
    const ctx = await connect();

    const { body } = await call(ctx.client, {
      op: 'layer.rename',
      args: { index: 1, name: 'Layer 1' },
      verify: true,
    });

    expect(body.verify).toEqual({ available: true, added: [], removed: [], changed: [] });
  });

  it('ignores verify on a read-only operation', async () => {
    const ctx = await connect();

    const { body } = await call(ctx.client, { op: 'project.info', verify: true });

    expect(body).toEqual({ result: { name: 'Project' } });
    expect(ctx.snapshots).toBe(0);
  });
});
