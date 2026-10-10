import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer, FakeProject, observeHandlers } from '@ae-mcp/fake-bridge';
import { layerInfoResultSchema } from '@ae-mcp/protocol';
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
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-layer-info-'));
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
): Promise<{
  comp: string | null;
  layers: { index: number; name: string }[];
  missing: number[];
  truncated: boolean;
}> {
  const result = await client.callTool({ name: 'ae_layer_info', arguments: args });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return layerInfoResultSchema.parse(JSON.parse(first!.text));
}

describe('ae_layer_info', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  it('returns every layer of a comp and a subset by index with missing entries', async () => {
    const project = new FakeProject();
    const comp = project.addComp('Main', 1920, 1080);
    project.addLayer(comp, 'Layer 1');
    project.addLayer(comp, 'Layer 2');
    const { client, close } = await connectServer(project);
    closes.push(close);

    const all = await call(client, { comp: 'Main' });
    expect(all.comp).toBe('Main');
    expect(all.layers.map((layer) => layer.name)).toEqual(['Layer 1', 'Layer 2']);
    expect(all.truncated).toBe(false);

    const subset = await call(client, { comp: 'Main', layers: [2, 9] });
    expect(subset.layers.map((layer) => layer.name)).toEqual(['Layer 2']);
    expect(subset.missing).toEqual([9]);
  });

  it('reports a null comp when the requested comp is unknown', async () => {
    const project = new FakeProject();
    project.addComp('Main', 1920, 1080);
    const { client, close } = await connectServer(project);
    closes.push(close);

    const info = await call(client, { comp: 'Nope' });
    expect(info.comp).toBeNull();
    expect(info.layers).toEqual([]);
  });
});