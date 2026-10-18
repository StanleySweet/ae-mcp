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
import { aeProcessId as defaultAeProcessId, isAeRunning as defaultIsAeRunning } from './ae-process.js';
import { describeDialog, listDialogs, type AeDialog } from './dialogs.js';
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
  /** Dialogs open in AE, asked after a timeout or stall; default reads System Events. */
  checkDialogs?: () => Promise<AeDialog[]>;
  /** Whether an After Effects process is running; default checks with `pgrep`. */
  isAeRunning?: () => Promise<boolean>;
  /** Process id of the running After Effects, or null; default reads `pgrep`. */
  aeProcessId?: () => Promise<string | null>;
  /**
   * Presses Escape in After Effects. When set, the client recovers from a blocking
   * modal by itself: while an earlier job is unfinished in AE it presses Escape and
   * waits for that job's result instead of sending a new script, which AE would answer
   * with a "script already running" dialog. Unset (tests), there is no recovery.
   */
  pressEscape?: () => Promise<unknown>;
  /** Sleep between recovery rounds (tests); default setTimeout. */
  recoverySleep?: (ms: number) => Promise<void>;
}

/** Escape presses before the client gives up on a blocked After Effects. */
const RECOVERY_ROUNDS = 4;
const RECOVERY_WAIT_MS = 1500;

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

  const checkDialogs =
    options.checkDialogs ??
    (async (): Promise<AeDialog[]> => {
      const found = await listDialogs();
      return found.ok ? found.value : [];
    });

  const isAeRunning = options.isAeRunning ?? (() => defaultIsAeRunning());
  // A failing process check is not evidence either way: treat it as running.
  const aeNotRunning = async (): Promise<boolean> =>
    (await isAeRunning().catch(() => true)) === false;
  const notRunningResult = (): ResultMessage => ({
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    error: makeError('AE_NOT_RUNNING', 'After Effects is not running.'),
  });

  const purgeStale = async (): Promise<number> => {
    const cutoff = now() - staleMs;
    return (
      (await purgeDir(inboxDir(options.root), cutoff)) +
      (await purgeDir(outboxDir(options.root), cutoff))
    );
  };

  // Jobs whose script may still be running in AE: a call in flight, or one that timed
  // out. Their result file appears in the outbox once AE is free again. Each job keeps
  // the AE process id it was sent to: a crashed or relaunched AE never reports it (#283).
  const unfinished = new Map<string, string | null>();
  const aeProcessId = options.aeProcessId ?? (() => defaultAeProcessId());
  const currentPid = (): Promise<string | null> => aeProcessId().catch(() => null);
  const recoverySleep =
    options.recoverySleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);
  const recover = async (pressEscape: () => Promise<unknown>): Promise<boolean> => {
    for (let round = 0; ; round++) {
      const pid = await currentPid();
      for (const [id, sentTo] of [...unfinished]) {
        if ((sentTo !== null && sentTo !== pid) || (await exists(join(outboxDir(options.root), `${id}.json`)))) {
          unfinished.delete(id);
        }
      }
      if (unfinished.size === 0) {
        return true;
      }
      if (round === RECOVERY_ROUNDS) {
        return false;
      }
      await pressEscape();
      await recoverySleep(RECOVERY_WAIT_MS);
    }
  };
  const stillBlocked = (): ResultMessage => ({
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    error: makeError(
      'DIALOG_OPEN',
      'After Effects is still running an earlier script, held by a dialog that Escape did not close. Answer it in After Effects (Cancel, never Save), then retry. No new script was sent.',
    ),
  });

  const attempt = async (job: JobMessage): Promise<ResultMessage> => {
    if (options.pressEscape !== undefined) {
      if (unfinished.size > 0 && !(await recover(options.pressEscape))) {
        return stillBlocked();
      }
      unfinished.set(job.id, await currentPid());
    }
    try {
      const result = await options.transport.call(job);
      // A timed-out script may still run in AE; anything else has finished.
      if (result.ok || (result.error.code !== 'AE_BUSY' && result.error.code !== 'TIMEOUT')) {
        unfinished.delete(job.id);
      }
      if (result.ok || (result.error.code !== 'TIMEOUT' && result.error.code !== 'BRIDGE_NOT_LOADED')) {
        return result;
      }
      if (await aeNotRunning()) {
        return notRunningResult();
      }
      const stall = await detectStall(options.root, {
        now,
        maxAgeMs: options.heartbeatMaxAgeMs,
      });
      if (result.error.code === 'TIMEOUT' || stall.stalled) {
        const [dialog] = await checkDialogs().catch((): AeDialog[] => []);
        if (dialog !== undefined) {
          return {
            protocolVersion: PROTOCOL_VERSION,
            ok: false,
            error: makeError(
              'DIALOG_OPEN',
              `After Effects is blocked by a dialog: ${describeDialog(dialog)}`,
            ),
          };
        }
      }
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
      unfinished.delete(job.id);
      if (await aeNotRunning()) {
        return notRunningResult();
      }
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