import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  PROTOCOL_VERSION,
  inboxDir,
  outboxDir,
  ensureQueue,
  writeAtomic,
  resultSchema,
  makeError,
  type JobMessage,
  type ResultMessage,
} from '@ae-mcp/protocol';
import type { Transport } from './transport.js';

export class FileQueueTransport implements Transport {
  readonly name = 'file-queue' as const;

  constructor(
    private readonly root: string,
    private readonly pollMs = 50,
    private readonly waitMs = 30_000,
  ) {}

  async call(job: JobMessage): Promise<ResultMessage> {
    await ensureQueue(this.root);
    const jobFile = join(inboxDir(this.root), `${job.id}.json`);
    await writeAtomic(jobFile, JSON.stringify(job));
    const resultFile = join(outboxDir(this.root), `${job.id}.json`);
    const deadline = Math.min(job.deadline, Date.now() + this.waitMs);
    while (Date.now() < deadline) {
      try {
        const result = resultSchema.parse(JSON.parse(await readFile(resultFile, 'utf8')));
        await unlink(jobFile).catch(() => undefined);
        await unlink(resultFile).catch(() => undefined);
        return result;
      } catch {
        // no result yet; keep polling until the deadline
      }
      await delay(this.pollMs);
    }
    await unlink(jobFile).catch(() => undefined);
    return {
      protocolVersion: PROTOCOL_VERSION,
      ok: false,
      error: makeError('TIMEOUT', `job ${job.id} exceeded its deadline with no result`),
    };
  }
}