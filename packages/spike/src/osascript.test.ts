import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aeAppName, createOsaScriptDispatcher, type Runner } from './osascript.js';

let root: string;
let calls: Array<{ command: string; args: string[] }>;

const fakeRunner: Runner = async (command, args) => {
  calls.push({ command, args });
  return { stdout: 'pong\n' };
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ae-mcp-spike-'));
  process.env.AE_MCP_SPIKE_ROOT = root;
  process.env.AE_APP_NAME = 'Adobe After Effects 2025';
  calls = [];
});

afterEach(() => {
  delete process.env.AE_MCP_SPIKE_ROOT;
  delete process.env.AE_APP_NAME;
});

describe('osascript dispatcher (transport B)', () => {
  it('runs osascript DoScriptFile and returns the trimmed script result', async () => {
    const dispatch = createOsaScriptDispatcher(fakeRunner);
    await expect(dispatch.evalScript('"pong"')).resolves.toBe('pong');
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('osascript');
  });

  it('points DoScriptFile at a job file under the spike root', async () => {
    const dispatch = createOsaScriptDispatcher(fakeRunner);
    await dispatch.evalScript('"pong"');
    const tell = calls[0].args[1];
    expect(tell.startsWith(`tell application "Adobe After Effects 2025" to DoScriptFile "${join(root, 'jobs')}/`)).toBe(true);
    expect(tell.endsWith('.jsx"')).toBe(true);
  });

  it('honours the AE_APP_NAME env override', async () => {
    process.env.AE_APP_NAME = 'Adobe After Effects 2024';
    const dispatch = createOsaScriptDispatcher(fakeRunner);
    await dispatch.evalScript('"pong"');
    expect(calls[0].args[1]).toMatch(/^tell application "Adobe After Effects 2024" to DoScriptFile /);
  });

  it('aeAppName defaults and reads the env override', () => {
    delete process.env.AE_APP_NAME;
    expect(aeAppName()).toBe('Adobe After Effects 2025');
    process.env.AE_APP_NAME = 'Adobe After Effects 24';
    expect(aeAppName()).toBe('Adobe After Effects 24');
  });
});