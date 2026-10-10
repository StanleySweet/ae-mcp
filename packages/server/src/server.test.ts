import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect } from 'vitest';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';

async function connect(options: Parameters<typeof createServer>[0] = {}): Promise<{
  client: Client;
  server: ReturnType<typeof createServer>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(options);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}

async function tempRoot(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-server-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  return root;
}

describe('mcp server skeleton', () => {
  it('completes the initialize handshake over a transport', async () => {
    const { client, server } = await connect();
    expect(client.getServerVersion()).toMatchObject({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
    await client.close();
    await server.close();
  });

  it('lists check_setup and returns one JSON row per check', async () => {
    const { client, server } = await connect({
      root: await tempRoot(),
      applicationsDir: await mkdtemp(join(tmpdir(), 'ae-mcp-server-apps-')),
    });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('check_setup');

    const result = await client.callTool({ name: 'check_setup', arguments: {} });
    const [first] = result.content as Array<{ type: string; text: string }>;
    const checks = JSON.parse(first!.text) as Array<{ check: string; status: string }>;
    expect(checks.map((row) => row.check)).toEqual([
      'after_effects',
      'bridge_heartbeat',
      'queue_permissions',
    ]);
    expect(checks.every((row) => row.status === 'ok' || row.status === 'fail')).toBe(true);

    await client.close();
    await server.close();
  });
});