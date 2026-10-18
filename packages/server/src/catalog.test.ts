import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { operationDefinitionSchema } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect } from 'vitest';
import { defaultOperationRegistry, OperationRegistry } from './operations.js';
import { createServer } from './server.js';

function registryWith(...names: [string, string][]): OperationRegistry {
  const registry = new OperationRegistry();
  for (const [name, category] of names) {
    registry.register({
      name,
      category: category as never,
      description: `Runs ${name}.`,
      readOnly: true,
      destructive: false,
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
): Promise<{ operations: unknown[]; version?: string; disabled?: { name: string; reason: string }[] }> {
  const result = await client.callTool({ name: 'ae_catalog', arguments: args });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(first!.text);
}

describe('ae_catalog', () => {
  it('lists every operation sorted by name', async () => {
    const client = await connectServer(
      registryWith(['layer.add_text', 'layer'], ['comp.create', 'comp']),
    );
    const { operations } = await catalog(client, { verbose: true });
    const names = operations.map((op) => operationDefinitionSchema.parse(op).name);
    expect(names).toEqual(['comp.create', 'layer.add_text']);
  });

  it('returns only name and description by default', async () => {
    const client = await connectServer(
      registryWith(['layer.add_text', 'layer'], ['comp.create', 'comp']),
    );
    const { operations } = await catalog(client, {});
    expect(operations).toEqual([
      { name: 'comp.create', description: 'Runs comp.create.' },
      { name: 'layer.add_text', description: 'Runs layer.add_text.' },
    ]);
  });

  it('filters to a single category', async () => {
    const client = await connectServer(
      registryWith(['layer.add_text', 'layer'], ['comp.create', 'comp']),
    );
    const { operations } = await catalog(client, { category: 'layer', verbose: true });
    expect(operations).toHaveLength(1);
    expect(operationDefinitionSchema.parse(operations[0]).name).toBe('layer.add_text');
  });

  it('includes the schema and required arguments of each operation with verbose', async () => {
    const client = await connectServer(defaultOperationRegistry());
    const { operations } = await catalog(client, { category: 'layer', verbose: true });
    const rename = operations.find((op) => (op as { name: string }).name === 'layer.rename') as {
      schema: Record<string, unknown>;
      required: string[];
    };
    expect(rename.required).toEqual(['name']);
    expect(Object.keys(rename.schema)).toEqual(expect.arrayContaining(['layer', 'index', 'name']));
  });

  // The bridge's capabilities include eval.run while the catalog hides it (off by default).
  it('names the operations the policy hides and how to enable them', async () => {
    const client = await connectServer(defaultOperationRegistry());
    const result = await catalog(client, {});
    expect(result.disabled).toEqual([{ name: 'eval.run', reason: expect.stringContaining('evalEnabled') }]);
  });

  it('returns an empty list when nothing is registered', async () => {
    const client = await connectServer(new OperationRegistry());
    const { operations } = await catalog(client, {});
    expect(operations).toEqual([]);
  });
});

async function describeOp(client: Client, op: string): Promise<{ isError?: boolean; body: Record<string, unknown> }> {
  const result = await client.callTool({ name: 'ae_describe', arguments: { op } });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return { isError: result.isError === true, body: JSON.parse(first!.text) };
}

describe('ae_catalog version', () => {
  it('returns unchanged when ifNoneMatch matches the current version', async () => {
    const client = await connectServer(defaultOperationRegistry());
    const first = await catalog(client, {});
    const version = (first as unknown as { version: string }).version;
    expect(typeof version).toBe('string');
    const again = (await client.callTool({
      name: 'ae_catalog',
      arguments: { ifNoneMatch: version },
    })) as { content: Array<{ text: string }> };
    expect(JSON.parse(again.content[0]!.text)).toEqual({ unchanged: true, version });
  });

  it('returns the full catalog when ifNoneMatch does not match', async () => {
    const client = await connectServer(registryWith(['layer.add_text', 'layer']));
    const { operations } = await catalog(client, { ifNoneMatch: 'stale' });
    expect(operations).toHaveLength(1);
  });

  it('changes when an operation schema changes', async () => {
    const before = registryWith(['layer.add_text', 'layer']);
    const after = new OperationRegistry();
    after.register({
      name: 'layer.add_text',
      category: 'layer' as never,
      description: 'Runs layer.add_text.',
      readOnly: true,
      destructive: false,
      schema: { text: { type: 'string' } },
    });
    const versionOf = async (registry: OperationRegistry): Promise<string> =>
      (await catalog(await connectServer(registry), {}) as unknown as { version: string }).version;
    expect(await versionOf(before)).not.toBe(await versionOf(after));
  });

  it('reports the same catalogVersion from ae_context', async () => {
    const root = join(await mkdtemp(join(tmpdir(), 'ae-mcp-catalog-')), '.ae-mcp');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ root, operations: defaultOperationRegistry() });
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);
    const context = await client.callTool({ name: 'ae_context', arguments: {} });
    const { catalogVersion } = JSON.parse((context.content as Array<{ text: string }>)[0]!.text);
    const { version } = await catalog(client, {});
    expect(catalogVersion).toBe(version);
    await client.close();
    await server.close();
  });
});

describe('ae_describe', () => {
  it('returns the full schema and required list of one operation', async () => {
    const client = await connectServer(defaultOperationRegistry());
    const { isError, body } = await describeOp(client, 'layer.rename');
    expect(isError).toBeFalsy();
    expect(body.name).toBe('layer.rename');
    expect(body.required).toEqual(['name']);
    expect(Object.keys(body.schema as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['layer', 'index', 'name']),
    );
  });

  it('returns INVALID_ARGS with the closest names for an unknown operation', async () => {
    const client = await connectServer(defaultOperationRegistry());
    const { isError, body } = await describeOp(client, 'layer.renam');
    expect(isError).toBe(true);
    expect(body.code).toBe('INVALID_ARGS');
    expect(String(body.message)).toContain('layer.rename');
  });
});
