import { stat } from 'node:fs/promises';

/** Seams and thresholds for the render watchdog and the finished-output check. */
export interface RenderWatchOptions {
  /** Kill aerender when neither progress nor output growth changed for this long (default 120 s). */
  stallMs: number;
  /** How often the watchdog looks at the output file (default 1 s). */
  pollMs: number;
  /** Gap between the two size checks of a finished literal output (default 1 s). */
  settleMs: number;
  /** Clock in milliseconds (default Date.now). */
  now: () => number;
  /** Size of a file in bytes, or null when it does not exist (default fs.stat). */
  sizeOf: (path: string) => Promise<number | null>;
  /** Waits for the given milliseconds (default setTimeout). */
  wait: (ms: number) => Promise<void>;
}

export const DEFAULT_RENDER_WATCH: RenderWatchOptions = {
  stallMs: 120_000,
  pollMs: 1_000,
  settleMs: 1_000,
  now: () => Date.now(),
  sizeOf: (path) =>
    stat(path).then(
      (info) => (info.isFile() ? info.size : null),
      () => null,
    ),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface RenderWatchdog {
  /** Records a PROGRESS line; a line different from the previous one counts as progress. */
  noteProgress(key: string): void;
  /** Looks at the output size now; calls onStall once when the render has been quiet for stallMs. */
  check(): Promise<void>;
  /** Starts polling with check() every pollMs. */
  start(): void;
  /** Stops polling. Safe to call more than once. */
  stop(): void;
}

/** The fail reason for a stalled render, as the job reports it. */
export function stallMessage(seconds: number, bytes: number): string {
  return `render stalled: no progress and no output growth for ${seconds} s at ${bytes} bytes`;
}

/**
 * Watches a render: it is stalled when neither aerender's PROGRESS output nor the
 * literal output file's size changed for `stallMs`. `output` is undefined (or a
 * name with a [name] / # pattern) when there is no single file to watch; then only
 * progress counts.
 */
export function createRenderWatchdog(
  options: {
    output?: string;
    watch: RenderWatchOptions;
    onStall: (reason: string) => void;
  },
): RenderWatchdog {
  const { watch } = options;
  const watchFile = options.output !== undefined && !/[[#]/.test(options.output);
  let lastChangeAt = watch.now();
  let lastProgress: string | null = null;
  let lastSize: number | null = null;
  let sizeKnown = false;
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;
  let busy = false;
  let stalled = false;

  const check = async (): Promise<void> => {
    if (stalled || busy) {
      return;
    }
    busy = true;
    try {
      if (watchFile) {
        const size = await watch.sizeOf(options.output!);
        if (!sizeKnown || size !== lastSize) {
          sizeKnown = true;
          lastSize = size;
          lastChangeAt = watch.now();
        }
      }
      const quietMs = watch.now() - lastChangeAt;
      if (quietMs >= watch.stallMs && !stalled) {
        stalled = true;
        options.onStall(stallMessage(Math.round(quietMs / 1000), lastSize ?? 0));
      }
    } finally {
      busy = false;
    }
  };

  return {
    noteProgress(key: string): void {
      if (key !== lastProgress) {
        lastProgress = key;
        lastChangeAt = watch.now();
      }
    },
    check,
    start(): void {
      if (timer === null) {
        // globalThis so fake timers in tests drive the poll.
        timer = globalThis.setInterval(() => void check(), watch.pollMs);
      }
    },
    stop(): void {
      if (timer !== null) {
        globalThis.clearInterval(timer);
        timer = null;
      }
    },
  };
}

/**
 * Decides whether a render that exited 0 really produced its literal output: the
 * file must exist, be non-empty, and keep the same size across two checks
 * `settleMs` apart. Returns the fail reason, or null when the output is good.
 */
export async function checkFinishedOutput(
  output: string,
  watch: RenderWatchOptions,
): Promise<string | null> {
  const first = await watch.sizeOf(output);
  if (first === null) {
    return `aerender exited with code 0 but wrote no file at ${output}`;
  }
  if (first === 0) {
    return `aerender exited with code 0 but wrote an empty file at ${output}`;
  }
  await watch.wait(watch.settleMs);
  const second = await watch.sizeOf(output);
  if (second !== first) {
    return `aerender exited with code 0 but ${output} was still changing (${first} then ${second} bytes); the file is incomplete`;
  }
  return null;
}
