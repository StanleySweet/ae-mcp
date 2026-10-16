import { randomUUID } from 'node:crypto';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PROTOCOL_VERSION,
  inboxDir,
  outboxDir,
  makeError,
  type JobMessage,
  type ResultMessage,
} from '@ae-mcp/protocol';
import { detectStall } from './stall.js';
import type { Transport } from './transport.js';

export interface AE_BUSYRetryOptions {
  /** Total attempts including the first (default 4). */
  attempts?: number;
  /** First backoff delay in ms (default 200); doubles each retry. */
  baseDelayMs?: number;
  /** Backoff ceiling in ms (default 2000). */
  maxDelayMs?: number;
  /** Injectable sleep seam (tests). */
  sleep?: (ms: number) => Promise<void>;
}

export interface AEClientOptions {
  transport: Transport;
  root: string;
  timeoutMs?: number;
  staleMs?: number;
  heartbeatMaxAgeMs?: number;
  now?: () => number;
  newId?: () => string;
  /** Retry `AE_BUSY` (another script running) with exponential backoff; false disables it. */
  retry?: AE_BUSYRetryOptions | false;
}

export interface AEClient {
  call(tool: string, args?: unknown): Promise<ResultMessage>;
  purgeStale(): Promise<number>;
}

async function purgeDir(dir: string, cutoff: number): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  let purged = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (info.mtimeMs < cutoff) {
        await unlink(path);
        purged += 1;
      }
    } catch {
      // already gone
    }
  }
  return purged;
}

export function createAEClient(options: AEClientOptions): AEClient {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const staleMs = options.staleMs ?? 300_000;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const retry =
    options.retry === false
      ? null
      : {
          attempts: options.retry?.attempts ?? 4,
          baseDelayMs: options.retry?.baseDelayMs ?? 200,
          maxDelayMs: options.retry?.maxDelayMs ?? 2000,
          sleep:
            options.retry?.sleep ??
            ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
        };

  const purgeStale = async (): Promise<number> => {
    const cutoff = now() - staleMs;
    return (
      (await purgeDir(inboxDir(options.root), cutoff)) +
      (await purgeDir(outboxDir(options.root), cutoff))
    );
  };

  const attempt = async (job: JobMessage): Promise<ResultMessage> => {
    try {
      const result = await options.transport.call(job);
      if (result.ok || (result.error.code !== 'TIMEOUT' && result.error.code !== 'BRIDGE_NOT_LOADED')) {
        return result;
      }
      const stall = await detectStall(options.root, {
        now,
        maxAgeMs: options.heartbeatMaxAgeMs,
      });
      if (!stall.stalled) {
        return result;
      }
      return {
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: {
          code: 'TIMEOUT',
          message:
            'After Effects is blocked by a modal dialog: the bridge went busy and stopped reporting.',
          hint: 'Close the dialog open in After Effects, then retry; the job did not run.',
        },
      };
    } catch (error) {
      return {
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: makeError(
          'BRIDGE_NOT_LOADED',
          `transport ${options.transport.name} failed: ${String(error)}`,
        ),
      };
    }
  };

  return {
    purgeStale,
    async call(tool: string, args: unknown = null): Promise<ResultMessage> {
      await purgeStale().catch(() => undefined);
      const id = newId();
      // A fresh deadline per attempt: a busy osascript call only returns after
      // its 120 s timeout, so a reused deadline would already be past (#183).
      const job = (): JobMessage => ({
        protocolVersion: PROTOCOL_VERSION,
        id,
        tool,
        args,
        deadline: now() + timeoutMs,
      });
      let result = await attempt(job());
      if (retry !== null) {
        for (let i = 1; i < retry.attempts && !result.ok && result.error.code === 'AE_BUSY'; i++) {
          const delay = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (i - 1));
          await retry.sleep(delay);
          result = await attempt(job());
        }
      }
      return result;
    },
  };
}