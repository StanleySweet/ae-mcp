import { describe, it, expect } from 'vitest';
import { aeProcessId, isAeRunning, runningAeApp } from './ae-process.js';
import type { Runner } from './osascript-transport.js';

/** A pgrep fake: answers only for the process names in `running` (name -> pid). */
function pgrepRunner(running: Record<string, string>, calls: string[][] = []): Runner {
  return async (command, args) => {
    calls.push([command, ...args]);
    const pid = running[args[1] ?? ''];
    if (pid === undefined) {
      return Promise.reject(Object.assign(new Error('exit 1'), { code: 1 }));
    }
    return { stdout: `${pid}\n` };
  };
}

describe('isAeRunning', () => {
  it('is true when pgrep finds a process', async () => {
    const calls: string[][] = [];
    expect(await isAeRunning(pgrepRunner({ 'After Effects': '1234' }, calls))).toBe(true);
    expect(calls).toEqual([['pgrep', '-x', 'After Effects']]);
  });

  it('is true when only the beta process runs', async () => {
    const calls: string[][] = [];
    expect(await isAeRunning(pgrepRunner({ 'After Effects (Beta)': '777' }, calls))).toBe(true);
    expect(calls).toEqual([
      ['pgrep', '-x', 'After Effects'],
      ['pgrep', '-x', 'After Effects (Beta)'],
    ]);
  });

  it('is false when pgrep exits non-zero (no process)', async () => {
    const runner: Runner = () => Promise.reject(Object.assign(new Error('exit 1'), { code: 1 }));
    expect(await isAeRunning(runner)).toBe(false);
  });
});

describe('aeProcessId', () => {
  it('returns the beta pid when only the beta runs', async () => {
    expect(await aeProcessId(pgrepRunner({ 'After Effects (Beta)': '777' }))).toBe('777');
  });

  it('prefers the stable pid when both run', async () => {
    const running = { 'After Effects': '1234', 'After Effects (Beta)': '777' };
    expect(await aeProcessId(pgrepRunner(running))).toBe('1234');
  });

  it('returns null when neither runs', async () => {
    expect(await aeProcessId(pgrepRunner({}))).toBeNull();
  });
});

describe('runningAeApp', () => {
  it('says which app runs', async () => {
    expect(await runningAeApp(pgrepRunner({ 'After Effects': '1' }))).toBe('stable');
    expect(await runningAeApp(pgrepRunner({ 'After Effects (Beta)': '2' }))).toBe('beta');
    expect(await runningAeApp(pgrepRunner({}))).toBeNull();
  });
});
