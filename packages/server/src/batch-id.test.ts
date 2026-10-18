import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResultMessage } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AEClient } from './ae-client.js';
import { BatchLog, BATCH_LOG_FILE, MAX_BATCH_RECORDS } from './batch-log.js';
import { createServer } from './server.js';
import { DEFAULT_SETTINGS } from './settings.js';

type Reply = ResultMessage;

interface Harness {
  client: Client;
  calls: Array<{ tool: string; args: unknown }>;
}

const OK: Reply = { protocolVersion: 1, ok: true, result: { results: [1] } };

// Each batch.run call takes the next scripted reply; anything else answers ok.
async function connect(root: string, replies: Reply[] = []): Promise<Harness> {
  const calls: Array<{ tool: string; args: unknown }> = [];
  const aeClient: AEClient = {
    purgeStale: async () => 0,
    call: async (tool, args) => {
      calls.push({ tool, args });
      if (tool !== 'batch.run') return { protocolVersion: 1, ok: true, result: null };
      return replies.shift() ?? OK;
    },
  };
  const server = createServer({
    root,
    client: aeClient,
    settings: { ...DEFAULT_SETTINGS, backupMode: 'off' },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, calls };
}

const ops = { ops: [{ op: 'layer.rename', args: { index: 1, name: 'A' } }] };

async function aeDo(
  client: Client,
  args: Record<string, unknown> = ops,
): Promise<{ isError: boolean; body: Record<string, unknown> }> {
  const result = await client.callTool({ name: 'ae_do', arguments: { op: 'batch.run', args } });
  const [first] = result.content as Array<{ text: string }>;
  return { isError: result.isError === true, body: JSON.parse(first!.text) as Record<string, unknown> };
}

async function status(client: Client, batchId: string): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name: 'ae_do', arguments: { op: 'batch.status', args: { batchId } } });
  const [first] = result.content as Array<{ text: string }>;
  return JSON.parse(first!.text) as Record<string, unknown>;
}

const FAILED: Reply = {
  protocolVersion: 1,
  ok: false,
  error: { code: 'SCRIPT_ERROR', message: 'batch stopped at ops[1] (layer.rename): boom', details: { step: 1 } },
};

describe('batch.run batch ids', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ae-mcp-batch-id-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('generates a batchId when absent, returns it and reports it applied afterwards', async () => {
    const { client } = await connect(root);

    const run = await aeDo(client);

    expect(run.isError).toBe(false);
    const batchId = run.body.batchId as string;
    expect(batchId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(await status(client, batchId)).toMatchObject({ batchId, status: 'applied' });
  });

  it('answers unknown for an id no batch.run used, without calling the bridge', async () => {
    const { client, calls } = await connect(root);

    expect(await status(client, 'never-ran')).toMatchObject({ batchId: 'never-ran', status: 'unknown' });
    expect(calls).toEqual([]);
  });

  it('refuses a retry of an applied batchId with its earlier result and runs nothing', async () => {
    const { client, calls } = await connect(root);

    const first = await aeDo(client, { ...ops, batchId: 'retry-ok' });
    const retry = await aeDo(client, { ...ops, batchId: 'retry-ok' });

    expect(first.body.batchId).toBe('retry-ok');
    expect(retry.isError).toBe(true);
    const error = retry.body as { code: string; details: { batchId: string; earlier: { result: unknown } } };
    expect(error.code).toBe('BATCH_ALREADY_APPLIED');
    expect(error.details.batchId).toBe('retry-ok');
    expect(error.details.earlier.result).toEqual({ results: [1] });
    expect(calls.filter((call) => call.tool === 'batch.run')).toHaveLength(1);
  });

  it('records a failed batch with its step and message, and lets a retry run again', async () => {
    const { client, calls } = await connect(root, [FAILED, OK]);

    const failed = await aeDo(client, { ...ops, batchId: 'retry-fail' });

    expect(failed.isError).toBe(true);
    expect(failed.body.details).toMatchObject({ batchId: 'retry-fail' });
    expect(await status(client, 'retry-fail')).toEqual({
      batchId: 'retry-fail',
      status: 'failed',
      step: 1,
      message: 'batch stopped at ops[1] (layer.rename): boom',
      at: expect.any(String),
    });

    const retry = await aeDo(client, { ...ops, batchId: 'retry-fail' });

    expect(retry.isError).toBe(false);
    expect(retry.body.retryOf).toMatchObject({ outcome: 'failed', step: 1 });
    expect(calls.filter((call) => call.tool === 'batch.run')).toHaveLength(2);
    expect(await status(client, 'retry-fail')).toMatchObject({ status: 'applied' });
  });

  it('keeps a generated id on a failed batch so the caller can check it', async () => {
    const { client } = await connect(root, [FAILED]);

    const failed = await aeDo(client);

    const batchId = (failed.body.details as { batchId: string }).batchId;
    expect(await status(client, batchId)).toMatchObject({ status: 'failed', step: 1 });
  });

  it('does not record a transport timeout, so the batch stays unknown and a retry runs', async () => {
    const timeout: Reply = { protocolVersion: 1, ok: false, error: { code: 'TIMEOUT', message: 'job deadline exceeded' } };
    const { client, calls } = await connect(root, [timeout, OK]);

    await aeDo(client, { ...ops, batchId: 'retry-timeout' });
    expect(await status(client, 'retry-timeout')).toMatchObject({ status: 'unknown' });

    const retry = await aeDo(client, { ...ops, batchId: 'retry-timeout' });
    expect(retry.isError).toBe(false);
    expect(calls.filter((call) => call.tool === 'batch.run')).toHaveLength(2);
  });

  it('sends the sub-operations to the bridge unchanged, without the batchId', async () => {
    const { client, calls } = await connect(root);

    await aeDo(client, { ...ops, batchId: 'tagged' });

    const sent = calls.find((call) => call.tool === 'batch.run')!.args as { ops: unknown[] };
    expect(sent.ops).toEqual(ops.ops);
  });

  it('rejects an invalid batchId before the bridge is called', async () => {
    const { client, calls } = await connect(root);

    const run = await aeDo(client, { ...ops, batchId: 'has spaces' });

    expect(run.isError).toBe(true);
    expect(run.body.code).toBe('INVALID_ARGS');
    expect(calls).toEqual([]);
  });

  it('rejects an empty batch.status id', async () => {
    const { client } = await connect(root);

    const result = await client.callTool({ name: 'ae_do', arguments: { op: 'batch.status', args: { batchId: '' } } });

    expect(result.isError).toBe(true);
  });

  it('keeps only the last records in the log file', async () => {
    const log = new BatchLog(root);
    for (let i = 0; i < MAX_BATCH_RECORDS + 5; i++) {
      await log.record({ batchId: `b${i}`, outcome: 'applied', at: new Date(i * 1000).toISOString() });
    }

    const lines = (await readFile(join(root, BATCH_LOG_FILE), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(MAX_BATCH_RECORDS);
    expect(await log.find('b0')).toBeUndefined();
    expect(await log.find(`b${MAX_BATCH_RECORDS + 4}`)).toMatchObject({ outcome: 'applied' });
  });

  it('skips a corrupt line instead of failing the status check', async () => {
    await writeFile(join(root, BATCH_LOG_FILE), 'not json\n{"batchId":"ok-one","outcome":"applied","at":"x"}\n');
    const { client } = await connect(root);

    expect(await status(client, 'ok-one')).toMatchObject({ status: 'applied' });
  });
});
