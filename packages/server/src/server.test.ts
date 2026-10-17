import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorCodes, errorHintDetails, ERROR_HINTS_URI } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect } from 'vitest';
import { ANIMATION_GUIDE_URI, SERVER_INSTRUCTIONS } from './instructions.js';
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

  it('serves the instructions option to the client on connect', async () => {
    const { client, server } = await connect({ instructions: 'Animation Principles' });
    expect(client.getInstructions()).toBe('Animation Principles');
    await client.close();
    await server.close();
  });

  it('sends short instructions and serves the full guide as a resource', async () => {
    const { client, server } = await connect({
      instructions: SERVER_INSTRUCTIONS,
      guide: '# Full guide',
    });
    const instructions = client.getInstructions() ?? '';
    expect(instructions.length).toBeLessThan(800);
    expect(instructions).toContain(ANIMATION_GUIDE_URI);
    const resource = await client.readResource({ uri: ANIMATION_GUIDE_URI });
    expect(resource.contents[0]).toMatchObject({ text: '# Full guide', mimeType: 'text/markdown' });
    await client.close();
    await server.close();
  });

  // Tool descriptions are sent on every session, so their total size is pinned.
  // Update this number in the same commit as any description change.
  it('keeps each tool description short and the total within the snapshot', async () => {
    const { client, server } = await connect({ root: await tempRoot() });
    const tools = await client.listTools();
    for (const tool of tools.tools) {
      expect(tool.description?.length ?? 0, tool.name).toBeLessThan(200);
    }
    const total = tools.tools.reduce((sum, tool) => sum + (tool.description?.length ?? 0), 0);
    expect(total).toBe(2363);
    await client.close();
    await server.close();
  });

  it('serves the full error hint table once as a resource', async () => {
    const { client, server } = await connect({ root: await tempRoot() });
    const resource = await client.readResource({ uri: ERROR_HINTS_URI });
    const table = JSON.parse((resource.contents[0] as { text: string }).text) as Record<string, string>;
    expect(table.TIMEOUT).toBe(errorHintDetails.TIMEOUT);
    expect(Object.keys(table)).toEqual([...errorCodes]);
    await client.close();
    await server.close();
  });

  it('lists check_setup and returns one JSON row per check', async () => {
    const { client, server } = await connect({
      root: await tempRoot(),
      applicationsDir: await mkdtemp(join(tmpdir(), 'ae-mcp-server-apps-')),
      // Never reach GitHub from a test (update-check.ts).
      updateCheck: { env: { AE_MCP_NO_UPDATE_CHECK: '1' } },
    });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('check_setup');

    const result = await client.callTool({ name: 'check_setup', arguments: {} });
    const [first] = result.content as Array<{ type: string; text: string }>;
    const checks = JSON.parse(first!.text) as Array<{ check: string; status: string }>;
    expect(checks.map((row) => row.check)).toEqual([
      'after_effects',
      'bridge_heartbeat',
      'bridge_capabilities',
      'bridge_version',
      'queue_permissions',
      'project_saved_version',
      'third_party_extensions',
    ]);
    expect(checks.every((row) => row.status === 'ok' || row.status === 'fail')).toBe(true);

    await client.close();
    await server.close();
  });
});