import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, type JobMessage } from '@ae-mcp/protocol';
import { describe, it, expect } from 'vitest';
import { FileQueueTransport } from './file-queue-transport.js';
import { OsaScriptTransport, selectTransport, type Runner } from './osascript-transport.js';

async function queueRoot(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-osa-'));
  return join(home, '.ae-mcp');
}

function job(id: string, args: unknown, deadline = Date.now() + 5000): JobMessage {
  return { protocolVersion: PROTOCOL_VERSION, id, tool: 'echo', args, deadline };
}

const APP = 'Adobe After Effects 2025';

function tellArg(tell: string): string {
  const path = /DoScriptFile "([^"]+)"/.exec(tell)?.[1];
  if (path === undefined) {
    throw new Error(`unexpected tell: ${tell}`);
  }
  return path;
}

function aeRunner(root: string, calls: string[]): Runner {
  return async (_command, args) => {
    const tell = args[1] ?? '';
    calls.push(tell);
    const source = await readFile(tellArg(tell), 'utf8');
    const jobPath = /AEMCP\.processJob\("([^"]+)"\)/.exec(source)?.[1];
    if (jobPath === undefined) {
      return { stdout: '' };
    }
    const parsed = JSON.parse(await readFile(jobPath, 'utf8')) as JobMessage;
    await writeFile(
      join(root, 'bridge', 'outbox', `${parsed.id}.json`),
      JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ok: true, result: parsed.args }),
    );
    await rm(jobPath, { force: true });
    return { stdout: '' };
  };
}

describe('osascript transport', () => {
  it('runs the job through a DoScriptFile trigger and reads the result', async () => {
    const root = await queueRoot();
    const calls: string[] = [];
    const transport = new OsaScriptTransport(root, APP, aeRunner(root, calls));

    const result = await transport.call(job('o-1', { n: 7 }));

    expect(result).toMatchObject({ ok: true, result: { n: 7 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`tell application "${APP}" to DoScriptFile`);
    expect(tellArg(calls[0]!)).toBe(join(root, 'bridge', 'jobs', 'o-1.jsx'));
  });

  it('reports BRIDGE_NOT_LOADED when osascript cannot run the bridge', async () => {
    const root = await queueRoot();
    const runner: Runner = async () => {
      throw new Error('not scriptable');
    };
    const transport = new OsaScriptTransport(root, APP, runner);

    const result = await transport.call(job('o-2', {}));

    if (result.ok) {
      throw new Error(`expected a failure, got ${JSON.stringify(result)}`);
    }
    expect(result.error.code).toBe('BRIDGE_NOT_LOADED');
  });

  it('probes availability and selects osascript when reachable', async () => {
    const root = await queueRoot();
    const transport = await selectTransport({ root, appName: APP, runner: aeRunner(root, []) });
    expect(transport.name).toBe('osascript');
  });

  it('falls back to the file queue transport when probes fail', async () => {
    const root = await queueRoot();
    const runner: Runner = async () => {
      throw new Error('AppleScript unavailable');
    };
    const transport = await selectTransport({ root, appName: APP, runner });
    expect(transport).toBeInstanceOf(FileQueueTransport);
    expect(transport.name).toBe('file-queue');
  });
});