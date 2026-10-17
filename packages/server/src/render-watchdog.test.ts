import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkFinishedOutput,
  createRenderWatchdog,
  DEFAULT_RENDER_WATCH,
  type RenderWatchOptions,
} from './render-watchdog.js';

/** A clock and file-size stub the watchdog reads through its injected seams. */
function fakeWatch(overrides: Partial<RenderWatchOptions> = {}): {
  watch: RenderWatchOptions;
  advance: (ms: number) => void;
  sizes: (number | null)[];
} {
  let clock = 0;
  const sizes: (number | null)[] = [];
  const watch: RenderWatchOptions = {
    ...DEFAULT_RENDER_WATCH,
    stallMs: 5_000,
    pollMs: 1_000,
    settleMs: 1_000,
    now: () => clock,
    sizeOf: async () => (sizes.length > 0 ? sizes.shift()! : null),
    wait: async () => undefined,
    ...overrides,
  };
  return { watch, advance: (ms) => (clock += ms), sizes };
}

describe('render watchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stalls when neither progress nor output size changes for stallMs', async () => {
    const { watch, advance } = fakeWatch();
    const onStall = vi.fn();
    const dog = createRenderWatchdog({ output: '/out/movie.mov', watch, onStall });

    await dog.check(); // size null, first sight: counts as the baseline
    advance(4_000);
    await dog.check();
    expect(onStall).not.toHaveBeenCalled();

    advance(1_000);
    await dog.check();
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(onStall).toHaveBeenCalledWith(
      'render stalled: no progress and no output growth for 5 s at 0 bytes',
    );
  });

  it('reports the output size at the stall', async () => {
    const { watch, advance, sizes } = fakeWatch();
    const onStall = vi.fn();
    const dog = createRenderWatchdog({ output: '/out/movie.mov', watch, onStall });
    sizes.push(1_048_576, 1_048_576, 1_048_576);

    await dog.check();
    advance(3_000);
    await dog.check();
    advance(2_000);
    await dog.check();
    expect(onStall).toHaveBeenCalledWith(
      'render stalled: no progress and no output growth for 5 s at 1048576 bytes',
    );
  });

  it('does not stall while the output keeps growing', async () => {
    const { watch, advance, sizes } = fakeWatch();
    const onStall = vi.fn();
    const dog = createRenderWatchdog({ output: '/out/movie.mov', watch, onStall });
    sizes.push(10, 20, 30, 40, 50, 60, 70);

    for (let step = 0; step < 7; step += 1) {
      await dog.check();
      advance(1_000);
    }
    expect(onStall).not.toHaveBeenCalled();
  });

  it('resets on a new PROGRESS line, but not on a repeated one', async () => {
    const { watch, advance } = fakeWatch();
    const onStall = vi.fn();
    const dog = createRenderWatchdog({ output: '/out/movie.mov', watch, onStall });

    await dog.check();
    advance(4_000);
    dog.noteProgress('1:1');
    advance(4_000);
    await dog.check();
    expect(onStall).not.toHaveBeenCalled();

    dog.noteProgress('1:1');
    advance(2_000);
    await dog.check();
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('counts only progress for a pattern output, and never reads the pattern path', async () => {
    const { watch, advance } = fakeWatch();
    const onStall = vi.fn();
    const sizeOf = vi.fn(async () => 0);
    const dog = createRenderWatchdog({
      output: '/out/[comp]_[####].png',
      watch: { ...watch, sizeOf },
      onStall,
    });

    dog.noteProgress('1:1');
    advance(4_000);
    await dog.check();
    expect(sizeOf).not.toHaveBeenCalled();
    advance(1_000);
    await dog.check();
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('calls onStall once and stops watching after stop()', async () => {
    const { watch, advance } = fakeWatch();
    const onStall = vi.fn();
    const dog = createRenderWatchdog({ watch, onStall });

    advance(6_000);
    await dog.check();
    await dog.check();
    expect(onStall).toHaveBeenCalledTimes(1);

    const quiet = createRenderWatchdog({ watch, onStall: vi.fn() });
    quiet.stop();
    quiet.stop();
  });

  it('polls on a timer and stops with stop()', async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const sizeOf = vi.fn(async () => 0);
    const dog = createRenderWatchdog({
      output: '/out/movie.mov',
      watch: { ...fakeWatch().watch, stallMs: 3_000, pollMs: 1_000, sizeOf, now: () => Date.now() },
      onStall,
    });

    dog.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onStall).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onStall).toHaveBeenCalledTimes(1);

    dog.stop();
    const calls = sizeOf.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sizeOf.mock.calls.length).toBe(calls);
  });
});

describe('checkFinishedOutput', () => {
  it('reports a missing file', async () => {
    const { watch } = fakeWatch();
    expect(await checkFinishedOutput('/out/a.mov', watch)).toBe(
      'aerender exited with code 0 but wrote no file at /out/a.mov',
    );
  });

  it('reports an empty file', async () => {
    const { watch } = fakeWatch({ sizeOf: async () => 0 });
    expect(await checkFinishedOutput('/out/a.mov', watch)).toBe(
      'aerender exited with code 0 but wrote an empty file at /out/a.mov',
    );
  });

  it('reports a file whose size changes between two checks', async () => {
    const sizes = [1_000, 2_000];
    const waits: number[] = [];
    const { watch } = fakeWatch({
      sizeOf: async () => sizes.shift()!,
      settleMs: 1_000,
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    expect(await checkFinishedOutput('/out/a.mov', watch)).toBe(
      'aerender exited with code 0 but /out/a.mov was still changing (1000 then 2000 bytes); the file is incomplete',
    );
    expect(waits).toEqual([1_000]);
  });

  it('accepts a non-empty file whose size is stable across two checks', async () => {
    const { watch } = fakeWatch({ sizeOf: async () => 4_096 });
    expect(await checkFinishedOutput('/out/a.mov', watch)).toBeNull();
  });
});
