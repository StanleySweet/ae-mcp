import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<vm.Context> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-eval-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  return runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: unknown; issue?: { code: string; message: string } } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

describe('eval.run', () => {
  it('returns the value of the last expression', async () => {
    const ctx = await payloadContext();
    const out = invoke(ctx, 'eval.run', { code: '1+1' });
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ result: 2 });
  });

  it('returns a string for an object that cannot be serialised', async () => {
    const ctx = await payloadContext();
    const out = invoke(ctx, 'eval.run', { code: 'var o = {}; o.self = o; o' });
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ result: '[object Object]' });
  });

  it('returns an array as a value', async () => {
    const ctx = await payloadContext();
    const out = invoke(ctx, 'eval.run', { code: '[1, "a"]' });
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ result: [1, 'a'] });
  });

  it('turns an exception into SCRIPT_ERROR with its message', async () => {
    const ctx = await payloadContext();
    const out = invoke(ctx, 'eval.run', { code: 'throw new Error("boom")' });
    expect(out.ok).toBe(false);
    expect(out.issue?.code).toBe('SCRIPT_ERROR');
    expect(out.issue?.message).toContain('boom');
  });

  it('refuses empty code with INVALID_ARGS', async () => {
    const ctx = await payloadContext();
    expect(invoke(ctx, 'eval.run', { code: '' }).issue?.code).toBe('INVALID_ARGS');
    expect(invoke(ctx, 'eval.run', {}).issue?.code).toBe('INVALID_ARGS');
  });
});
