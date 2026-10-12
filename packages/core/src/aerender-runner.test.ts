import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import type { AerenderEvent } from './aerender-progress.js';
import {
  buildAerenderArgs,
  runAerender,
  type AerenderProcess,
  type AerenderRunOptions,
  type SpawnAerender,
} from './aerender-runner.js';

class FakeStream extends EventEmitter {
  write(text: string): void {
    this.emit('data', text);
  }
}

class FakeProcess extends EventEmitter implements AerenderProcess {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed: NodeJS.Signals | false = false;

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = signal ?? 'SIGTERM';
    return true;
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('close', code, signal);
  }
}

function fakeSpawn(): { spawn: SpawnAerender; child: FakeProcess; calls: [string, string[]][] } {
  const child = new FakeProcess();
  const calls: [string, string[]][] = [];
  const spawn: SpawnAerender = (command, args) => {
    calls.push([command, args]);
    return child;
  };
  return { spawn, child, calls };
}

const base: AerenderRunOptions = { aerender: '/Applications/aerender', project: '/p.aep' };

describe('buildAerenderArgs', () => {
  it('defaults to ERRORS_AND_PROGRESS and DO_NOT_SAVE_CHANGES', () => {
    expect(buildAerenderArgs(base)).toEqual([
      '-project',
      '/p.aep',
      '-v',
      'ERRORS_AND_PROGRESS',
      '-close',
      'DO_NOT_SAVE_CHANGES',
    ]);
  });

  it('emits comp and output options in a stable order', () => {
    expect(
      buildAerenderArgs({
        ...base,
        comp: 'Main',
        omTemplate: 'PNG',
        output: '/out/[name].png',
        startFrame: 1,
        endFrame: 10,
        increment: 2,
        reuse: true,
      }),
    ).toEqual([
      '-reuse',
      '-project',
      '/p.aep',
      '-comp',
      'Main',
      '-OMtemplate',
      'PNG',
      '-output',
      '/out/[name].png',
      '-s',
      '1',
      '-e',
      '10',
      '-i',
      '2',
      '-v',
      'ERRORS_AND_PROGRESS',
      '-close',
      'DO_NOT_SAVE_CHANGES',
    ]);
  });

  it('supports rqindex and Render-Queue templates', () => {
    expect(buildAerenderArgs({ ...base, rqindex: 3, rsTemplate: 'Best' })).toContain('-rqindex');
    expect(buildAerenderArgs({ ...base, rqindex: 3, rsTemplate: 'Best' })).toContain('3');
    expect(buildAerenderArgs({ ...base, rqindex: 3, rsTemplate: 'Best' })).toContain('Best');
  });
});

describe('runAerender', () => {
  it('spawns aerender with the built args and collects output', async () => {
    const { spawn, child, calls } = fakeSpawn();
    const handle = runAerender({ ...base, spawn });

    child.stdout.write('aerender version 24.0.0x78\nPROGRESS: 00000 (1): 0 Seconds\n');
    child.stderr.write('PROGRESS: Output Module: Lossless\n');
    child.close(0);

    const result = await handle.result;
    expect(calls).toEqual([['/Applications/aerender', buildAerenderArgs(base)]]);
    expect(result.code).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(result.output).toEqual([
      'aerender version 24.0.0x78',
      'PROGRESS: 00000 (1): 0 Seconds',
    ]);
    expect(result.errors).toEqual(['PROGRESS: Output Module: Lossless']);
  });

  it('emits parsed events for each meaningful line', async () => {
    const { spawn, child } = fakeSpawn();
    const events: AerenderEvent[] = [];
    const handle = runAerender({ ...base, spawn, onEvent: (event) => events.push(event) });

    child.stdout.write('PROGRESS: Launching After Effects...\nPROGRESS: 00007 (8): 12 Seconds\n');
    child.close(0);
    await handle.result;

    expect(events).toEqual([
      { type: 'launching' },
      { type: 'progress', frame: 7, rendered: 8, seconds: 12 },
    ]);
  });

  it('handles a non-zero exit and partial trailing lines', async () => {
    const { spawn, child } = fakeSpawn();
    const handle = runAerender({ ...base, spawn });

    child.stderr.write('aerender ERROR -1: boom');
    child.close(1);

    const result = await handle.result;
    expect(result.code).toBe(1);
    expect(result.errors).toEqual(['aerender ERROR -1: boom']);
  });

  it('cancels via the handle and marks the result', async () => {
    const { spawn, child } = fakeSpawn();
    const handle = runAerender({ ...base, spawn });

    handle.cancel();
    expect(child.killed).toBe('SIGTERM');
    child.close(null, 'SIGTERM');

    const result = await handle.result;
    expect(result.cancelled).toBe(true);
    expect(result.signal).toBe('SIGTERM');
  });

  it('cancels when the abort signal fires', async () => {
    const { spawn, child } = fakeSpawn();
    const controller = new AbortController();
    const handle = runAerender({ ...base, spawn, signal: controller.signal });

    controller.abort();
    expect(child.killed).toBe('SIGTERM');
    child.close(null, 'SIGTERM');
    expect((await handle.result).cancelled).toBe(true);
  });

  it('resolves an error event without spawning output', async () => {
    const { spawn, child } = fakeSpawn();
    const handle = runAerender({ ...base, spawn });

    child.emit('error', new Error('ENOENT'));
    const result = await handle.result;

    expect(result.code).toBeNull();
    expect(result.errors).toEqual(['ENOENT']);
  });

  it('does not call kill after the process closed', async () => {
    const { spawn, child } = fakeSpawn();
    const handle = runAerender({ ...base, spawn });
    const spy = vi.spyOn(child, 'kill');

    child.close(0);
    await handle.result;
    handle.cancel();

    expect(spy).not.toHaveBeenCalled();
  });
});
