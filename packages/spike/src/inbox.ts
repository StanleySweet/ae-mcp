import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export function spikeRoot(): string {
  return process.env.AE_MCP_SPIKE_ROOT ?? join(homedir(), '.ae-mcp', 'spike');
}

export function inboxDir(): string {
  return join(spikeRoot(), 'inbox');
}

export function outboxDir(): string {
  return join(spikeRoot(), 'outbox');
}

export function ensureDirs(): void {
  for (const dir of [inboxDir(), outboxDir()]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

let counter = 0;

export function nextId(now = Date.now()): string {
  counter += 1;
  return `${now}-${counter}`;
}

export function send(command: string, id = nextId()): string {
  ensureDirs();
  writeAtomic(join(inboxDir(), `${id}.txt`), command);
  return id;
}

export function readResult(id: string): string | undefined {
  const file = join(outboxDir(), `${id}.txt`);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

export async function waitForResult(id: string, timeoutMs = 5000, pollMs = 25): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const result = readResult(id);
    if (result !== undefined) {
      return result;
    }
    await delay(pollMs);
  }
  throw new Error(`spike: timed out after ${timeoutMs}ms waiting for result ${id}`);
}
