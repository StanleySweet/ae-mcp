import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer, FakeProject, observeHandlers } from '@ae-mcp/fake-bridge';
import { findResultSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { createServer } from './server.js';

async function connectServer(
  project: FakeProject,
  options: Parameters<typeof createServer>[0] = {},
): Promise<{ client: Client; close: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-find-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  const consumer = createQueueConsumer(root, observeHandlers(project));
  await consumer.start();

  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ root, client: aeClient, ...options });
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
): Promise<{ comps: unknown[]; layers: unknown[]; properties: unknown[]; truncated: boolean }> {
  const result = await client.callTool({ name: 'find', arguments: args });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return findResultSchema.parse(JSON.parse(first!.text));
}

describe('find', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  it('finds comps and layers by case-insensitive name, restricted by kinds', async () => {
    const project = new FakeProject();
    const main = project.addComp('Main', 1920, 1080);
    project.addComp('Logo Bumper', 1280, 720);
    project.addLayer(main, 'Logo');
    const { client, close } = await connectServer(project);
    closes.push(close);

    const all = await call(client, { query: 'logo' });
    expect(all.comps.map((comp) => (comp as { name: string }).name)).toEqual(['Logo Bumper']);
    expect(all.layers).toEqual([
      { comp: 'Main', index: 1, name: 'Logo', type: 'AVLayer' },
    ]);

    const layersOnly = await call(client, { query: 'logo', kinds: ['layer'] });
    expect(layersOnly.comps).toEqual([]);
    expect(layersOnly.layers).toHaveLength(1);
  });

  it('returns empty results for an empty query', async () => {
    const project = new FakeProject();
    project.addComp('Main', 1920, 1080);
    const { client, close } = await connectServer(project);
    closes.push(close);

    const found = await call(client, { query: '' });
    expect(found).toEqual({ comps: [], layers: [], properties: [], truncated: false });
  });
});