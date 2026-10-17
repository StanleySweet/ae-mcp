import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { AEClient } from './ae-client.js';
import type { HistoryEntry } from './history.js';
import { OperationRegistry } from './operations.js';
import { batchJson, replayJsx, replaySteps } from './replay.js';
import { createServer } from './server.js';

function registry(): OperationRegistry {
  const registry = new OperationRegistry();
  const schema = {
    comp: { type: 'string' },
    index: { type: 'number' },
    name: { type: 'string' },
    position: { type: 'array' },
    ops: { type: 'array' },
  };
  const def = (name: string, readOnly: boolean) =>
    registry.register({ name, category: 'layer', description: name, readOnly, destructive: false, schema });
  def('layer.rename', false);
  def('layer.set_transform', false);
  def('project.info', true);
  def('project.save', false);
  def('batch.run', false);
  return registry;
}

function entry(seq: number, op: string, args: Record<string, unknown>, ok = true): HistoryEntry {
  return {
    seq,
    time: new Date(0).toISOString(),
    op,
    args,
    undoGroup: `Claude: ${op}`,
    mutating: op !== 'project.info',
    ok,
  };
}

describe('replaySteps', () => {
  it('keeps successful mutating steps in order and drops read-only and failed calls', () => {
    const plan = replaySteps(
      [
        entry(1, 'layer.rename', { comp: 'Main', index: 1, name: 'A' }),
        entry(2, 'project.info', {}),
        entry(3, 'layer.rename', { comp: 'Main', index: 2, name: 'B' }, false),
        entry(4, 'layer.set_transform', { index: 1, position: [1, 2] }),
      ],
      registry(),
    );
    expect(plan.ops).toEqual([
      { op: 'layer.rename', args: { comp: 'Main', index: 1, name: 'A' } },
      { op: 'layer.set_transform', args: { index: 1, position: [1, 2] } },
    ]);
    expect(plan.skipped).toEqual([{ seq: 3, op: 'layer.rename', reason: 'the call failed' }]);
  });

  it('flattens a batch.run entry into its mutating sub-ops', () => {
    const plan = replaySteps(
      [
        entry(1, 'batch.run', {
          ops: [
            { op: 'layer.rename', args: { index: 1, name: 'A' } },
            { op: 'project.info', args: {} },
            { op: 'batch.run', args: { ops: [] } },
          ],
        }),
      ],
      registry(),
    );
    expect(plan.ops).toEqual([{ op: 'layer.rename', args: { index: 1, name: 'A' } }]);
    expect(plan.skipped).toEqual([{ seq: 1, op: 'batch.run', reason: 'nested batch.run' }]);
  });

  it('skips the save and open ops that batch.run refuses', () => {
    const plan = replaySteps([entry(1, 'project.save', {})], registry());
    expect(plan.ops).toEqual([]);
    expect(plan.skipped).toEqual([{ seq: 1, op: 'project.save', reason: 'cannot run inside batch.run' }]);
  });

  it('retargets every step that names a comp, and leaves the others alone', () => {
    const plan = replaySteps(
      [entry(1, 'layer.rename', { comp: 'Main', index: 1, name: 'A' }), entry(2, 'layer.set_transform', { index: 2 })],
      registry(),
      'Shot 2',
    );
    expect(plan.ops[0]?.args).toEqual({ comp: 'Shot 2', index: 1, name: 'A' });
    expect(plan.ops[1]?.args).toEqual({ index: 2 });
  });

  it('does not mutate the recorded args', () => {
    const args = { comp: 'Main', index: 1 };
    replaySteps([entry(1, 'layer.rename', args)], registry(), 'Other');
    expect(args.comp).toBe('Main');
  });
});

describe('batchJson and replayJsx', () => {
  const plan = { ops: [{ op: 'layer.rename', args: { index: 1, name: 'A"quoted' } }], skipped: [] };

  it('writes the args object batch.run takes', () => {
    expect(JSON.parse(batchJson(plan))).toEqual({ ops: plan.ops });
  });

  it('embeds the bridge payload, the steps and a run footer', () => {
    const jsx = replayJsx(plan, '/* payload */\nvar AEMCP = {};', 'Main', '2026-10-17T00:00:00.000Z');
    expect(jsx.startsWith('/* payload */\nvar AEMCP = {};')).toBe(true);
    expect(jsx).toContain('var AEMCP_REPLAY_COMP = "Main";');
    expect(jsx).toContain("AEMCP.invoke('batch.run'");
    expect(jsx).toContain('quoted');
    expect(jsx).toContain('JSON.parse("{');
  });
});

describe('history_export tool', () => {
  async function connect(root: string) {
    const stub = { call: async () => ({ ok: true as const, result: null }) } as unknown as AEClient;
    const server = createServer({ root, client: stub, operations: registry() });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcp = new Client({ name: 'replay-test', version: '0.0.0' });
    await mcp.connect(clientTransport);
    const tool = async (args: Record<string, unknown>) => {
      const result = await mcp.callTool({ name: 'history_export', arguments: args });
      const [first] = result.content as Array<{ text: string }>;
      return { isError: result.isError === true, json: JSON.parse(first!.text) as Record<string, unknown> };
    };
    return { tool, close: () => mcp.close() };
  }

  it('refuses an empty history instead of writing an empty file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-replay-'));
    const { tool, close } = await connect(root);
    try {
      const result = await tool({});
      expect(result.isError).toBe(true);
      expect(String(result.json.message)).toContain('history is empty');
    } finally {
      await close();
    }
  });

  it('writes the batch args to the default folder under the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-replay-'));
    const stub = { call: async () => ({ ok: true as const, result: null }) } as unknown as AEClient;
    const server = createServer({ root, client: stub, operations: registry() });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcp = new Client({ name: 'replay-test', version: '0.0.0' });
    await mcp.connect(clientTransport);
    try {
      await mcp.callTool({ name: 'ae_do', arguments: { op: 'layer.rename', args: { index: 1, name: 'A' } } });
      const result = await mcp.callTool({ name: 'history_export', arguments: { format: 'batch', comp: 'Shot' } });
      const [first] = result.content as Array<{ text: string }>;
      const json = JSON.parse(first!.text) as { path: string; steps: number; batch: { ops: unknown[] } };
      expect(json.path.startsWith(join(root, 'replays'))).toBe(true);
      expect(json.steps).toBe(1);
      expect(json.batch.ops).toEqual([{ op: 'layer.rename', args: { index: 1, name: 'A' } }]);
      expect(JSON.parse(await readFile(json.path, 'utf8'))).toEqual({ ops: json.batch.ops });
    } finally {
      await mcp.close();
    }
  });

  it('refuses jsx export when no bridge payload is installed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-replay-'));
    await mkdir(join(root, 'bridge'), { recursive: true });
    await writeFile(join(root, 'bridge', 'unrelated.txt'), 'x');
    const stub = { call: async () => ({ ok: true as const, result: null }) } as unknown as AEClient;
    const server = createServer({ root, client: stub, operations: registry() });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcp = new Client({ name: 'replay-test', version: '0.0.0' });
    await mcp.connect(clientTransport);
    try {
      await mcp.callTool({ name: 'ae_do', arguments: { op: 'layer.rename', args: { index: 1, name: 'A' } } });
      const result = await mcp.callTool({ name: 'history_export', arguments: { format: 'jsx' } });
      expect(result.isError).toBe(true);
      const [first] = result.content as Array<{ text: string }>;
      expect(first!.text).toContain('no installed bridge payload');
    } finally {
      await mcp.close();
    }
  });
});
