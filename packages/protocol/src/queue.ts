import { mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function queueRoot(): string {
  return process.env.AE_MCP_ROOT ?? join(homedir(), '.ae-mcp');
}

export function bridgeDir(root: string): string {
  return join(root, 'bridge');
}

export function inboxDir(root: string): string {
  return join(bridgeDir(root), 'inbox');
}

export function outboxDir(root: string): string {
  return join(bridgeDir(root), 'outbox');
}

export async function ensureQueue(root: string): Promise<void> {
  await chmod(root, 0o700).catch(() => undefined);
  await mkdir(outboxDir(root), { recursive: true, mode: 0o700 });
  await mkdir(inboxDir(root), { recursive: true, mode: 0o700 });
}

let counter = 0;

export async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid.toString(36)}.${(counter++).toString(36)}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, file);
}