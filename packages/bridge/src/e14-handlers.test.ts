import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockAVLayer, MockProperty, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-e14-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function invoke(
  ctx: vm.Context,
  tool: string,
  args: unknown,
): { value?: unknown; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

function createComp(ctx: vm.Context): void {
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
}

function layerWithScale(ae: MockAE): MockProperty {
  const comp = ae.project.item(1) as MockCompItem;
  const layer = new MockAVLayer('Layer', 'Layer');
  const scale = new MockProperty('Scale', 'ADBE Scale', [100, 100, 100]);
  layer.add(scale);
  comp.addLayer(layer);
  return scale;
}

function addKeys(scale: MockProperty, times: number[]): void {
  for (const time of times) {
    scale.key(time, [100, 100, 100]);
  }
}

describe('keyframe.ease_preset', () => {
  it('applies the preset to every selected keyframe, one ease per dimension', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const scale = layerWithScale(ae);
    addKeys(scale, [0, 1, 2]);
    scale.selectedKeys = [1, 3];

    const out = invoke(ctx, 'keyframe.ease_preset', {
      comp: 'Main',
      index: 1,
      property: 'Scale',
      preset: 'ease_out',
    });

    expect(out.value).toMatchObject({ success: true, preset: 'ease_out', keyframes: 2 });
    expect(scale.interpolationTypes).toEqual([
      { keyIndex: 1, inType: 2, outType: 2 },
      { keyIndex: 3, inType: 2, outType: 2 },
    ]);
    expect(scale.temporalEases).toHaveLength(2);
    expect(scale.temporalEases[0]!.inEase).toHaveLength(3);
    expect(scale.temporalEases[0]!.outEase).toHaveLength(3);
    expect(scale.temporalEases[0]!.inEase[0]!.influence).toBe(0.1);
    expect(scale.temporalEases[0]!.outEase[0]!.influence).toBe(66.67);
  });

  it('errors when no keyframes are selected', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const scale = layerWithScale(ae);
    addKeys(scale, [0, 1]);

    const out = invoke(ctx, 'keyframe.ease_preset', {
      comp: 'Main',
      index: 1,
      property: 'Scale',
      preset: 'ease_in',
    });

    expect(out.value).toMatchObject({ success: false, error: expect.stringContaining('selected') });
    expect(scale.temporalEases).toHaveLength(0);
  });

  it('rejects an unknown preset', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const scale = layerWithScale(ae);
    addKeys(scale, [0, 1]);
    scale.selectedKeys = [1];

    const out = invoke(ctx, 'keyframe.ease_preset', {
      comp: 'Main',
      index: 1,
      property: 'Scale',
      preset: 'bogus',
    });

    expect(out.value).toEqual({ success: false, error: 'Unknown preset: bogus' });
    expect(scale.temporalEases).toHaveLength(0);
  });

  it('reports a missing property', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    layerWithScale(ae);

    const out = invoke(ctx, 'keyframe.ease_preset', {
      comp: 'Main',
      index: 1,
      property: 'Opacity',
      preset: 'ease_in',
    });

    expect(out.value).toEqual({ success: false, error: 'Property not found: Opacity' });
  });

  it('warns when the property is driven by an expression', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const scale = layerWithScale(ae);
    addKeys(scale, [0, 1]);
    scale.selectedKeys = [1];
    scale.expressionEnabled = true;
    scale.expression = 'time * 100';

    const out = invoke(ctx, 'keyframe.ease_preset', {
      comp: 'Main',
      index: 1,
      property: 'Scale',
      preset: 'ease_in',
    });

    expect(out.value).toMatchObject({
      success: true,
      keyframes: 1,
      warning: expect.stringContaining('expression'),
    });
  });
});
