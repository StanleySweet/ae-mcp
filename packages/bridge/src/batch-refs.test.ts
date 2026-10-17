import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-batch-refs-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

interface BatchResult {
  results: Array<Record<string, unknown>>;
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: unknown; issue?: { code: string; message: string; rollback?: boolean } } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

async function setup(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const { ctx, ae } = await payloadContext();
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  return { ctx, ae };
}

describe('batch.run step references', () => {
  it('feeds an earlier step result field into a later step argument', async () => {
    const { ctx, ae } = await setup();

    const out = invoke(ctx, 'batch.run', {
      mutating: [true, true],
      ops: [
        { op: 'layer.add_null', args: { comp: 'Main', name: 'Ctrl' } },
        { op: 'layer.rename', args: { comp: 'Main', index: '$0.index', name: 'Renamed' } },
      ],
    });

    expect(out.ok).toBe(true);
    expect((out.value as BatchResult).results[1]).toEqual({ index: 1, name: 'Renamed' });
    expect((ae.project.item(1) as MockCompItem).layer(1)?.name).toBe('Renamed');
  });

  it('resolves a reference to a step that is not the previous one', async () => {
    const { ctx, ae } = await setup();

    const out = invoke(ctx, 'batch.run', {
      mutating: [true, true],
      ops: [
        { op: 'layer.add_null', args: { comp: 'Main', name: 'A' } },
        { op: 'layer.add_null', args: { comp: 'Main', name: 'B' } },
        { op: 'layer.rename', args: { comp: 'Main', index: '$1.index', name: 'Nested' } },
      ],
    });

    expect(out.ok).toBe(true);
    const named = (out.value as BatchResult).results[1].index as number;
    expect((ae.project.item(1) as MockCompItem).layer(named)?.name).toBe('Nested');
    expect((ae.project.item(1) as MockCompItem).layer(named === 1 ? 2 : 1)?.name).toBe('A');
  });

  it('refuses an unknown step reference before any step runs', async () => {
    const { ctx, ae } = await setup();

    const out = invoke(ctx, 'batch.run', {
      mutating: [true, true],
      ops: [
        { op: 'layer.add_null', args: { comp: 'Main', name: 'Ctrl' } },
        { op: 'layer.rename', args: { comp: 'Main', index: '$5.index', name: 'Renamed' } },
      ],
    });

    expect(out.issue?.code).toBe('INVALID_ARGS');
    expect(out.issue?.message).toContain('$5.index');
    expect(out.issue?.message).toContain('ops[1]');
    expect((ae.project.item(1) as MockCompItem).numLayers).toBe(0);
  });

  it('refuses a reference to the current or a later step before any step runs', async () => {
    const { ctx, ae } = await setup();

    const out = invoke(ctx, 'batch.run', {
      mutating: [true, true],
      ops: [
        { op: 'layer.add_null', args: { comp: 'Main', name: 'Ctrl', index: '$1.index' } },
        { op: 'layer.add_null', args: { comp: 'Main', name: 'Other' } },
      ],
    });

    expect(out.issue?.code).toBe('INVALID_ARGS');
    expect(out.issue?.message).toContain('$1.index');
    expect((ae.project.item(1) as MockCompItem).numLayers).toBe(0);
  });

  it('refuses a field that the earlier step result does not have, naming the reference', async () => {
    const { ctx } = await setup();

    const out = invoke(ctx, 'batch.run', {
      mutating: [true, true],
      ops: [
        { op: 'layer.add_null', args: { comp: 'Main', name: 'Ctrl' } },
        { op: 'layer.rename', args: { comp: 'Main', index: '$0.nope', name: 'Renamed' } },
      ],
    });

    expect(out.issue?.code).toBe('INVALID_ARGS');
    expect(out.issue?.message).toContain('$0.nope');
    expect(out.issue?.message).toContain('ops[1]');
  });

  it('rolls the batch back when a step after a referenced step fails', async () => {
    const { ctx } = await setup();

    const out = invoke(ctx, 'batch.run', {
      mutating: [true, true, false],
      ops: [
        { op: 'layer.add_null', args: { comp: 'Main', name: 'Ctrl' } },
        { op: 'layer.rename', args: { comp: 'Main', index: '$0.index', name: 'Renamed' } },
        { op: 'layer.rename', args: { comp: 'Main', index: '$0.index' } },
      ],
    });

    expect(out.issue?.code).toBe('INVALID_ARGS');
    expect(out.issue?.rollback).toBe(true);
    expect(out.issue?.message).toContain('batch stopped at ops[2]');
  });

  it('leaves a string that is not a reference untouched', async () => {
    const { ctx, ae } = await setup();

    const out = invoke(ctx, 'batch.run', {
      mutating: [true],
      ops: [{ op: 'layer.add_null', args: { comp: 'Main', name: '$price tag' } }],
    });

    expect(out.ok).toBe(true);
    expect((ae.project.item(1) as MockCompItem).layer(1)?.name).toBe('$price tag');
  });
});
