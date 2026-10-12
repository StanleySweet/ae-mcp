import { mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { cleanupPartialOutput } from './render-output.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ae-mcp-output-'));
}

describe('cleanupPartialOutput', () => {
  it('removes a single output file written by the job', async () => {
    const dir = await tempDir();
    const file = join(dir, 'movie.mp4');
    const startedAt = Date.now() - 5_000;
    await writeFile(file, 'partial');

    expect(await cleanupPartialOutput(file, startedAt)).toEqual([file]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('leaves a pre-existing file (older than the job) alone', async () => {
    const dir = await tempDir();
    const file = join(dir, 'movie.mp4');
    await writeFile(file, 'keep me');
    const past = new Date(Date.now() - 60_000);
    await utimes(file, past, past);

    expect(await cleanupPartialOutput(file, Date.now())).toEqual([]);
    expect(await readdir(dir)).toEqual(['movie.mp4']);
  });

  it('ignores a missing output file', async () => {
    const dir = await tempDir();
    expect(await cleanupPartialOutput(join(dir, 'gone.png'), Date.now())).toEqual([]);
  });

  it('removes sequence frames but not unrelated or older files', async () => {
    const dir = await tempDir();
    const startedAt = Date.now() - 5_000;
    const frame = join(dir, 'render_0001.png');
    await writeFile(frame, 'frame');
    await writeFile(join(dir, 'render_notes.txt'), 'not a frame');
    const old = join(dir, 'render_0000.png');
    await writeFile(old, 'old');
    const past = new Date(Date.now() - 60_000);
    await utimes(old, past, past);
    await writeFile(join(dir, 'other_0001.png'), 'unrelated');

    const removed = await cleanupPartialOutput(join(dir, 'render_[####].png'), startedAt);
    expect(removed).toEqual([frame]);
    expect((await readdir(dir)).sort()).toEqual([
      'other_0001.png',
      'render_0000.png',
      'render_notes.txt',
    ]);
  });

  it('does not remove directories', async () => {
    const dir = await tempDir();
    expect(await cleanupPartialOutput(dir, Date.now())).toEqual([]);
  });
});
