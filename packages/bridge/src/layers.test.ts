import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockProperty, MockPropertyGroup, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-layers-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: unknown; issue?: { code: string; message: string } } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

async function setup(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const { ctx, ae } = await payloadContext();
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  invoke(ctx, 'layer.add_null', { comp: 'Main' });
  return { ctx, ae };
}

function transformProp(ae: MockAE, matchName: string): MockProperty {
  const layer = (ae.project.item(1) as MockCompItem).layer(1) as unknown as MockPropertyGroup;
  const transform = layer.property('ADBE Transform Group') as MockPropertyGroup;
  return transform.property(matchName) as MockProperty;
}

describe('layer.rename', () => {
  it('renames the layer and reports the new name', async () => {
    const { ctx, ae } = await setup();

    const r = invoke(ctx, 'layer.rename', { comp: 'Main', index: 1, name: 'Pivot' });

    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ index: 1, name: 'Pivot' });
    expect((ae.project.item(1) as MockCompItem).layer(1)?.name).toBe('Pivot');
  });

  it('refuses an empty or missing name', async () => {
    const { ctx } = await setup();

    expect(invoke(ctx, 'layer.rename', { comp: 'Main', index: 1, name: '' }).issue?.code).toBe('INVALID_ARGS');
    expect(invoke(ctx, 'layer.rename', { comp: 'Main', index: 1 }).issue?.code).toBe('INVALID_ARGS');
  });

  it('refuses a missing layer', async () => {
    const { ctx } = await setup();

    const r = invoke(ctx, 'layer.rename', { comp: 'Main', index: 9, name: 'Ghost' });

    expect(r.issue?.code).toBe('INVALID_ARGS');
    expect(r.issue?.message).toContain('layer not found: 9');
  });
});

describe('layer.set_transform', () => {
  // AE refuses setValue on a keyframed property; the test drive hit this (#223).
  it('sets a key at the comp time when the property is keyframed', async () => {
    const { ctx, ae } = await setup();
    const scale = transformProp(ae, 'ADBE Scale');
    scale.setValueAtTime(0, [100, 100, 100]);
    scale.setValueAtTime(2, [120, 120, 100]);
    (ae.project.item(1) as MockCompItem).time = 1;

    const r = invoke(ctx, 'layer.set_transform', { comp: 'Main', index: 1, scale: [50, 50, 100] });

    expect(r.ok).toBe(true);
    expect(scale.numKeys).toBe(3);
    expect(scale.keyValue(scale.nearestKeyIndex(1))).toEqual([50, 50, 100]);
  });

  it('sets only scale and leaves position alone', async () => {
    const { ctx, ae } = await setup();

    const r = invoke(ctx, 'layer.set_transform', { comp: 'Main', index: 1, scale: [50, 50, 100] });

    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ index: 1, set: ['scale'] });
    expect(transformProp(ae, 'ADBE Scale').value).toEqual([50, 50, 100]);
    expect(transformProp(ae, 'ADBE Position').value).toEqual([0, 0, 0]);
  });

  it('sets all five fields and reports them in order', async () => {
    const { ctx, ae } = await setup();

    const r = invoke(ctx, 'layer.set_transform', {
      comp: 'Main',
      index: 1,
      anchorPoint: [10, 20, 0],
      position: [400, 300, 0],
      scale: [80, 80, 100],
      rotation: 45,
      opacity: 60,
    });

    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ index: 1, set: ['anchorPoint', 'position', 'scale', 'rotation', 'opacity'] });
    expect(transformProp(ae, 'ADBE Anchor Point').value).toEqual([10, 20, 0]);
    expect(transformProp(ae, 'ADBE Position').value).toEqual([400, 300, 0]);
    expect(transformProp(ae, 'ADBE Scale').value).toEqual([80, 80, 100]);
    expect(transformProp(ae, 'ADBE Rotate Z').value).toBe(45);
    expect(transformProp(ae, 'ADBE Opacity').value).toBe(60);
  });

  it('refuses a call that sets nothing', async () => {
    const { ctx } = await setup();

    const r = invoke(ctx, 'layer.set_transform', { comp: 'Main', index: 1 });

    expect(r.issue?.code).toBe('INVALID_ARGS');
    expect(r.issue?.message).toBe('nothing to set: pass anchorPoint, position, scale, rotation or opacity');
  });

  it('no longer crashes when position is omitted', async () => {
    const { ctx, ae } = await setup();

    const r = invoke(ctx, 'layer.set_transform', { comp: 'Main', index: 1, opacity: 25 });

    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ index: 1, set: ['opacity'] });
    expect(transformProp(ae, 'ADBE Opacity').value).toBe(25);
  });
});

describe('layer.add_null naming', () => {
  it('names the new layer when name is given', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });

    const r = invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Pivot' });

    expect(r.ok).toBe(true);
    expect((ae.project.item(1) as MockCompItem).layer(1)?.name).toBe('Pivot');
  });

  it('keeps the default name when name is omitted', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });

    invoke(ctx, 'layer.add_null', { comp: 'Main' });

    expect((ae.project.item(1) as MockCompItem).layer(1)?.name).toBe('Null');
  });
});

describe('property.set on a keyframed property', () => {
  it('sets a key at the comp time instead of failing', async () => {
    const { ctx, ae } = await setup();
    const opacity = transformProp(ae, 'ADBE Opacity');
    opacity.setValueAtTime(0, 100);
    (ae.project.item(1) as MockCompItem).time = 0.5;

    const r = invoke(ctx, 'property.set', { comp: 'Main', index: 1, name: 'ADBE Transform Group/ADBE Opacity', value: 40 });

    expect(r.ok).toBe(true);
    expect(opacity.keyValue(opacity.nearestKeyIndex(0.5))).toBe(40);
  });
});
