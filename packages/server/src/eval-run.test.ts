import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueConsumer, FakeProject, observeHandlers } from '@ae-mcp/fake-bridge';
import { errorSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createAEClient } from './ae-client.js';
import { FileQueueTransport } from './file-queue-transport.js';
import { defaultOperationRegistry } from './operations.js';
import { createServer } from './server.js';
import type { Settings } from './settings.js';
import { DEFAULT_SETTINGS } from './settings.js';

interface Harness {
  client: Client;
  close: () => Promise<void>;
}

async function connectServer(calls: string[], settings: Settings): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-eval-run-'));
  const root = join(home, '.ae-mcp');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  const project = new FakeProject();
  project.addComp('Main', 1920, 1080);
  const handlers = {
    ...observeHandlers(project),
    'project.increment_save': () => {
      calls.push('project.increment_save');
      return { success: true, file: '/projects/P_v008.aep' };
    },
    'eval.run': (args: unknown) => {
      calls.push('eval.run');
      return { result: (args as { code: string }).code.length };
    },
  };
  const consumer = createQueueConsumer(root, handlers);
  await consumer.start();

  const aeClient = createAEClient({ transport: new FileQueueTransport(root, 10), root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({
    root,
    client: aeClient,
    operations: defaultOperationRegistry(),
    settings,
  });
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

async function callDo(
  client: Client,
  op: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name: 'ae_do', arguments: { op, args } });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return { isError: result.isError === true, text: first!.text };
}

async function catalogNames(client: Client): Promise<string[]> {
  const result = await client.callTool({ name: 'ae_catalog', arguments: {} });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return (JSON.parse(first!.text) as { operations: { name: string }[] }).operations.map((op) => op.name);
}

describe('eval.run policy gate with the default registry', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  it('is hidden from ae_catalog and refused by ae_do while eval is off', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(calls, { ...DEFAULT_SETTINGS });
    closes.push(close);

    expect(await catalogNames(client)).not.toContain('eval.run');

    const result = await callDo(client, 'eval.run', { code: '1+1' });
    expect(result.isError).toBe(true);
    expect(errorSchema.parse(JSON.parse(result.text)).code).toBe('FORBIDDEN');
    expect(calls).toEqual([]);
  });

  it('increments the project, then runs the code, while eval is enabled', async () => {
    const calls: string[] = [];
    const { client, close } = await connectServer(calls, { ...DEFAULT_SETTINGS, evalEnabled: true });
    closes.push(close);

    expect(await catalogNames(client)).toContain('eval.run');

    const result = await callDo(client, 'eval.run', { code: '1+1' });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['project.increment_save', 'eval.run']);
  });
});
