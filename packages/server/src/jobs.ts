export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

/** Frame-based render progress, mirroring aerender's `PROGRESS:` line. */
export interface JobProgress {
  frame: number;
  rendered: number;
  seconds: number;
}

export interface JobRecord {
  id: string;
  kind: string;
  status: JobStatus;
  /** Epoch ms. */
  createdAt: number;
  finishedAt?: number;
  progress?: JobProgress;
  error?: string;
  result?: unknown;
}

export interface JobStoreOptions {
  /** How many finished jobs to keep before the oldest are evicted. */
  maxFinished?: number;
}

/**
 * In-memory registry of long-running jobs (renders today). Records are handed
 * out as copies so callers can't mutate the store's state.
 */
export class JobStore {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly maxFinished: number;
  private sequence = 0;

  constructor(options: JobStoreOptions = {}) {
    this.maxFinished = options.maxFinished ?? 50;
  }

  /** Registers a new running job and returns its id. */
  start(kind: string): string {
    this.sequence += 1;
    const id = `job-${this.sequence}`;
    this.jobs.set(id, { id, kind, status: 'running', createdAt: Date.now() });
    return id;
  }

  get(id: string): JobRecord | undefined {
    const record = this.jobs.get(id);
    return record === undefined ? undefined : { ...record };
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].map((record) => ({ ...record }));
  }

  /** Records progress for a running job; a no-op once the job is finished. */
  progress(id: string, progress: JobProgress): void {
    const record = this.jobs.get(id);
    if (record !== undefined && record.status === 'running') {
      record.progress = { ...progress };
    }
  }

  succeed(id: string, result?: unknown): void {
    this.finish(id, 'succeeded', result === undefined ? {} : { result });
  }

  fail(id: string, error: string): void {
    this.finish(id, 'failed', { error });
  }

  cancel(id: string): void {
    this.finish(id, 'cancelled', {});
  }

  private finish(
    id: string,
    status: Exclude<JobStatus, 'running'>,
    extra: { result?: unknown; error?: string },
  ): void {
    const record = this.jobs.get(id);
    if (record === undefined || record.status !== 'running') {
      return;
    }
    record.status = status;
    record.finishedAt = Date.now();
    if (extra.result !== undefined) {
      record.result = extra.result;
    }
    if (extra.error !== undefined) {
      record.error = extra.error;
    }
    this.evict();
  }

  private evict(): void {
    const finished = [...this.jobs.values()]
      .filter((record) => record.status !== 'running')
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    const excess = finished.length - this.maxFinished;
    for (let index = 0; index < excess; index += 1) {
      this.jobs.delete(finished[index]!.id);
    }
  }
}
