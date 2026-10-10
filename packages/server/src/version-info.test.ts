import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer, FakeProject, observeHandlers } from '@ae-mcp/fake-bridge';
import { versionInfoSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { createServer } from './server.js';

describe('ae_version_info', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  it('probes the bridge for live versions and capabilities', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ae-mcp-version-info-'));
    const root = join(home, '.ae-mcp');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);

    const project = new FakeProject();
    const consumer = createQueueConsumer(root, observeHandlers(project));
    await consumer.start();

    const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ root, client: aeClient });
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);
    closes.push(async () => {
      await client.close();
      await server.close();
      await consumer.stop();
    });

    const result = await client.callTool({ name: 'ae_version_info', arguments: {} });
    const [first] = result.content as Array<{ type: string; text: string }>;
    const info = versionInfoSchema.parse(JSON.parse(first!.text));
    expect(info).toMatchObject({ aeVersion: '24.6.0', bridgeVersion: '0.0.0' });
    expect(info.capabilities).toContain('ae_version_info');
    expect(info.capabilities).toContain('ae_layer_info');
  });
});