import { describe, expect, it } from 'vitest';

import { summarize } from './stats.js';

describe('summarize', () => {
  it('reports count split into ok and failed', () => {
    const stats = summarize([10, 20, 50, 100], 2);
    expect(stats.count).toBe(6);
    expect(stats.ok).toBe(4);
    expect(stats.failed).toBe(2);
  });

  it('computes mean and percentiles over successes', () => {
    const stats = summarize([10, 20, 50, 100], 0);
    expect(stats.meanMs).toBe(45);
    expect(stats.p50Ms).toBe(20);
    expect(stats.p95Ms).toBe(100);
    expect(stats.maxMs).toBe(100);
  });

  it('handles all failures with empty values', () => {
    const stats = summarize([], 5);
    expect(stats).toEqual({ count: 5, ok: 0, failed: 5, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 });
  });
});