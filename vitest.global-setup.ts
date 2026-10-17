import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests call mkdtemp(tmpdir()) and never clean up; tens of thousands of dirs a run
// filled the disk. Point TMPDIR at one folder per run (workers inherit it) and drop it after.
// HOME points there too: tests that build a server without a root wrote into the real
// ~/.ae-mcp (history.jsonl).
export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'ae-mcp-vitest-'));
  const previous = { TMPDIR: process.env.TMPDIR, HOME: process.env.HOME };
  process.env.TMPDIR = dir;
  process.env.HOME = dir;
  return () => {
    process.env.TMPDIR = previous.TMPDIR;
    process.env.HOME = previous.HOME;
    rmSync(dir, { recursive: true, force: true });
  };
}
