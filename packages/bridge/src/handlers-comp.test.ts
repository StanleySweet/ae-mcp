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
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-comp-ops-'));
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

function seedComp(ae: MockAE, layerCount = 0): MockCompItem {
  const comp = new MockCompItem(1, 'Main', 1920, 1080, 25, 10);
  ae.project.add(comp);
  ae.project.activeItem = comp;
  for (let i = 1; i <= layerCount; i += 1) {
    const layer = new MockAVLayer(`Layer ${i}`, 'Layer');
    layer.inPoint = 0;
    layer.outPoint = 10;
    comp.addLayer(layer);
  }
  return comp;
}

describe('comp.create', () => {
  it('creates a 1920x1080 30 fps 10 s comp by default', async () => {
    const { ctx, ae } = await payloadContext();
    const outcome = invoke(ctx, 'comp.create', { name: 'Intro' });
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({
      name: 'Intro',
      type: 'Composition',
      width: 1920,
      height: 1080,
      pixelAspect: 1,
      frameRate: 30,
      duration: 10,
      numLayers: 0,
    });
    expect(ae.project.numItems).toBe(1);
  });

  it('honours every setting', async () => {
    const { ctx } = await payloadContext();
    const outcome = invoke(ctx, 'comp.create', {
      name: 'Vertical',
      width: 1080,
      height: 1920,
      pixelAspect: 1,
      duration: 5,
      fps: 24,
    });
    expect(outcome.value).toMatchObject({
      name: 'Vertical',
      width: 1080,
      height: 1920,
      frameRate: 24,
      duration: 5,
    });
  });
});

describe('comp.info', () => {
  it('finds a comp by name, by id, and defaults to the active comp', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae);
    expect(invoke(ctx, 'comp.info', { comp: 'Main' }).value).toMatchObject({ name: 'Main' });
    expect(invoke(ctx, 'comp.info', { comp: 1 }).value).toMatchObject({ name: 'Main' });
    expect(invoke(ctx, 'comp.info', {}).value).toMatchObject({ name: 'Main' });
  });

  it('reports an unknown comp as INVALID_ARGS', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae);
    const outcome = invoke(ctx, 'comp.info', { comp: 'Nope' });
    expect(outcome.ok).toBe(false);
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
    expect(outcome.issue?.message).toContain('Nope');
  });

  it('reports a missing active comp as INVALID_ARGS', async () => {
    const { ctx } = await payloadContext();
    const outcome = invoke(ctx, 'comp.info', {});
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });
});

describe('comp.duplicate', () => {
  it('duplicates a comp, optionally renaming the copy, and leaves the original alone', async () => {
    const { ctx, ae } = await payloadContext();
    const original = seedComp(ae, 2);
    const outcome = invoke(ctx, 'comp.duplicate', { comp: 'Main', newName: 'Main B' });
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ name: 'Main B', numLayers: 2, width: 1920 });
    expect(ae.project.numItems).toBe(2);
    expect(original.name).toBe('Main');
    expect(original.numLayers).toBe(2);
  });

  it('rejects an unknown comp', async () => {
    const { ctx } = await payloadContext();
    expect(invoke(ctx, 'comp.duplicate', { comp: 'Nope' }).issue?.code).toBe('INVALID_ARGS');
  });
});

describe('comp.set_settings', () => {
  it('changes only the settings that are provided', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae);
    const outcome = invoke(ctx, 'comp.set_settings', {
      comp: 'Main',
      width: 1280,
      height: 720,
      fps: 24,
      bgColor: [1, 0.5, 0],
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ width: 1280, height: 720, frameRate: 24 });
    expect(comp.pixelAspect).toBe(1);
    expect(comp.duration).toBe(10);
    expect(comp.bgColor).toEqual([1, 0.5, 0]);
  });

  it('renames with newName', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae);
    invoke(ctx, 'comp.set_settings', { comp: 'Main', newName: 'Main v2' });
    expect(comp.name).toBe('Main v2');
  });

  it('rejects a call that changes nothing', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae);
    const outcome = invoke(ctx, 'comp.set_settings', { comp: 'Main' });
    expect(outcome.issue?.code).toBe('INVALID_ARGS');
  });
});

describe('comp.precompose', () => {
  it('moves the chosen layers into a new comp and leaves one precomp layer behind', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, 4);
    const outcome = invoke(ctx, 'comp.precompose', {
      comp: 'Main',
      layers: [2, 3],
      name: 'Inner',
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({
      comp: 'Main',
      numLayers: 3,
      precomp: { name: 'Inner', numLayers: 2 },
    });
    expect(comp.numLayers).toBe(3);
    expect(comp.layer(2)?.name).toBe('Inner');
  });

  it('defaults the precomp name', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, 1);
    const outcome = invoke(ctx, 'comp.precompose', { comp: 'Main', layers: [1] });
    expect(outcome.value).toMatchObject({ precomp: { name: 'Pre-comp' } });
  });

  it('rejects empty, out-of-range and non-integer layer lists', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, 2);
    for (const layers of [[], [3], [0], [1.5]]) {
      const outcome = invoke(ctx, 'comp.precompose', { comp: 'Main', layers });
      expect(outcome.issue?.code).toBe('INVALID_ARGS');
    }
  });

  it('only allows moveAllAttributes false for a single layer', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, 3);
    const many = invoke(ctx, 'comp.precompose', {
      comp: 'Main',
      layers: [1, 2],
      moveAllAttributes: false,
    });
    expect(many.issue?.code).toBe('INVALID_ARGS');
    const single = invoke(ctx, 'comp.precompose', {
      comp: 'Main',
      layers: [1],
      moveAllAttributes: false,
    });
    expect(single.ok).toBe(true);
  });
});

describe('comp.layer_clip_frames', () => {
  it('trims every layer to the frame range [from, to) using the comp frame rate', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, 2);
    const outcome = invoke(ctx, 'comp.layer_clip_frames', { comp: 'Main', from: 10, to: 50 });
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ comp: 'Main', inPoint: 0.4, outPoint: 2, layers: [1, 2] });
    for (const index of [1, 2]) {
      expect(comp.layer(index)?.inPoint).toBeCloseTo(0.4);
      expect(comp.layer(index)?.outPoint).toBeCloseTo(2);
    }
  });

  it('only touches the listed layers', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, 3);
    invoke(ctx, 'comp.layer_clip_frames', { comp: 'Main', layers: [2], from: 0, to: 25 });
    expect(comp.layer(2)?.outPoint).toBeCloseTo(1);
    expect(comp.layer(1)?.outPoint).toBe(10);
    expect(comp.layer(3)?.outPoint).toBe(10);
  });

  it('moves a range that starts after the current out point', async () => {
    const { ctx, ae } = await payloadContext();
    const comp = seedComp(ae, 1);
    comp.layer(1)!.outPoint = 1;
    const outcome = invoke(ctx, 'comp.layer_clip_frames', { comp: 'Main', from: 50, to: 100 });
    expect(outcome.ok).toBe(true);
    expect(comp.layer(1)?.inPoint).toBeCloseTo(2);
    expect(comp.layer(1)?.outPoint).toBeCloseTo(4);
  });

  it('rejects a missing or empty frame range and bad layer indices', async () => {
    const { ctx, ae } = await payloadContext();
    seedComp(ae, 1);
    for (const args of [
      { comp: 'Main' },
      { comp: 'Main', from: 10 },
      { comp: 'Main', from: 10, to: 10 },
      { comp: 'Main', from: -1, to: 10 },
      { comp: 'Main', from: 0, to: 10, layers: [2] },
    ]) {
      expect(invoke(ctx, 'comp.layer_clip_frames', args).issue?.code).toBe('INVALID_ARGS');
    }
  });
});
