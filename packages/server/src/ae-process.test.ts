import { describe, it, expect } from 'vitest';
import { isAeRunning } from './ae-process.js';
import type { Runner } from './osascript-transport.js';

describe('isAeRunning', () => {
  it('is true when pgrep finds a process', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: Runner = async (command, args) => {
      calls.push({ command, args });
      return { stdout: '1234\n' };
    };
    expect(await isAeRunning(runner)).toBe(true);
    expect(calls).toEqual([{ command: 'pgrep', args: ['-x', 'After Effects'] }]);
  });

  it('is false when pgrep exits non-zero (no process)', async () => {
    const runner: Runner = () => Promise.reject(Object.assign(new Error('exit 1'), { code: 1 }));
    expect(await isAeRunning(runner)).toBe(false);
  });
});
