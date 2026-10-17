import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { build } from '../../packages/bridge/src/build.js';
import { MockAE, runInMockAE } from '../../packages/bridge/src/mock-ae.js';
import type { HistoryEntry } from '../../packages/server/src/history.js';
import { defaultOperationRegistry } from '../../packages/server/src/operations.js';
import { batchJson, replayJsx, replaySteps } from '../../packages/server/src/replay.js';

// The session: what Claude would send through ae_do, one call at a time.
const session: Array<{ op: string; args: Record<string, unknown> }> = [
  { op: 'comp.create', args: { name: 'Main', width: 1920, height: 1080, duration: 10 } },
  { op: 'layer.add_solid', args: { comp: 'Main', color: [1, 0, 0] } },
  { op: 'layer.rename', args: { comp: 'Main', index: 1, name: 'Red' } },
  { op: 'layer.set_transform', args: { comp: 'Main', index: 1, position: [100, 200] } },
];

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: unknown; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

function fresh(payload: string): { ctx: vm.Context; ae: MockAE } {
  const ae = new MockAE();
  return { ctx: runInMockAE(payload, ae), ae };
}

describe('replay of a session', () => {
  it('batch.run and the standalone jsx reproduce the session project state', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ae-mcp-replay-eq-'));
    await build({ outDir });
    const payload = readFileSync(join(outDir, 'payload.jsx'), 'utf8');

    // 1. Original session, one ae_do-style call per step.
    const original = fresh(payload);
    for (const step of session) {
      expect(invoke(original.ctx, step.op, step.args).ok).toBe(true);
    }
    const expected = invoke(original.ctx, 'project.export_json', {});
    expect(expected.ok).toBe(true);

    // 2. The same history, recorded as ae_do would log it, exported as batch args.
    const entries: HistoryEntry[] = session.map((step, i) => ({
      seq: i + 1,
      time: new Date(0).toISOString(),
      op: step.op,
      args: step.args,
      undoGroup: `Claude: ${step.op}`,
      mutating: true,
      ok: true,
    }));
    const plan = replaySteps(entries, defaultOperationRegistry());
    expect(plan.ops).toHaveLength(session.length);
    const batchArgs = JSON.parse(batchJson(plan)) as { ops: unknown[] };

    // 3. Batch replay on a fresh project.
    const viaBatch = fresh(payload);
    const batchRun = invoke(viaBatch.ctx, 'batch.run', batchArgs);
    expect(batchRun.ok).toBe(true);
    expect(invoke(viaBatch.ctx, 'project.export_json', {}).value).toEqual(expected.value);

    // 4. Standalone jsx on a fresh project: the footer runs the batch with no server.
    const jsxAe = new MockAE();
    const jsxCtx = runInMockAE(replayJsx(plan, payload, null, new Date(0).toISOString()), jsxAe);
    expect(jsxAe.consoleLines.join('\n')).toContain('"ok":true');
    expect(invoke(jsxCtx, 'project.export_json', {}).value).toEqual(expected.value);
  });
});
