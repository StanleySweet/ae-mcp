import { operationDefinitionSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect } from 'vitest';
import { OperationRegistry } from './operations.js';
import { createServer } from './server.js';

function registryWith(...names: [string, string][]): OperationRegistry {
  const registry = new OperationRegistry();
  for (const [name, category] of names) {
    registry.register({
      name,
      category: category as never,
      description: `Runs ${name}.`,
      readOnly: true,
      schema: {},
    });
  }
  return registry;
}

async function connectServer(operations: OperationRegistry): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ operations });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function catalog(
  client: Client,
  args: Record<string, unknown>,
): Promise<{ operations: unknown[] }> {
  const result = await client.callTool({ name: 'ae_catalog', arguments: args });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(first!.text);
}

describe('ae_catalog', () => {
  it('lists every operation sorted by name', async () => {
    const client = await connectServer(
      registryWith(['layer.add_text', 'layer'], ['comp.create', 'comp']),
    );
    const { operations } = await catalog(client, {});
    const names = operations.map((op) => operationDefinitionSchema.parse(op).name);
    expect(names).toEqual(['comp.create', 'layer.add_text']);
  });

  it('filters to a single category', async () => {
    const client = await connectServer(
      registryWith(['layer.add_text', 'layer'], ['comp.create', 'comp']),
    );
    const { operations } = await catalog(client, { category: 'layer' });
    expect(operations).toHaveLength(1);
    expect(operationDefinitionSchema.parse(operations[0]).name).toBe('layer.add_text');
  });

  it('returns an empty list when nothing is registered', async () => {
    const client = await connectServer(new OperationRegistry());
    const { operations } = await catalog(client, {});
    expect(operations).toEqual([]);
  });
});
