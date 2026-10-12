import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockAVLayer, MockCompItem, runInMockAE } from './mock-ae.js';

interface Outcome {
  ok: boolean;
  value?: Record<string, unknown>;
  issue?: { code: string; message: string };
}

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-e9-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): Outcome {
  vm.runInContext(`var __args = ${JSON.stringify(args)};`, ctx);
  const json = vm.runInContext(
    `JSON.stringify(AEMCP.invoke(${JSON.stringify(tool)}, __args, 9999999999999))`,
    ctx,
  ) as string;
  return JSON.parse(json) as Outcome;
}

function seedComp(ae: MockAE, names: string[]): MockCompItem {
  const comp = new MockCompItem(1, 'Main', 1920, 1080, 25, 10);
  ae.project.add(comp);
  ae.project.activeItem = comp;
  for (const name of names) {
    comp.addLayer(new MockAVLayer(name, 'Layer'));
  }
  return comp;
}

describe('bulk.rename', () => {
  it('previews changes by default and leaves the layers untouched', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Layer 1', 'Layer 2']);

    const outcome = invoke(ctx, 'bulk.rename', { comp: 'Main', match: 'Layer', replace: 'Element' });

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ dryRun: true, comp: 'Main' });
    expect(outcome.value?.changes).toEqual([
      { index: 1, from: 'Layer 1', to: 'Element 1' },
      { index: 2, from: 'Layer 2', to: 'Element 2' },
    ]);
    expect(typeof outcome.value?.fingerprint).toBe('string');
    expect(comp.layer(1)!.name).toBe('Layer 1');
    expect(comp.layer(2)!.name).toBe('Layer 2');
  });

  it('renames the layers when dryRun is false', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Layer 1', 'Layer 2']);

    const outcome = invoke(ctx, 'bulk.rename', {
      comp: 'Main',
      match: 'Layer',
      replace: 'Element',
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ dryRun: false, applied: 2 });
    expect(comp.layer(1)!.name).toBe('Element 1');
    expect(comp.layer(2)!.name).toBe('Element 2');
  });

  it('renames by regular expression with capture groups', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['foo_01', 'foo_02']);

    const outcome = invoke(ctx, 'bulk.rename', {
      comp: 'Main',
      match: 'foo_(\\d+)',
      replace: 'bar_$1',
      regex: true,
      dryRun: false,
    });

    expect(outcome.value?.changes).toEqual([
      { index: 1, from: 'foo_01', to: 'bar_01' },
      { index: 2, from: 'foo_02', to: 'bar_02' },
    ]);
    expect(comp.layer(1)!.name).toBe('bar_01');
    expect(comp.layer(2)!.name).toBe('bar_02');
  });

  it('adds a prefix and a suffix', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['A', 'B']);

    invoke(ctx, 'bulk.rename', { comp: 'Main', prefix: 'X_', suffix: '_1', dryRun: false });

    expect(comp.layer(1)!.name).toBe('X_A_1');
    expect(comp.layer(2)!.name).toBe('X_B_1');
  });

  it('applies numbering with padding and step over the targets', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Node', 'Node']);

    invoke(ctx, 'bulk.rename', {
      comp: 'Main',
      numbering: { start: 1, step: 2, padding: 2 },
      dryRun: false,
    });

    expect(comp.layer(1)!.name).toBe('Node01');
    expect(comp.layer(2)!.name).toBe('Node03');
  });

  it('numbered prefixes go in front of the name', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Shot']);

    invoke(ctx, 'bulk.rename', {
      comp: 'Main',
      numbering: { position: 'prefix', start: 5, padding: 3 },
      dryRun: false,
    });

    expect(comp.layer(1)!.name).toBe('005Shot');
  });

  it('limits the rename to the requested layers', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, ['Layer 1', 'Layer 2']);

    const outcome = invoke(ctx, 'bulk.rename', {
      comp: 'Main',
      layers: [2],
      match: 'Layer',
      replace: 'X',
      dryRun: false,
    });

    expect(outcome.value).toMatchObject({ applied: 1 });
    expect(outcome.value?.changes).toEqual([{ index: 2, from: 'Layer 2', to: 'X 2' }]);
    expect(comp.layer(1)!.name).toBe('Layer 1');
    expect(comp.layer(2)!.name).toBe('X 2');
  });

  it('changes the fingerprint when a target name changes', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['Layer 1']);

    const before = invoke(ctx, 'bulk.rename', { comp: 'Main', match: 'Layer', replace: 'E' }).value
      ?.fingerprint;
    invoke(ctx, 'bulk.rename', { comp: 'Main', match: 'Layer', replace: 'E', dryRun: false });
    const after = invoke(ctx, 'bulk.rename', { comp: 'Main', match: 'Layer', replace: 'E' }).value
      ?.fingerprint;

    expect(after).not.toBe(before);
  });

  it('requires a rename source', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['Layer 1']);

    const outcome = invoke(ctx, 'bulk.rename', { comp: 'Main' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('rejects an invalid regular expression', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, ['Layer 1']);

    const outcome = invoke(ctx, 'bulk.rename', { comp: 'Main', match: '(', regex: true });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });

  it('reports a composition that does not exist', async () => {
    const { ctx } = await payloadContext();

    const outcome = invoke(ctx, 'bulk.rename', { comp: 'Nope', prefix: 'x' });

    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
    expect(outcome.issue?.message).toContain('Nope');
  });
});
