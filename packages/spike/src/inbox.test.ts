import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  inboxDir,
  nextId,
  outboxDir,
  readResult,
  send,
  waitForResult,
  writeAtomic,
} from './inbox.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ae-mcp-spike-'));
  process.env.AE_MCP_SPIKE_ROOT = root;
});

afterEach(() => {
  delete process.env.AE_MCP_SPIKE_ROOT;
});

describe('spike inbox', () => {
  it('send writes an atomic job file into the inbox', () => {
    const id = send('hello');
    expect(existsSync(join(inboxDir(), `${id}.txt`))).toBe(true);
    expect(readdirSync(inboxDir()).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('readResult is undefined until the loader writes the outbox file', () => {
    const id = send('hello');
    expect(readResult(id)).toBeUndefined();
    writeAtomic(join(outboxDir(), `${id}.txt`), 'hello');
    expect(readResult(id)).toBe('hello');
  });

  it('waitForResult resolves once the result appears', async () => {
    const id = send('ping');
    const pending = waitForResult(id, 1000);
    writeAtomic(join(outboxDir(), `${id}.txt`), 'ping');
    await expect(pending).resolves.toBe('ping');
  });

  it('waitForResult rejects on timeout', async () => {
    const id = send('never');
    await expect(waitForResult(id, 50, 10)).rejects.toThrow(/timed out/);
  });

  it('ids are unique', () => {
    expect(nextId()).not.toBe(nextId());
  });
});
