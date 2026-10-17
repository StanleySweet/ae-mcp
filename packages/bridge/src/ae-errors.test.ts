import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, runInMockAE } from './mock-ae.js';

interface Outcome {
  ok: boolean;
  value?: Record<string, unknown>;
  issue?: { code: string; message: string; details?: { aeErrors?: string[] } };
}

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-ae-errors-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  // A test handler stands in for an AE API that reports an error (a modal, unsuppressed).
  ctx.__raise = (message: string) => ae.simulateError(message);
  vm.runInContext(
    "AEMCP.register('test.ae_error', function (args) { __raise('Ce projet doit être enregistré'); if (args && args.fail) { throw new Error('export returned false'); } return { done: true }; });",
    ctx,
  );
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): Outcome {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

// AE errors raised inside a job become text in the result instead of a modal that
// blocks the bridge (app.beginSuppressDialogs + app.onError).
describe('After Effects errors during a job', () => {
  it('suppresses the error dialog and adds the text to a failed job', async () => {
    const { ctx, ae } = await payloadContext();

    const outcome = invoke(ctx, 'test.ae_error', { fail: true });

    expect(ae.errorDialogs).toEqual([]);
    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.message).toContain('After Effects: Ce projet doit être enregistré');
    expect(outcome.issue?.details?.aeErrors).toEqual(['Ce projet doit être enregistré [problem]']);
  });

  it('reports the text on a job that still succeeded', async () => {
    const { ctx, ae } = await payloadContext();

    const outcome = invoke(ctx, 'test.ae_error', {});

    expect(ae.errorDialogs).toEqual([]);
    expect(outcome.value).toMatchObject({ done: true, aeErrors: ['Ce projet doit être enregistré [problem]'] });
  });

  it('restores the previous onError and stops suppressing after the job', async () => {
    const { ctx, ae } = await payloadContext();

    invoke(ctx, 'test.ae_error', {});
    ae.simulateError('later, outside any job');

    expect(ae.app.onError).toBeNull();
    expect(ae.errorDialogs).toEqual(['later, outside any job']);
  });
});
