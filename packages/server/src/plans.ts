export type PlanFailure = 'unknown' | 'expired' | 'changed';

export interface Plan<T = unknown> {
  planId: string;
  fingerprint: string;
  changes: T[];
  createdAt: number;
}

export type PlanResult<T> = { ok: true; plan: Plan<T> } | { ok: false; reason: PlanFailure };

export interface PlanStoreOptions {
  /** How long a plan stays valid, in ms (default 10 minutes). */
  ttlMs?: number;
  /** How many live plans to keep before the oldest are evicted. */
  maxPlans?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/**
 * In-memory store of previewed edit plans. A bulk tool previews edits (dry run),
 * registers them here against the project's fingerprint, and later applies them
 * by planId. A plan is only valid while it is unexpired and the project has not
 * changed since it was made.
 */
export class PlanStore<T = unknown> {
  private readonly plans = new Map<string, Plan<T>>();
  private readonly ttlMs: number;
  private readonly maxPlans: number;
  private readonly now: () => number;
  private sequence = 0;

  constructor(options: PlanStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.maxPlans = options.maxPlans ?? 20;
    this.now = options.now ?? Date.now;
  }

  /** Registers a previewed plan and returns its id. */
  create(changes: T[], fingerprint: string): string {
    this.sequence += 1;
    const planId = `plan-${this.sequence}`;
    this.plans.set(planId, {
      planId,
      fingerprint,
      changes: [...changes],
      createdAt: this.now(),
    });
    this.prune();
    return planId;
  }

  /** Number of live (unexpired) plans; expired entries are pruned first. */
  size(): number {
    this.prune();
    return this.plans.size;
  }

  /** Looks up a plan without consuming it, checking expiry and the fingerprint. */
  get(planId: string, fingerprint: string): PlanResult<T> {
    const plan = this.plans.get(planId);
    if (plan === undefined) {
      return { ok: false, reason: 'unknown' };
    }
    if (this.isExpired(plan)) {
      this.plans.delete(planId);
      return { ok: false, reason: 'expired' };
    }
    if (plan.fingerprint !== fingerprint) {
      return { ok: false, reason: 'changed' };
    }
    return { ok: true, plan: clone(plan) };
  }

  /** Like `get`, but consumes the plan on success so it can be applied once. */
  take(planId: string, fingerprint: string): PlanResult<T> {
    const result = this.get(planId, fingerprint);
    if (result.ok) {
      this.plans.delete(planId);
    }
    return result;
  }

  private isExpired(plan: Plan<T>): boolean {
    return this.now() - plan.createdAt >= this.ttlMs;
  }

  private prune(): void {
    for (const [id, plan] of this.plans) {
      if (this.isExpired(plan)) {
        this.plans.delete(id);
      }
    }
    for (const id of this.plans.keys()) {
      if (this.plans.size <= this.maxPlans) {
        break;
      }
      this.plans.delete(id);
    }
  }
}

function clone<T>(plan: Plan<T>): Plan<T> {
  return { ...plan, changes: [...plan.changes] };
}
