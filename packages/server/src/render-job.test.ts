import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import type { AerenderProcess, SpawnAerender } from '@ae-mcp/core';
import { PROTOCOL_VERSION, errorSchema, makeError, type ResultMessage } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import type { AEClient } from './ae-client.js';
import { JobStore } from './jobs.js';
import { createServer, type ServerOptions } from './server.js';

class FakeStream extends EventEmitter {
  write(text: string): void {
    this.emit('data', text);
  }
}

class FakeProcess extends EventEmitter implements AerenderProcess {
  stdout = new FakeStream();
  stderr = new FakeStream();

  kill(): boolean {
    return true;
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('close', code, signal);
  }
}

/** A client that answers ae_project_info and rejects everything else. */
function fakeClient(projectFile: string | null): AEClient {
  return {
    async call(tool: string): Promise<ResultMessage> {
      if (tool === 'ae_project_info') {
        return {
          protocolVersion: PROTOCOL_VERSION,
          ok: true,
          result: { file: projectFile },
        };
      }
      return {
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: makeError('UNKNOWN_TOOL', `no handler for ${tool}`),
      };
    },
    async purgeStale(): Promise<number> {
      return 0;
    },
  };
}

interface Harness {
  client: Client;
  store: JobStore;
  processes: FakeProcess[];
  calls: [string, string[]][];
  close: () => Promise<void>;
}

async function connect(options: {
  projectFile?: string | null;
  aerender?: string;
  failSpawn?: boolean;
} = {}): Promise<Harness> {
  const store = new JobStore();
  const processes: FakeProcess[] = [];
  const calls: [string, string[]][] = [];
  const spawnAerender: SpawnAerender = options.failSpawn
    ? () => {
        throw new Error('spawn EACCES');
      }
    : (command, args) => {
        const process = new FakeProcess();
        processes.push(process);
        calls.push([command, args]);
        return process;
      };
  const serverOptions: ServerOptions = {
    root: tmpdir(),
    client: fakeClient(
      options.projectFile === undefined ? '/projects/demo.aep' : options.projectFile,
    ),
    jobStore: store,
    spawnAerender,
  };
  if (options.aerender !== undefined) {
    serverOptions.aerender = options.aerender;
  } else {
    serverOptions.applicationsDir = '/nope/not/here';
  }
  const server = createServer(serverOptions);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    store,
    processes,
    calls,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function textContent(result: { content: unknown[] }): Record<string, unknown> {
  const item = result.content.find((entry) => (entry as { type?: string }).type === 'text') as {
    text: string;
  };
  return JSON.parse(item.text) as Record<string, unknown>;
}

function errorCode(result: { content: unknown[] }): string {
  const [first] = result.content as Array<{ type: string; text: string }>;
  return errorSchema.parse(JSON.parse(first!.text)).code;
}

async function status(
  client: Client,
  jobId: unknown,
): Promise<Record<string, unknown>> {
  const result = (await client.callTool({
    name: 'job_status',
    arguments: { jobId },
  })) as { content: unknown[] };
  return textContent(result);
}

async function waitForStatus(
  client: Client,
  jobId: unknown,
  expected: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const record = await status(client, jobId);
    if (record.status === expected) {
      return record;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return status(client, jobId);
}

describe('ae_render / job_status', () => {
  const closes: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  async function start(options?: Parameters<typeof connect>[0]): Promise<Harness> {
    const harness = await connect(options);
    closes.push(harness.close);
    return harness;
  }

  it('starts a render job and reports progress and success', async () => {
    const harness = await start({ aerender: '/fake/aerender', projectFile: '/projects/demo.aep' });
    const started = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main', output: '/out/[name].png' },
    })) as { content: unknown[] };
    const { jobId } = textContent(started);
    expect(jobId).toBeTypeOf('string');

    expect(harness.calls[0]?.[0]).toBe('/fake/aerender');
    expect(harness.calls[0]?.[1]).toContain('/projects/demo.aep');
    expect(harness.calls[0]?.[1]).toContain('-comp');

    expect(await status(harness.client, jobId)).toMatchObject({ status: 'running', kind: 'render' });

    const process = harness.processes[0]!;
    process.stdout.write('PROGRESS: 00005 (10): 2 Seconds\n');
    expect(await waitForStatus(harness.client, jobId, 'running')).toMatchObject({
      progress: { frame: 5, rendered: 10, seconds: 2 },
    });

    process.close(0);
    const done = await waitForStatus(harness.client, jobId, 'succeeded');
    expect(done.result).toEqual({ exitCode: 0 });
    expect(done.finishedAt).toBeTypeOf('number');
  });

  it('resolves the project file from the open project when omitted', async () => {
    const harness = await start({ aerender: '/fake/aerender', projectFile: '/projects/open.aep' });
    await harness.client.callTool({ name: 'ae_render', arguments: { comp: 'Main' } });
    expect(harness.calls[0]?.[1]).toContain('/projects/open.aep');
  });

  it('marks the job failed with the last error line', async () => {
    const harness = await start({ aerender: '/fake/aerender' });
    const started = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main' },
    })) as { content: unknown[] };
    const { jobId } = textContent(started);

    const process = harness.processes[0]!;
    process.stderr.write('some noise\naerender ERROR -1: could not open project\n');
    process.close(1);

    const failed = await waitForStatus(harness.client, jobId, 'failed');
    expect(failed.error).toBe('aerender ERROR -1: could not open project');
  });

  it('requires exactly one of comp or rqindex', async () => {
    const harness = await start({ aerender: '/fake/aerender' });
    const missing = (await harness.client.callTool({ name: 'ae_render', arguments: {} })) as {
      content: unknown[];
      isError?: boolean;
    };
    const both = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main', rqindex: 1 },
    })) as { content: unknown[]; isError?: boolean };
    expect(missing.isError).toBe(true);
    expect(errorCode(missing)).toBe('INVALID_ARGS');
    expect(errorCode(both)).toBe('INVALID_ARGS');
  });

  it('reports AERENDER_NOT_FOUND when no executable is discovered', async () => {
    const harness = await start({ projectFile: '/projects/demo.aep' });
    const result = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main' },
    })) as { content: unknown[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe('AERENDER_NOT_FOUND');
  });

  it('refuses to render an unsaved project', async () => {
    const harness = await start({ aerender: '/fake/aerender', projectFile: null });
    const result = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main' },
    })) as { content: unknown[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe('UNSAVED_PROJECT');
  });

  it('returns UNKNOWN_JOB for an id that was never started', async () => {
    const harness = await start({ aerender: '/fake/aerender' });
    const result = (await harness.client.callTool({
      name: 'job_status',
      arguments: { jobId: 'job-nope' },
    })) as { content: unknown[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe('UNKNOWN_JOB');
  });

  it('fails without leaving a job running when aerender cannot start', async () => {
    const harness = await start({ aerender: '/fake/aerender', failSpawn: true });
    const result = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main' },
    })) as { content: unknown[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe('SCRIPT_ERROR');
    expect(harness.store.list().some((job) => job.status === 'running')).toBe(false);
  });
});
