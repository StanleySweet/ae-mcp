import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer, FakeProject, observeHandlers } from '@ae-mcp/fake-bridge';
import { projectInfoSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { createServer } from './server.js';

describe('ae_project_info', () => {
  const stops: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const stop of stops.splice(0)) {
      await stop();
    }
  });

  it('returns the open project as compact JSON', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-project-info-'));
    const root = join(home, '.ae-mcp');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);

    const project = new FakeProject();
    project.addComp('Main', 1920, 1080);
    const consumer = createQueueConsumer(root, observeHandlers(project));
    await consumer.start();
    stops.push(() => consumer.stop());

    const client = createAEClient({ transport: new FileQueueTransport(root, 10), root });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ root, client });
    await server.connect(serverTransport);
    const mcpClient = new Client({ name: 'test-client', version: '0.0.0' });
    await mcpClient.connect(clientTransport);
    stops.push(async () => {
      await mcpClient.close();
      await server.close();
    });

    const result = await mcpClient.callTool({ name: 'ae_project_info', arguments: {} });
    const [first] = result.content as Array<{ type: string; text: string }>;
    const info = projectInfoSchema.parse(JSON.parse(first!.text));
    expect(info.items).toHaveLength(1);
    expect(info.items[0]).toMatchObject({ name: 'Main', type: 'Composition' });
  });
});