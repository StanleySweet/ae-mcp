import { describe, it, expect } from 'vitest';
import { atKeysConflict, planKeyContactSheet } from './frame-keys.js';

describe('planKeyContactSheet', () => {
  it('adds the midpoint between consecutive keys', () => {
    expect(planKeyContactSheet({ times: [0, 1, 3] }, 36)).toEqual({
      times: [0, 0.5, 1, 2, 3],
      keys: 3,
      truncated: false,
    });
  });

  it('sorts unsorted key times and drops duplicates', () => {
    const plan = planKeyContactSheet({ times: [2, 0, 2, 0.00001, 1] }, 36);
    expect(plan).toMatchObject({ keys: 3 });
    expect((plan as { times: number[] }).times).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('returns the single key when there is only one', () => {
    expect(planKeyContactSheet({ times: [4] }, 36)).toEqual({ times: [4], keys: 1, truncated: false });
  });

  it('reports an error when there are no keys', () => {
    expect(planKeyContactSheet({ times: [] }, 36)).toEqual({
      error: 'no keyframes on the layer or comp, so there are no key times to sheet',
    });
  });

  it('rejects a bridge result without a list of times', () => {
    expect(planKeyContactSheet({ comp: 'Main' }, 36)).toEqual({
      error: 'keyframe.times did not return a list of key times',
    });
    expect(planKeyContactSheet({ times: ['1'] }, 36)).toHaveProperty('error');
  });

  it('thins the sheet evenly to the cap and marks it truncated', () => {
    const dense = Array.from({ length: 40 }, (_, i) => i);
    const capped = planKeyContactSheet({ times: dense }, 36) as { times: number[]; truncated: boolean; keys: number };
    expect(capped.truncated).toBe(true);
    expect(capped.keys).toBe(40);
    expect(capped.times).toHaveLength(36);
    expect(capped.times[0]).toBe(0);
    expect(capped.times[35]).toBe(39);
    expect(capped.times).toEqual([...capped.times].sort((a, b) => a - b));
  });
});

describe('atKeysConflict', () => {
  it('allows atKeys alone', () => {
    expect(atKeysConflict({})).toBeNull();
  });

  it('refuses atKeys with time or times', () => {
    expect(atKeysConflict({ time: 1 })).toMatch(/drop time and times/);
    expect(atKeysConflict({ times: [1] })).toMatch(/drop time and times/);
  });
});
