import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One operation Claude ran through `ae_do` (or an `ae_apply`), kept in `<root>/history.jsonl`. */
export interface HistoryEntry {
  seq: number;
  time: string;
  op: string;
  args: Record<string, unknown>;
  /** The undo group the bridge opened for this call: `Claude: <op>`. */
  undoGroup: string;
  /** False for read-only operations, which leave nothing on AE's undo stack. */
  mutating: boolean;
  ok: boolean;
  error?: string;
}

export type HistoryInput = Pick<HistoryEntry, 'op' | 'args' | 'mutating' | 'ok'> & { error?: string };

export const HISTORY_FILE = 'history.jsonl';
export const DEFAULT_HISTORY_LIST = 20;
export const MAX_HISTORY_LIST = 200;

export function undoGroupName(op: string): string {
  return `Claude: ${op}`;
}

/**
 * Claude's own steps, newest last in the file and returned newest first.
 * The log is advisory: nothing here undoes anything (ADR-0009).
 */
export class HistoryLog {
  private entries: HistoryEntry[] | undefined;
  private loading: Promise<HistoryEntry[]> | undefined;

  constructor(private readonly root: string) {}

  private file(): string {
    return join(this.root, HISTORY_FILE);
  }

  private load(): Promise<HistoryEntry[]> {
    this.loading ??= readFile(this.file(), 'utf8').then(
      (text) => {
        const parsed: HistoryEntry[] = [];
        for (const line of text.split('\n')) {
          if (line.trim() === '') continue;
          try {
            parsed.push(JSON.parse(line) as HistoryEntry);
          } catch {
            // A torn line from an interrupted write is skipped, not fatal.
          }
        }
        return parsed;
      },
      () => [] as HistoryEntry[],
    );
    return this.loading.then((parsed) => {
      this.entries ??= parsed;
      return this.entries;
    });
  }

  /** Every entry, oldest first. */
  async all(): Promise<HistoryEntry[]> {
    return [...(await this.load())];
  }

  /** Records one call. A write failure is swallowed: history must never fail the operation. */
  async append(input: HistoryInput): Promise<HistoryEntry> {
    const entries = await this.load();
    const entry: HistoryEntry = {
      seq: (entries.at(-1)?.seq ?? 0) + 1,
      time: new Date().toISOString(),
      op: input.op,
      args: input.args,
      undoGroup: undoGroupName(input.op),
      mutating: input.mutating,
      ok: input.ok,
      ...(input.error !== undefined ? { error: input.error } : {}),
    };
    entries.push(entry);
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await appendFile(this.file(), `${JSON.stringify(entry)}\n`);
    } catch {
      // Kept in memory for this session only.
    }
    return entry;
  }

  /** The last `n` entries, newest first. */
  async list(n: number = DEFAULT_HISTORY_LIST): Promise<HistoryEntry[]> {
    return (await this.all()).slice(-n).reverse();
  }

  /**
   * The undo groups that Cmd+Z would have to step back through to revert Claude's last `n`
   * mutating steps, newest first. Returns null when the log holds fewer than `n` of them.
   */
  async undoGroups(n: number): Promise<string[] | null> {
    const mutating = (await this.all()).filter((entry) => entry.mutating).reverse();
    if (mutating.length < n) {
      return null;
    }
    return mutating.slice(0, n).map((entry) => entry.undoGroup);
  }
}
