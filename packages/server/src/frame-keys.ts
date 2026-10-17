// Contact-sheet times for ae_render_frame atKeys (E15-5): every key time of a layer or comp,
// deduplicated and sorted, with the midpoint between consecutive keys, capped at a sheet size.
// Pure functions only; the bridge read is done by the caller.

/** Two times closer than this (seconds) are the same key. */
const SAME_TIME = 1e-4;

export interface KeyContactPlan {
  times: number[];
  /** Distinct key times found, before midpoints were added. */
  keys: number;
  /** True when the sheet had to be thinned to fit `max` frames. */
  truncated: boolean;
}

/** The error message when atKeys is combined with time or times, or null when it may run. */
export function atKeysConflict(args: { time?: number; times?: number[] }): string | null {
  if (args.time !== undefined || args.times !== undefined) {
    return 'atKeys picks the times itself; drop time and times';
  }
  return null;
}

/**
 * Plans the sheet from the raw result of `keyframe.times`. Returns an error message when the
 * target has no keyframes at all.
 */
export function planKeyContactSheet(raw: unknown, max: number): KeyContactPlan | { error: string } {
  const list = raw && typeof raw === 'object' ? (raw as { times?: unknown }).times : undefined;
  if (!Array.isArray(list) || !list.every((t) => typeof t === 'number' && Number.isFinite(t))) {
    return { error: 'keyframe.times did not return a list of key times' };
  }
  const sorted = (list as number[]).slice().sort((a, b) => a - b);
  const keys: number[] = [];
  for (const t of sorted) {
    if (keys.length === 0 || t - keys[keys.length - 1]! > SAME_TIME) {
      keys.push(t);
    }
  }
  if (keys.length === 0) {
    return { error: 'no keyframes on the layer or comp, so there are no key times to sheet' };
  }
  const all: number[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    all.push(keys[i]!);
    if (i + 1 < keys.length) {
      all.push((keys[i]! + keys[i + 1]!) / 2);
    }
  }
  if (all.length <= max) {
    return { times: all, keys: keys.length, truncated: false };
  }
  // Too many: keep evenly spaced picks across the whole span, first and last included.
  const picked: number[] = [];
  for (let i = 0; i < max; i += 1) {
    const value = all[Math.round((i * (all.length - 1)) / (max - 1))]!;
    if (picked.length === 0 || value !== picked[picked.length - 1]) {
      picked.push(value);
    }
  }
  return { times: picked, keys: keys.length, truncated: true };
}
