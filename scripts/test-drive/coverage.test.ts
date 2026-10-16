import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { defaultOperationRegistry } from '../../packages/server/src/operations.js';
import { createServer } from '../../packages/server/src/server.js';
import { coveredNames, scenario } from './scenario.js';

async function toolNames(): Promise<string[]> {
  const stub = { call: () => Promise.reject(new Error('no After Effects in this test')) };
  const server = createServer({ client: stub as never, instructions: '' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'coverage', version: '0.0.0' });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => tool.name);
}

describe('test drive scenario', () => {
  it('covers every MCP tool and every registered operation', async () => {
    const expected = new Set([...(await toolNames()), ...defaultOperationRegistry().names()]);
    const covered = coveredNames();
    expect([...expected].filter((name) => !covered.has(name)).sort()).toEqual([]);
    expect([...covered].filter((name) => !expected.has(name)).sort()).toEqual([]);
  });

  it('gives every skip a reason and every step a unique id', () => {
    const ids = scenario.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const step of scenario.filter((s) => s.skip !== undefined)) {
      expect(step.skip!.length).toBeGreaterThan(5);
    }
  });
});
