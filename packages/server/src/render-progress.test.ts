import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import type { AerenderProcess, SpawnAerender } from '@ae-mcp/core';
import { PROTOCOL_VERSION, makeError, type ResultMessage } from '@ae-mcp/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, it, expect } from 'vitest';
import type { AEClient } from './ae-client.js';
import { JobStore } from './jobs.js';
import { createServer } from './server.js';

// A fake aerender: the test writes the lines it would print to stdout, then closes it.
class FakeStream extends EventEmitter {
  write(text: string): void {
    this.emit('data', text);
  }
}

class FakeProcess extends EventEmitter implements AerenderProcess {
  stdout = new FakeStream();
  stderr = new FakeStream();

  kill(signal?: NodeJS.Signals): boolean {
    setTimeout(() => this.close(null, signal ?? 'SIGTERM'), 0);
    return true;
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('close', code, signal);
  }
}

function fakeClient(): AEClient {
  return {
    async call(tool: string): Promise<ResultMessage> {
      if (tool === 'ae_project_info') {
        return { protocolVersion: PROTOCOL_VERSION, ok: true, result: { file: '/projects/demo.aep' } };
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

async function connect(): Promise<{
  client: Client;
  store: JobStore;
  processes: FakeProcess[];
  notifications: string[];
  close: () => Promise<void>;
}> {
  const store = new JobStore();
  const processes: FakeProcess[] = [];
  const spawnAerender: SpawnAerender = () => {
    const process = new FakeProcess();
    processes.push(process);
    return process;
  };
  const server = createServer({
    root: tmpdir(),
    client: fakeClient(),
    jobStore: store,
    spawnAerender,
    aerender: '/fake/aerender',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const notifications: string[] = [];
  client.fallbackNotificationHandler = async (notification) => {
    notifications.push(notification.method);
  };
  await client.connect(clientTransport);
  return {
    client,
    store,
    processes,
    notifications,
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

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('ae_render progress notifications (#235)', () => {
  const closes: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closes.splice(0)) {
      await close();
    }
  });

  async function start(): ReturnType<typeof connect> {
    const harness = await connect();
    closes.push(harness.close);
    return harness;
  }

  it('sends each new frame count as progress when the client sent a progressToken', async () => {
    const harness = await start();
    const progress: Array<{ progress: number; total?: number }> = [];

    // With a progressToken the call stays open until the render ends.
    const pending = harness.client.callTool(
      { name: 'ae_render', arguments: { comp: 'Main', startFrame: 0, endFrame: 9 } },
      undefined,
      { onprogress: (value) => progress.push(value) },
    );
    await waitFor(() => harness.processes.length === 1);
    const process = harness.processes[0]!;
    process.stdout.write('PROGRESS: 00004 (5): 0 Seconds\n');
    process.stdout.write('PROGRESS: 00009 (10): 0 Seconds\n');
    await waitFor(() => progress.length === 2);
    expect(progress.map((entry) => entry.progress)).toEqual([5, 10]);
    expect(progress[1]).toMatchObject({ progress: 10, total: 10 });

    process.close(0);
    const started = await pending;
    expect(textContent(started as { content: unknown[] })).toEqual({ jobId: expect.any(String) });
  });

  it('never sends a value lower than one already sent', async () => {
    const harness = await start();
    const progress: number[] = [];

    const pending = harness.client.callTool({ name: 'ae_render', arguments: { comp: 'Main' } }, undefined, {
      onprogress: (value) => progress.push(value.progress),
    });
    await waitFor(() => harness.processes.length === 1);
    const process = harness.processes[0]!;
    process.stdout.write('PROGRESS: 00009 (10): 0 Seconds\n');
    process.stdout.write('PROGRESS: 00002 (3): 0 Seconds\n');
    process.stdout.write('PROGRESS: 00014 (15): 0 Seconds\n');
    await waitFor(() => progress.length === 2);
    expect(progress).toEqual([10, 15]);

    process.close(0);
    await pending;
  });

  it('sends no progress notifications without a progressToken, and the result keeps its shape', async () => {
    const harness = await start();

    const started = await harness.client.callTool({ name: 'ae_render', arguments: { comp: 'Main' } });
    expect(textContent(started as { content: unknown[] })).toEqual({ jobId: expect.any(String) });
    harness.processes[0]!.stdout.write('PROGRESS: 00004 (5): 0 Seconds\n');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.notifications).not.toContain('notifications/progress');
  });

  it('ends the job with an error and sends no progress after it finishes', async () => {
    const harness = await start();
    const progress: number[] = [];

    const pending = harness.client.callTool({ name: 'ae_render', arguments: { comp: 'Main' } }, undefined, {
      onprogress: (value) => progress.push(value.progress),
    });
    await waitFor(() => harness.processes.length === 1);
    const process = harness.processes[0]!;
    process.stdout.write('PROGRESS: 00004 (5): 0 Seconds\n');
    await waitFor(() => progress.length === 1);

    process.stderr.write('aerender ERROR: could not render\n');
    process.close(1);
    const started = await pending;
    const { jobId } = textContent(started as { content: unknown[] });
    expect(harness.store.get(jobId as string)?.status).toBe('failed');

    // Output that arrives after the job ended must not produce a notification.
    process.stdout.write('PROGRESS: 00009 (10): 0 Seconds\n');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(progress).toEqual([5]);
  });
});
