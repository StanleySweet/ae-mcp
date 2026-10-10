import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer, FakeProject, observeHandlers } from '@ae-mcp/fake-bridge';
import { selectionSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { createServer } from './server.js';

async function connectServer(
  project: FakeProject,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-selection-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  const consumer = createQueueConsumer(root, observeHandlers(project));
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

describe('get_selection', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  it('reports the active comp and its selected layers', async () => {
    const project = new FakeProject();
    const comp = project.addComp('Main', 1920, 1080);
    project.selection = [project.addLayer(comp, 'Layer 1')];
    const { client, close } = await connectServer(project);
    closes.push(close);

    const result = await client.callTool({ name: 'get_selection', arguments: {} });
    const [first] = result.content as Array<{ type: string; text: string }>;
    const selection = selectionSchema.parse(JSON.parse(first!.text));
    expect(selection.comp).toBe('Main');
    expect(selection.layers.map((layer) => layer.name)).toEqual(['Layer 1']);
    expect(selection.items).toEqual([]);
  });
});