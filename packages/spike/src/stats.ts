export interface Stats {
  count: number;
  ok: number;
  failed: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

function percentile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) {
    return 0;
  }
  const idx = Math.min(n - 1, Math.ceil((q / 100) * n) - 1);
  return sorted[idx] ?? 0;
}

export function summarize(latenciesMs: number[], failures: number): Stats {
  const ok = latenciesMs.length;
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const sum = latenciesMs.reduce((acc, ms) => acc + ms, 0);
  return {
    count: ok + failures,
    ok,
    failed: failures,
    meanMs: ok === 0 ? 0 : sum / ok,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: percentile(sorted, 100),
  };
}