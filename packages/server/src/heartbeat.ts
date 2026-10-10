import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  heartbeatSchema,
  outboxDir,
  type HeartbeatMessage,
} from '@ae-mcp/protocol';

export type HeartbeatState =
  | { status: 'ok'; beat: HeartbeatMessage; ageMs: number }
  | { status: 'missing' }
  | { status: 'unreadable' }
  | { status: 'stale'; beat: HeartbeatMessage; ageMs: number };

/** Reads the bridge heartbeat, classifying missing, unreadable and stale files. */
export async function readHeartbeat(
  root: string,
  maxAgeMs: number,
  now: () => number = Date.now,
): Promise<HeartbeatState> {
  const file = join(outboxDir(root), 'heartbeat.json');
  let raw: string;
  let ageMs: number;
  try {
    const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
    raw = text;
    ageMs = now() - info.mtimeMs;
  } catch {
    return { status: 'missing' };
  }
  let beat: HeartbeatMessage;
  try {
    beat = heartbeatSchema.parse(JSON.parse(raw));
  } catch {
    return { status: 'unreadable' };
  }
  if (ageMs > maxAgeMs) {
    return { status: 'stale', beat, ageMs };
  }
  return { status: 'ok', beat, ageMs };
}