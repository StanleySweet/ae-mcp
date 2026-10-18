import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeError, writeAtomic, type ResultMessage } from '@ae-mcp/protocol';

// batch.run ids (#279). The server writes one line per finished batch to <root>/batches.jsonl
// after the bridge answers; the bridge never records anything. Nothing here undoes (ADR-0009).
export const BATCH_LOG_FILE = 'batches.jsonl';
export const MAX_BATCH_RECORDS = 200;
export const BATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// A result larger than this is not kept in the log; status still answers applied.
const MAX_STORED_RESULT_CHARS = 16_000;
// Errors that say nothing about whether the batch ran (the bridge may still finish it).
const UNRECORDED_CODES: string[] = ['TIMEOUT', 'AE_BUSY', 'AE_NOT_RUNNING', 'BRIDGE_NOT_LOADED'];

export interface BatchRecord {
  batchId: string;
  outcome: 'applied' | 'failed';
  at: string;
  /** Index of the sub-operation that failed (failed only). */
  step?: number;
  message?: string;
  result?: unknown;
  resultOmitted?: boolean;
}

export function isValidBatchId(value: unknown): value is string {
  return typeof value === 'string' && BATCH_ID_PATTERN.test(value);
}

/** Bounded, append-style log of finished batches. Writes run one at a time. */
export class BatchLog {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: string) {}

  private file(): string {
    return join(this.root, BATCH_LOG_FILE);
  }

  private async readRecords(): Promise<BatchRecord[]> {
    let text: string;
    try {
      text = await readFile(this.file(), 'utf8');
    } catch {
      return [];
    }
    const records: BatchRecord[] = [];
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        records.push(JSON.parse(line) as BatchRecord);
      } catch {
        // A corrupt line is dropped; it cannot name a batch.
      }
    }
    return records;
  }

  /** The newest record for batchId, or undefined when none. */
  async find(batchId: string): Promise<BatchRecord | undefined> {
    const records = await this.readRecords();
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i]!.batchId === batchId) return records[i];
    }
    return undefined;
  }

  /** Appends one record and keeps only the last MAX_BATCH_RECORDS. */
  record(entry: BatchRecord): Promise<void> {
    const next = this.queue.then(async () => {
      const kept = [...(await this.readRecords()), entry].slice(-MAX_BATCH_RECORDS);
      await mkdir(this.root, { recursive: true });
      await writeAtomic(this.file(), kept.map((item) => JSON.stringify(item)).join('\n') + '\n');
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** The record for a finished batch.run, or null when the bridge answer says nothing about the run. */
export function recordFromResult(batchId: string, result: ResultMessage, now: Date): BatchRecord | null {
  const at = now.toISOString();
  if (result.ok) {
    const kept = JSON.stringify(result.result ?? null).length <= MAX_STORED_RESULT_CHARS;
    return kept
      ? { batchId, outcome: 'applied', at, result: result.result }
      : { batchId, outcome: 'applied', at, resultOmitted: true };
  }
  if (UNRECORDED_CODES.includes(result.error.code)) {
    return null;
  }
  const step = result.error.details?.step;
  return {
    batchId,
    outcome: 'failed',
    at,
    ...(typeof step === 'number' ? { step } : {}),
    message: result.error.message,
  };
}

export type BatchClaim =
  | { ok: true; batchId: string; previous?: BatchRecord }
  | { ok: false; error: ReturnType<typeof makeError> };

/**
 * Picks the id for a batch.run before it runs. An absent id is generated. An id that
 * already applied is refused with its earlier result. A failed id may run again; the
 * response names the earlier failure, since its steps before the failure may still hold.
 */
export async function claimBatch(log: BatchLog, requested: unknown): Promise<BatchClaim> {
  if (requested === undefined) {
    return { ok: true, batchId: randomUUID() };
  }
  if (!isValidBatchId(requested)) {
    return {
      ok: false,
      error: makeError('INVALID_ARGS', 'batchId must be 1-64 characters: letters, digits, _ or -'),
    };
  }
  const previous = await log.find(requested);
  if (previous?.outcome === 'applied') {
    return {
      ok: false,
      error: makeError(
        'BATCH_ALREADY_APPLIED',
        `batch '${requested}' already applied, so it was not run again`,
        { batchId: requested, earlier: previous },
      ),
    };
  }
  return { ok: true, batchId: requested, ...(previous ? { previous } : {}) };
}

export type BatchStatusAnswer =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: ReturnType<typeof makeError> };

/** Answers batch.status {batchId}: applied, failed (with step and message) or unknown. */
export async function batchStatus(log: BatchLog, batchId: unknown): Promise<BatchStatusAnswer> {
  if (!isValidBatchId(batchId)) {
    return {
      ok: false,
      error: makeError('INVALID_ARGS', 'batchId must be 1-64 characters: letters, digits, _ or -'),
    };
  }
  const record = await log.find(batchId);
  if (record === undefined) {
    return { ok: true, body: { batchId, status: 'unknown' } };
  }
  const body: Record<string, unknown> = { batchId, status: record.outcome, at: record.at };
  if (record.step !== undefined) body.step = record.step;
  if (record.message !== undefined) body.message = record.message;
  if (record.result !== undefined) body.result = record.result;
  if (record.resultOmitted) body.resultOmitted = true;
  return { ok: true, body };
}
