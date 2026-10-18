import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockFootageItem, MockProperty, MockPropertyGroup, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-timing-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are untyped JSON
function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: any; issue?: { code: string; message: string } } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

const OPACITY = 'ADBE Transform Group/ADBE Opacity';

async function withOpacityKeys(): Promise<{ ctx: vm.Context; ae: MockAE; opacity: MockProperty }> {
  const { ctx, ae } = await payloadContext();
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Ctl' });
  for (const [time, value] of [
    [0, 0],
    [1, 50],
    [2, 100],
  ]) {
    expect(invoke(ctx, 'keyframe.add', { comp: 'Main', layer: 'Ctl', time, value, property: OPACITY }).ok).toBe(true);
  }
  const layer = (ae.project.item(1) as MockCompItem).layer(1) as unknown as MockPropertyGroup;
  const opacity = (layer.property('ADBE Transform Group') as MockPropertyGroup).property('ADBE Opacity') as MockProperty;
  return { ctx, ae, opacity };
}

describe('keyframe.clear', () => {
  it('removes keys inside a time range and reports counts', async () => {
    const { ctx, opacity } = await withOpacityKeys();

    const out = invoke(ctx, 'keyframe.clear', { comp: 'Main', layer: 'Ctl', property: OPACITY, from: 0.5, to: 1.5 });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ removed: 1, remaining: 2 });
    expect(opacity.numKeys).toBe(2);
    expect(opacity.keyTime(1)).toBe(0);
    expect(opacity.keyTime(2)).toBe(2);
  });

  it('removes every key when no range is given and keeps the value at the comp time', async () => {
    const { ctx, opacity } = await withOpacityKeys();

    const out = invoke(ctx, 'keyframe.clear', { comp: 'Main', layer: 'Ctl', property: OPACITY });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ removed: 3, remaining: 0 });
    expect(opacity.numKeys).toBe(0);
    expect(opacity.value).toBe(0);
  });

  it('reports zero removed on a property with no keys', async () => {
    const { ctx } = await withOpacityKeys();

    const out = invoke(ctx, 'keyframe.clear', { comp: 'Main', layer: 'Ctl', property: 'ADBE Transform Group/ADBE Position' });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ removed: 0, remaining: 0 });
  });

  it('refuses a non-number range bound', async () => {
    const { ctx } = await withOpacityKeys();

    const out = invoke(ctx, 'keyframe.clear', { comp: 'Main', layer: 'Ctl', property: OPACITY, from: 'soon' });

    expect(out.ok).toBe(false);
    expect(out.issue?.message).toContain('from must be a finite number');
  });
});

describe('layer.set_timing', () => {
  it('sets startTime, inPoint and outPoint in seconds', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Clip' });

    const out = invoke(ctx, 'layer.set_timing', { comp: 'Main', layer: 'Clip', startTime: 2, inPoint: 0.5, outPoint: 3 });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ index: 1, startTime: 2, inPoint: 0.5, outPoint: 3 });
    const layer = (ae.project.item(1) as MockCompItem).layer(1) as unknown as { startTime: number; inPoint: number; outPoint: number };
    expect(layer.startTime).toBe(2);
    expect(layer.inPoint).toBe(0.5);
    expect(layer.outPoint).toBe(3);
  });

  it('checks the new outPoint against the current inPoint when only one is given', async () => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Clip' });
    invoke(ctx, 'layer.set_timing', { comp: 'Main', layer: 'Clip', inPoint: 1, outPoint: 3 });

    const out = invoke(ctx, 'layer.set_timing', { comp: 'Main', layer: 'Clip', outPoint: 0.5 });

    expect(out.ok).toBe(false);
    expect(out.issue?.message).toContain('outPoint must be after inPoint');
  });

  it('refuses a call with no timing field', async () => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Clip' });

    const out = invoke(ctx, 'layer.set_timing', { comp: 'Main', layer: 'Clip' });

    expect(out.ok).toBe(false);
    expect(out.issue?.message).toContain('pass at least one of startTime, inPoint, outPoint');
  });
});

describe('layer.replace_source', () => {
  it('swaps the source of an AV layer for a footage item found by name', async () => {
    const { ctx, ae } = await payloadContext();
    const footage = new MockFootageItem(500, 'Movie.mov', 1920, 1080);
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    ae.project.add(footage);
    invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Clip' });

    const out = invoke(ctx, 'layer.replace_source', { comp: 'Main', layer: 'Clip', item: 'Movie.mov' });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ index: 1, source: 'Movie.mov', fixExpressions: false });
    const layer = (ae.project.item(1) as MockCompItem).layer(1) as unknown as { source: unknown; fixedExpressions: boolean };
    expect(layer.source).toBe(footage);
    expect(layer.fixedExpressions).toBe(false);
  });

  it('finds the item by id and passes fixExpressions through', async () => {
    const { ctx, ae } = await payloadContext();
    const footage = new MockFootageItem(500, 'Movie.mov', 1920, 1080);
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    ae.project.add(footage);
    invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Clip' });

    const out = invoke(ctx, 'layer.replace_source', { comp: 'Main', layer: 'Clip', item: 500, fixExpressions: true });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ source: 'Movie.mov', fixExpressions: true });
  });

  it('refuses an unknown item', async () => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Clip' });

    const out = invoke(ctx, 'layer.replace_source', { comp: 'Main', layer: 'Clip', item: 'Nope.mov' });

    expect(out.ok).toBe(false);
    expect(out.issue?.message).toContain('item not found: Nope.mov');
  });
});
