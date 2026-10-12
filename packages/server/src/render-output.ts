import { readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/** aerender's frame-number token, e.g. `[####]` in `render_[####].png`. */
const SEQUENCE_TOKEN = /\[(#+)\]/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes the partial output a cancelled aerender render left behind.
 *
 * `output` is the path passed to aerender's `-output`. A name containing a
 * `[####]` frame token (image sequence) removes the matching frames written
 * since `startedAt`; otherwise the single file is removed. Only files whose
 * mtime is at or after `startedAt` are touched, so pre-existing output
 * survives, and directories are never removed.
 */
export async function cleanupPartialOutput(output: string, startedAt: number): Promise<string[]> {
  const name = basename(output);
  const token = SEQUENCE_TOKEN.exec(name);
  if (token === null) {
    const info = await stat(output).catch(() => null);
    if (info === null || !info.isFile() || info.mtimeMs < startedAt) {
      return [];
    }
    await rm(output, { force: true });
    return [output];
  }

  const prefix = name.slice(0, token.index);
  const suffix = name.slice(token.index + token[0].length);
  const frameName = new RegExp(`^${escapeRegExp(prefix)}\\d+${escapeRegExp(suffix)}$`);
  const dir = dirname(output);
  const names = await readdir(dir).catch(() => []);
  const removed: string[] = [];
  for (const entry of names) {
    if (!frameName.test(entry)) {
      continue;
    }
    const path = join(dir, entry);
    const info = await stat(path).catch(() => null);
    if (info === null || !info.isFile() || info.mtimeMs < startedAt) {
      continue;
    }
    await rm(path, { force: true });
    removed.push(path);
  }
  return removed;
}
