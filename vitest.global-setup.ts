import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests call mkdtemp(tmpdir()) and never clean up; tens of thousands of dirs a run
// filled the disk. Point TMPDIR at one folder per run (workers inherit it) and drop it after.
export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'ae-mcp-vitest-'));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  return () => {
    process.env.TMPDIR = previous;
    rmSync(dir, { recursive: true, force: true });
  };
}
