import { mkdtemp, readFile, readdir, rm, stat, chmod } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  queueRoot,
  bridgeDir,
  inboxDir,
  outboxDir,
  ensureQueue,
  writeAtomic,
} from './queue.js';

describe('queue layout', () => {
  it('resolves the default queue root to ~/.ae-mcp', () => {
    expect(queueRoot()).toBe(join(homedir(), '.ae-mcp'));
  });

  it('resolves inbox and outbox under the bridge dir', () => {
    const root = '/tmp/ae-mcp-root';
    expect(bridgeDir(root)).toBe(join(root, 'bridge'));
    expect(inboxDir(root)).toBe(join(root, 'bridge', 'inbox'));
    expect(outboxDir(root)).toBe(join(root, 'bridge', 'outbox'));
  });
});

describe('ensureQueue', () => {
  it('creates inbox and outbox', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-queue-'));
    try {
      await ensureQueue(root);
      expect((await stat(inboxDir(root))).isDirectory()).toBe(true);
      expect((await stat(outboxDir(root))).isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('chmods the queue root to 700', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-queue-'));
    try {
      await chmod(root, 0o755);
      await ensureQueue(root);
      expect((await stat(root)).mode & 0o777).toBe(0o700);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('writeAtomic', () => {
  it('writes the file, creating the parent directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-write-'));
    try {
      const file = join(outboxDir(root), 'job-1.txt');
      await writeAtomic(file, '{"ok":true}');
      expect(await readFile(file, 'utf8')).toBe('{"ok":true}');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves no temp file behind after a successful write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-write-'));
    try {
      const dir = outboxDir(root);
      await writeAtomic(join(dir, 'job-2.txt'), 'x');
      const leftovers = (await readdir(dir)).filter((f) => f.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('overwrites an existing target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ae-mcp-write-'));
    try {
      const file = join(outboxDir(root), 'job-1.txt');
      await writeAtomic(file, 'v1');
      await writeAtomic(file, 'v2');
      expect(await readFile(file, 'utf8')).toBe('v2');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});