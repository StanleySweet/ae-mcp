import { describe, it, expect } from 'vitest';
import { PlanStore } from './plans.js';

function clocked(options: { ttlMs?: number; maxPlans?: number } = {}): {
  store: PlanStore<string>;
  setNow: (value: number) => void;
} {
  let now = 1_000;
  const store = new PlanStore<string>({ now: () => now, ...options });
  return { store, setNow: (value) => (now = value) };
}

describe('PlanStore', () => {
  it('registers a plan and returns a unique id', () => {
    const { store } = clocked();
    const first = store.create(['a'], 'fp1');
    const second = store.create(['b'], 'fp1');
    expect(first).not.toBe(second);
    expect(store.size()).toBe(2);
  });

  it('returns the plan for a matching fingerprint', () => {
    const { store } = clocked();
    const planId = store.create(['rename layer 1'], 'fp1');
    const result = store.get(planId, 'fp1');
    expect(result).toEqual({
      ok: true,
      plan: { planId, fingerprint: 'fp1', steps: ['rename layer 1'], createdAt: 1_000 },
    });
  });

  it('reports unknown, changed and expired reasons', () => {
    const { store, setNow } = clocked({ ttlMs: 600_000 });
    const planId = store.create(['x'], 'fp1');

    expect(store.get('plan-nope', 'fp1')).toEqual({ ok: false, reason: 'unknown' });
    expect(store.get(planId, 'fp2')).toEqual({ ok: false, reason: 'changed' });

    setNow(1_000 + 600_000);
    expect(store.get(planId, 'fp1')).toEqual({ ok: false, reason: 'expired' });
    expect(store.get(planId, 'fp1')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('keeps a plan valid right up to the ttl boundary', () => {
    const { store, setNow } = clocked({ ttlMs: 600_000 });
    const planId = store.create(['x'], 'fp1');
    setNow(1_000 + 600_000 - 1);
    expect(store.get(planId, 'fp1').ok).toBe(true);
  });

  it('does not consume a plan on get, but does on take', () => {
    const { store } = clocked();
    const planId = store.create(['x'], 'fp1');
    expect(store.get(planId, 'fp1').ok).toBe(true);
    expect(store.get(planId, 'fp1').ok).toBe(true);
    expect(store.take(planId, 'fp1').ok).toBe(true);
    expect(store.take(planId, 'fp1')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('does not consume a plan when the fingerprint changed', () => {
    const { store } = clocked();
    const planId = store.create(['x'], 'fp1');
    expect(store.take(planId, 'fp2')).toEqual({ ok: false, reason: 'changed' });
    expect(store.get(planId, 'fp1').ok).toBe(true);
  });

  it('prunes expired plans when new ones are created', () => {
    const { store, setNow } = clocked({ ttlMs: 100 });
    store.create(['old'], 'fp1');
    setNow(1_000 + 100);
    store.create(['new'], 'fp1');
    expect(store.size()).toBe(1);
  });

  it('evicts the oldest plan beyond maxPlans', () => {
    const { store } = clocked({ maxPlans: 2 });
    const first = store.create(['1'], 'fp1');
    const second = store.create(['2'], 'fp1');
    const third = store.create(['3'], 'fp1');
    expect(store.get(first, 'fp1')).toEqual({ ok: false, reason: 'unknown' });
    expect(store.get(second, 'fp1').ok).toBe(true);
    expect(store.get(third, 'fp1').ok).toBe(true);
  });

  it('hands out copies so callers cannot mutate stored steps', () => {
    const { store } = clocked();
    const planId = store.create(['x'], 'fp1');
    const result = store.get(planId, 'fp1');
    if (!result.ok) throw new Error('expected a plan');
    result.plan.steps.push('injected');
    const again = store.get(planId, 'fp1');
    if (!again.ok) throw new Error('expected a plan');
    expect(again.plan.steps).toEqual(['x']);
  });

  it('copies the input steps on create', () => {
    const { store } = clocked();
    const steps = ['x'];
    const planId = store.create(steps, 'fp1');
    steps.push('injected');
    const result = store.get(planId, 'fp1');
    if (!result.ok) throw new Error('expected a plan');
    expect(result.plan.steps).toEqual(['x']);
  });

  it('peeks at a plan without the fingerprint, pruning expired ones', () => {
    const { store, setNow } = clocked({ ttlMs: 100 });
    const planId = store.create(['x'], 'fp1');
    expect(store.peek(planId)?.steps).toEqual(['x']);
    expect(store.peek('plan-nope')).toBeUndefined();

    setNow(1_000 + 100);
    expect(store.peek(planId)).toBeUndefined();
  });
});
