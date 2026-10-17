import { appendFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { AEClient } from './ae-client.js';
import { HISTORY_FILE, HistoryLog } from './history.js';
import { OperationRegistry } from './operations.js';
import { createServer } from './server.js';

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ae-mcp-history-'));
}

function registry(): OperationRegistry {
  const registry = new OperationRegistry();
  registry.register({
    name: 'layer.rename',
    category: 'layer',
    description: 'Rename a layer.',
    readOnly: false,
    destructive: false,
    schema: { index: { type: 'number' }, name: { type: 'string' } },
    required: ['index', 'name'],
  });
  registry.register({
    name: 'project.info',
    category: 'project',
    description: 'Get project info.',
    readOnly: true,
    destructive: false,
    schema: {},
  });
  return registry;
}

async function connect(root: string, client: AEClient) {
  const server = createServer({ root, client, operations: registry() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: 'history-test', version: '0.0.0' });
  await mcp.connect(clientTransport);
  const tool = async (name: string, args: Record<string, unknown>) => {
    const result = await mcp.callTool({ name, arguments: args });
    const [first] = result.content as Array<{ text: string }>;
    return { isError: result.isError === true, json: JSON.parse(first!.text) as unknown };
  };
  return { tool, close: () => mcp.close() };
}

const okClient = {
  call: async () => ({ ok: true as const, result: null }),
} as unknown as AEClient;

describe('HistoryLog', () => {
  it('lists the last n entries newest first and defaults to 20', async () => {
    const log = new HistoryLog(await tempRoot());
    for (let i = 1; i <= 25; i += 1) {
      await log.append({ op: 'layer.rename', args: { index: i }, mutating: true, ok: true });
    }
    const listed = await log.list();
    expect(listed).toHaveLength(20);
    expect(listed[0]!.seq).toBe(25);
    expect(listed[19]!.seq).toBe(6);
    expect((await log.list(3)).map((entry) => entry.seq)).toEqual([25, 24, 23]);
  });

  it('names the undo group Claude: <op> and keeps the time and args', async () => {
    const log = new HistoryLog(await tempRoot());
    const entry = await log.append({ op: 'batch.run', args: { ops: [] }, mutating: true, ok: false, error: 'boom' });
    expect(entry.undoGroup).toBe('Claude: batch.run');
    expect(entry.args).toEqual({ ops: [] });
    expect(Number.isNaN(Date.parse(entry.time))).toBe(false);
    expect(entry.error).toBe('boom');
  });

  it('reloads entries from the file after a restart and skips a torn line', async () => {
    const root = await tempRoot();
    const first = new HistoryLog(root);
    await first.append({ op: 'layer.rename', args: { index: 1, name: 'A' }, mutating: true, ok: true });
    const file = join(root, HISTORY_FILE);
    await appendFile(file, '{"seq":2,"op":"torn');
    const second = new HistoryLog(root);
    const listed = await second.list();
    expect(listed.map((entry) => entry.op)).toEqual(['layer.rename']);
  });

  it('returns the undo groups of the last n mutating steps, skipping read-only calls', async () => {
    const log = new HistoryLog(await tempRoot());
    await log.append({ op: 'layer.rename', args: {}, mutating: true, ok: true });
    await log.append({ op: 'project.info', args: {}, mutating: false, ok: true });
    await log.append({ op: 'layer.rename', args: {}, mutating: true, ok: true });
    await log.append({ op: 'project.info', args: {}, mutating: false, ok: true });
    expect(await log.undoGroups(2)).toEqual(['Claude: layer.rename', 'Claude: layer.rename']);
    expect(await log.undoGroups(1)).toEqual(['Claude: layer.rename']);
  });

  it('returns null when fewer than n mutating steps exist', async () => {
    const log = new HistoryLog(await tempRoot());
    await log.append({ op: 'layer.rename', args: {}, mutating: true, ok: true });
    expect(await log.undoGroups(2)).toBeNull();
  });
});

describe('history tools', () => {
  it('logs every ae_do call and lists them through history_list', async () => {
    const root = await tempRoot();
    const { tool, close } = await connect(root, okClient);
    try {
      await tool('ae_do', { op: 'layer.rename', args: { index: 1, name: 'Hero' } });
      await tool('ae_do', { op: 'project.info' });
      const listed = (await tool('history_list', { n: 5 })).json as { entries: Array<Record<string, unknown>> };
      expect(listed.entries.map((entry) => entry.op)).toEqual(['project.info', 'layer.rename']);
      expect(listed.entries[1]).toMatchObject({
        op: 'layer.rename',
        args: { index: 1, name: 'Hero' },
        undoGroup: 'Claude: layer.rename',
        mutating: true,
        ok: true,
      });
    } finally {
      await close();
    }
  });

  it('history_undo names the groups and never calls the bridge to undo', async () => {
    const root = await tempRoot();
    const calls: string[] = [];
    const client = {
      call: async (tool: string) => {
        calls.push(tool);
        return { ok: true as const, result: null };
      },
    } as unknown as AEClient;
    const { tool, close } = await connect(root, client);
    try {
      await tool('ae_do', { op: 'layer.rename', args: { index: 1, name: 'A' } });
      await tool('ae_do', { op: 'layer.rename', args: { index: 2, name: 'B' } });
      calls.length = 0;
      const undo = (await tool('history_undo', { n: 2 })).json as Record<string, unknown>;
      expect(undo).toMatchObject({ undoGroups: ['Claude: layer.rename', 'Claude: layer.rename'], pressCmdZ: 2 });
      expect(String(undo.instruction)).toContain('Cmd+Z 2 time(s)');
      expect(String(undo.warning)).toContain('cannot be inspected by script');
      expect(calls).toEqual([]);
    } finally {
      await close();
    }
  });

  it('history_undo refuses when the history has too few Claude steps', async () => {
    const { tool, close } = await connect(await tempRoot(), okClient);
    try {
      const refused = await tool('history_undo', { n: 3 });
      expect(refused.isError).toBe(true);
      expect(refused.json).toMatchObject({ code: 'INVALID_ARGS' });
    } finally {
      await close();
    }
  });
});
