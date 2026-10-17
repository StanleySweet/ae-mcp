import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AerenderProcess, SpawnAerender } from '@ae-mcp/core';
import { PROTOCOL_VERSION, errorSchema, makeError, type ResultMessage } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import type { AEClient } from './ae-client.js';
import { JobStore } from './jobs.js';
import type { RenderWatchOptions } from './render-watchdog.js';
import { createServer, type ServerOptions } from './server.js';
import type { Settings } from './settings.js';

class FakeStream extends EventEmitter {
  write(text: string): void {
    this.emit('data', text);
  }
}

class FakeProcess extends EventEmitter implements AerenderProcess {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed: NodeJS.Signals | null = null;

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = signal ?? 'SIGTERM';
    setTimeout(() => this.close(null, this.killed), 0);
    return true;
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('close', code, signal);
  }
}

/** A client that answers ae_project_info and rejects everything else. */
const FAKE_TEMPLATES = { outputModule: ['Lossless', 'H.264'], renderSettings: ['Best Settings'] };

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
      if (tool === 'render.templates') {
        return { protocolVersion: PROTOCOL_VERSION, ok: true, result: FAKE_TEMPLATES };
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
  settings?: Settings;
  renderWatch?: Partial<RenderWatchOptions>;
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
    settings: options.settings,
    renderWatch: options.renderWatch,
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

  it('fails a job whose aerender exits 0 without writing its literal output file', async () => {
    const harness = await start({ aerender: '/fake/aerender', projectFile: '/projects/demo.aep' });
    const output = join(await mkdtemp(join(tmpdir(), 'ae-mcp-render-')), 'never-written.mov');
    const started = (await harness.client.callTool({ name: 'ae_render', arguments: { comp: 'Main', output } })) as {
      content: unknown[];
    };
    const { jobId } = textContent(started);

    harness.processes[0]!.close(0);

    const failed = await waitForStatus(harness.client, jobId, 'failed');
    expect(failed.error).toContain('wrote no file');
  });

  it('fails a literal-output job that exits 0 with an empty file', async () => {
    const harness = await start({
      aerender: '/fake/aerender',
      renderWatch: { settleMs: 0, sizeOf: async () => 0 },
    });
    const dir = await mkdtemp(join(tmpdir(), 'ae-mcp-empty-'));
    const output = join(dir, 'empty.mov');
    const started = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main', output },
    })) as { content: unknown[] };
    const { jobId } = textContent(started);

    harness.processes[0]!.close(0);

    const failed = await waitForStatus(harness.client, jobId, 'failed');
    expect(failed.error).toContain('wrote an empty file');
  });

  it('succeeds a literal-output job whose file is non-empty and stable', async () => {
    const harness = await start({
      aerender: '/fake/aerender',
      renderWatch: { settleMs: 0, sizeOf: async () => 6 },
    });
    const dir = await mkdtemp(join(tmpdir(), 'ae-mcp-ok-'));
    const output = join(dir, 'movie.mov');
    const started = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main', output },
    })) as { content: unknown[] };
    const { jobId } = textContent(started);

    harness.processes[0]!.close(0);

    expect(await waitForStatus(harness.client, jobId, 'succeeded')).toMatchObject({
      result: { exitCode: 0 },
    });
  });

  it('fails a literal-output job whose file keeps changing size after exit 0', async () => {
    let size = 0;
    const harness = await start({
      aerender: '/fake/aerender',
      renderWatch: { settleMs: 0, sizeOf: async () => (size += 1) },
    });
    const dir = await mkdtemp(join(tmpdir(), 'ae-mcp-grow-'));
    const output = join(dir, 'growing.mov');
    const started = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main', output },
    })) as { content: unknown[] };
    const { jobId } = textContent(started);

    harness.processes[0]!.close(0);

    const failed = await waitForStatus(harness.client, jobId, 'failed');
    expect(failed.error).toContain('was still changing');
  });

  it('fails a job whose output stops growing with the stall message and kills aerender', async () => {
    const harness = await start({
      aerender: '/fake/aerender',
      renderWatch: { stallMs: 40, pollMs: 5, settleMs: 0, sizeOf: async () => 1024 },
    });
    const dir = await mkdtemp(join(tmpdir(), 'ae-mcp-stall-'));
    const output = join(dir, 'stalled.mov');
    const started = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main', output },
    })) as { content: unknown[] };
    const { jobId } = textContent(started);

    const failed = await waitForStatus(harness.client, jobId, 'failed');
    expect(failed.error).toMatch(/^render stalled: no progress and no output growth for \d+ s at 1024 bytes$/);
    expect(harness.processes[0]!.killed).toBe('SIGTERM');
  });

  it('names the signal when aerender is killed, with its last output line', async () => {
    const harness = await start({ aerender: '/fake/aerender' });
    const started = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main' },
    })) as { content: unknown[] };
    const { jobId } = textContent(started);

    const process = harness.processes[0]!;
    process.stdout.write('PROGRESS: 00003 (4): 1 Seconds\nlast words\n');
    process.close(null, 'SIGKILL');

    const failed = await waitForStatus(harness.client, jobId, 'failed');
    expect(failed.error).toBe('aerender killed by SIGKILL: last words');
  });

  it('says exit code unknown when aerender closes with no code, signal or output', async () => {
    const harness = await start({ aerender: '/fake/aerender' });
    const started = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main' },
    })) as { content: unknown[] };
    const { jobId } = textContent(started);

    harness.processes[0]!.close(null, null);

    const failed = await waitForStatus(harness.client, jobId, 'failed');
    expect(failed.error).toBe('aerender exited with code unknown');
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

  it('refuses to render in read-only mode before spawning aerender', async () => {
    const harness = await start({
      aerender: '/fake/aerender',
      settings: {
        readOnly: true,
        allowedCategories: null,
        evalEnabled: false,
        incrementBeforeDestructive: true,
      },
    });
    const result = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main', output: '/out/movie.mp4' },
    })) as { content: unknown[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe('FORBIDDEN');
    expect(harness.calls).toEqual([]);
  });

  // E16-2: an unknown template name is refused with the close names, before aerender starts.
  it('refuses an unknown omTemplate with close names before spawning aerender', async () => {
    const harness = await start({ aerender: '/fake/aerender' });
    const result = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main', omTemplate: 'Losless' },
    })) as { content: unknown[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe('INVALID_ARGS');
    expect(textContent(result)).toMatchObject({
      message: expect.stringContaining('"Lossless"'),
      details: { field: 'omTemplate', closest: ['Lossless'] },
    });
    expect(harness.calls).toEqual([]);
  });

  it('refuses an unknown rsTemplate and accepts names the bridge lists', async () => {
    const harness = await start({ aerender: '/fake/aerender' });
    const bad = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main', rsTemplate: 'Zzz Nothing' },
    })) as { content: unknown[]; isError?: boolean };
    expect(bad.isError).toBe(true);
    expect(textContent(bad).details).toMatchObject({ field: 'rsTemplate', closest: [] });
    expect(harness.calls).toEqual([]);
    const good = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main', omTemplate: 'H.264', rsTemplate: 'Best Settings' },
    })) as { isError?: boolean };
    expect(good.isError).toBeFalsy();
    expect(harness.calls).toHaveLength(1);
  });

  it('refuses an output path that already exists before spawning aerender', async () => {
    const harness = await start({ aerender: '/fake/aerender' });
    const dir = await mkdtemp(join(tmpdir(), 'ae-mcp-render-'));
    const output = join(dir, 'movie.mp4');
    await writeFile(output, 'keep me');
    const result = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main', output },
    })) as { content: unknown[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe('INVALID_ARGS');
    expect(harness.calls).toEqual([]);
    expect(await readFile(output, 'utf8')).toBe('keep me');
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

  it('cancels a running job and removes its partial output', async () => {
    const harness = await start({ aerender: '/fake/aerender' });
    const dir = await mkdtemp(join(tmpdir(), 'ae-mcp-cancel-'));
    const output = join(dir, 'movie.mp4');
    const started = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main', output },
    })) as { content: unknown[] };
    const { jobId } = textContent(started);

    const record = harness.store.list().find((job) => job.status === 'running')!;
    await writeFile(output, 'partial');
    // ext4 derives a file's mtime from a coarse per-tick clock that can lag
    // Date.now(), so a file written right after `createdAt` can appear older
    // than the job start. Pin the partial file's mtime past that instant so the
    // cleanup guard is deterministic on every filesystem.
    const partialAt = new Date(record.createdAt + 1000);
    await utimes(output, partialAt, partialAt);

    const process = harness.processes[0]!;
    const cancelled = (await harness.client.callTool({
      name: 'job_cancel',
      arguments: { jobId },
    })) as { content: unknown[]; isError?: boolean };

    expect(process.killed).toBe('SIGTERM');
    expect(textContent(cancelled)).toMatchObject({ status: 'cancelled' });
    await expect(stat(output)).rejects.toThrow();
  });

  it('leaves an already-finished job untouched when cancelled', async () => {
    const harness = await start({ aerender: '/fake/aerender' });
    const started = (await harness.client.callTool({
      name: 'ae_render',
      arguments: { comp: 'Main' },
    })) as { content: unknown[] };
    const { jobId } = textContent(started);
    harness.processes[0]!.close(0);
    await waitForStatus(harness.client, jobId, 'succeeded');

    const result = (await harness.client.callTool({
      name: 'job_cancel',
      arguments: { jobId },
    })) as { content: unknown[]; isError?: boolean };
    expect(textContent(result)).toMatchObject({ status: 'succeeded' });
  });

  it('returns UNKNOWN_JOB when cancelling an unknown job', async () => {
    const harness = await start({ aerender: '/fake/aerender' });
    const result = (await harness.client.callTool({
      name: 'job_cancel',
      arguments: { jobId: 'job-nope' },
    })) as { content: unknown[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe('UNKNOWN_JOB');
  });
});
