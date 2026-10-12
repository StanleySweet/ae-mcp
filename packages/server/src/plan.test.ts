import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer } from '@ae-mcp/fake-bridge';
import { errorSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { OperationRegistry } from './operations.js';
import { createServer } from './server.js';

interface BulkArgs {
  match?: string;
  replace?: string;
  dryRun?: boolean;
}

function registry(): OperationRegistry {
  const registry = new OperationRegistry();
  registry.register({
    name: 'bulk.rename',
    category: 'bulk',
    description: 'Rename layers.',
    readOnly: false,
    destructive: false,
    schema: {
      comp: { type: 'string' },
      match: { type: 'string' },
      replace: { type: 'string' },
      dryRun: { type: 'boolean' },
    },
  });
  registry.register({
    name: 'layer.rename',
    category: 'layer',
    description: 'Rename a layer.',
    readOnly: false,
    destructive: false,
    schema: {},
  });
  return registry;
}

async function connect(): Promise<{
  client: Client;
  state: { layers: string[] };
  close: () => Promise<void>;
}> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-plan-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  const state = { layers: ['Layer 1', 'Layer 2'] };
  const rename = (raw: unknown) => {
    const args = raw as BulkArgs;
    const from = state.layers.slice();
    const to = from.map((name) => name.split(args.match ?? '').join(args.replace ?? ''));
    const changes = from
      .map((name, i) => ({ index: i + 1, from: name, to: to[i] }))
      .filter((change) => change.from !== change.to);
    const fingerprint = `Main:${from.join(',')}`;
    if (args.dryRun === false) {
      state.layers = to;
      return { dryRun: false, comp: 'Main', applied: changes.length, changes, fingerprint };
    }
    return { dryRun: true, comp: 'Main', changes, fingerprint };
  };

  const consumer = createQueueConsumer(root, {
    'bulk.rename': rename,
    'layer.rename': () => ({ ok: true }),
  });
  await consumer.start();

  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ root, client: aeClient, operations: registry() });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    state,
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
): Promise<{ isError: boolean; value: unknown }> {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return { isError: result.isError === true, value: JSON.parse(first!.text) };
}

describe('ae_plan / ae_apply', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  it('plans a bulk rename without changing the project', async () => {
    const { client, state, close } = await connect();
    closes.push(close);

    const { isError, value } = await call(client, 'ae_plan', {
      op: 'bulk.rename',
      args: { comp: 'Main', match: 'Layer', replace: 'Element' },
    });

    expect(isError).toBe(false);
    const plan = value as { planId: string; changes: unknown[] };
    expect(plan.planId).toMatch(/^plan-/);
    expect(plan.changes).toEqual([
      { index: 1, from: 'Layer 1', to: 'Element 1' },
      { index: 2, from: 'Layer 2', to: 'Element 2' },
    ]);
    expect(state.layers).toEqual(['Layer 1', 'Layer 2']);
  });

  it('applies a plan', async () => {
    const { client, state, close } = await connect();
    closes.push(close);

    const planned = await call(client, 'ae_plan', {
      op: 'bulk.rename',
      args: { comp: 'Main', match: 'Layer', replace: 'Element' },
    });
    const { planId } = planned.value as { planId: string };

    const applied = await call(client, 'ae_apply', { planId });

    expect(applied.isError).toBe(false);
    expect(applied.value).toMatchObject({ planId, op: 'bulk.rename' });
    expect(state.layers).toEqual(['Element 1', 'Element 2']);
  });

  it('consumes a plan so it cannot be applied twice', async () => {
    const { client, close } = await connect();
    closes.push(close);

    const planned = await call(client, 'ae_plan', {
      op: 'bulk.rename',
      args: { comp: 'Main', match: 'Layer', replace: 'Element' },
    });
    const { planId } = planned.value as { planId: string };
    await call(client, 'ae_apply', { planId });

    const second = await call(client, 'ae_apply', { planId });

    expect(second.isError).toBe(true);
    expect(errorSchema.parse(second.value).code).toBe('UNKNOWN_PLAN');
  });

  it('refuses a plan made before the project changed', async () => {
    const { client, state, close } = await connect();
    closes.push(close);

    const planned = await call(client, 'ae_plan', {
      op: 'bulk.rename',
      args: { comp: 'Main', match: 'Layer', replace: 'Element' },
    });
    const { planId } = planned.value as { planId: string };
    state.layers = ['Something else'];

    const applied = await call(client, 'ae_apply', { planId });

    expect(applied.isError).toBe(true);
    expect(errorSchema.parse(applied.value).code).toBe('PLAN_CHANGED');
  });

  it('refuses a non-bulk operation', async () => {
    const { client, close } = await connect();
    closes.push(close);

    const { isError, value } = await call(client, 'ae_plan', {
      op: 'layer.rename',
      args: {},
    });

    expect(isError).toBe(true);
    expect(errorSchema.parse(value).code).toBe('INVALID_ARGS');
  });

  it('rejects an unknown operation', async () => {
    const { client, close } = await connect();
    closes.push(close);

    const { isError, value } = await call(client, 'ae_plan', { op: 'bulk.nope' });

    expect(isError).toBe(true);
    expect(errorSchema.parse(value).code).toBe('UNKNOWN_TOOL');
  });

  it('reports an unknown plan id', async () => {
    const { client, close } = await connect();
    closes.push(close);

    const { isError, value } = await call(client, 'ae_apply', { planId: 'plan-999' });

    expect(isError).toBe(true);
    expect(errorSchema.parse(value).code).toBe('UNKNOWN_PLAN');
  });
});
