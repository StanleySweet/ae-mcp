import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockAVLayer, MockProperty, MockPropertyGroup, runInMockAE } from './mock-ae.js';

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

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: expect.stringContaining('selected') });
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

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'Unknown preset: bogus' });
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

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'Property not found: Opacity' });
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

describe('anchor.move_preserving', () => {
  function layerWithTransform(ae: MockAE): MockAVLayer {
    const comp = ae.project.item(1) as MockCompItem;
    const layer = new MockAVLayer('Layer', 'Layer');
    layer.width = 200;
    layer.height = 100;
    const transform = new MockPropertyGroup('Transform', 'ADBE Transform Group');
    transform.add(new MockProperty('Anchor Point', 'ADBE Anchor Point', [0, 0]));
    transform.add(new MockProperty('Position', 'ADBE Position', [400, 300]));
    layer.add(transform);
    comp.addLayer(layer);
    return layer;
  }

  function transformProp(layer: MockAVLayer, matchName: string): MockProperty {
    return (layer.property('ADBE Transform Group') as MockPropertyGroup).property(
      matchName,
    ) as MockProperty;
  }

  it('moves the anchor to a bounds position and keeps the layer in place', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const layer = layerWithTransform(ae);

    const out = invoke(ctx, 'anchor.move_preserving', {
      comp: 'Main',
      index: 1,
      anchor: 'bottom-right',
    });

    // A 200x100 layer has bottom-right at [100, 50] in layer space; the content
    // must not shift, so position gains exactly the same delta.
    expect(out.value).toMatchObject({ success: true, anchorPoint: [100, 50] });
    expect(transformProp(layer, 'ADBE Anchor Point').value).toEqual([100, 50]);
    expect(transformProp(layer, 'ADBE Position').value).toEqual([500, 350]);
  });

  it('accepts an explicit [x, y] layer point', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const layer = layerWithTransform(ae);

    const out = invoke(ctx, 'anchor.move_preserving', {
      comp: 'Main',
      index: 1,
      anchor: [20, 10],
    });

    expect(out.value).toMatchObject({ success: true, anchorPoint: [20, 10] });
    expect(transformProp(layer, 'ADBE Position').value).toEqual([420, 310]);
  });

  it('leaves a centred layer untouched when asked for centre', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const layer = layerWithTransform(ae);

    const out = invoke(ctx, 'anchor.move_preserving', {
      comp: 'Main',
      index: 1,
      anchor: 'center',
    });

    expect(out.value).toMatchObject({ success: true, anchorPoint: [0, 0] });
    expect(transformProp(layer, 'ADBE Position').value).toEqual([400, 300]);
  });

  it('reports an unknown anchor name', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const layer = layerWithTransform(ae);

    const out = invoke(ctx, 'anchor.move_preserving', {
      comp: 'Main',
      index: 1,
      anchor: 'sideways',
    });

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'Unknown anchor: sideways' });
    expect(transformProp(layer, 'ADBE Position').value).toEqual([400, 300]);
  });
});

describe('expression.snippet', () => {
  it('applies a named snippet to the property expression', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const scale = layerWithScale(ae);

    const out = invoke(ctx, 'expression.snippet', {
      comp: 'Main',
      index: 1,
      property: 'Scale',
      snippet: 'wiggle',
    });

    expect(out.value).toMatchObject({ success: true, snippet: 'wiggle', enabled: true });
    expect(scale.expression).toBe('wiggle(5, 20)');
    expect(scale.expressionEnabled).toBe(true);
  });

  it.each(['wiggle', 'loop', 'delay', 'overshoot'])(
    'applies the %s snippet and defaults to layer 1',
    async (snippet) => {
      const { ctx, ae } = await payloadContext();
      createComp(ctx);
      const scale = layerWithScale(ae);

      const out = invoke(ctx, 'expression.snippet', {
        comp: 'Main',
        property: 'Scale',
        snippet,
      });

      expect(out.value).toMatchObject({ success: true, snippet, enabled: true });
      expect(scale.expression.length).toBeGreaterThan(0);
      expect(scale.expressionEnabled).toBe(true);
    },
  );

  it('reports an unknown snippet name', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const scale = layerWithScale(ae);

    const out = invoke(ctx, 'expression.snippet', {
      comp: 'Main',
      property: 'Scale',
      snippet: 'spin',
    });

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'Unknown snippet: spin' });
    expect(scale.expression).toBe('');
  });

  it('reports a missing property', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    layerWithScale(ae);

    const out = invoke(ctx, 'expression.snippet', {
      comp: 'Main',
      property: 'Opacity',
      snippet: 'loop',
    });

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'Property not found' });
  });
});

describe('rig.null_controller', () => {
  it('creates a null with slider controls and parents the given layers', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    layerWithScale(ae);
    layerWithScale(ae);

    const out = invoke(ctx, 'rig.null_controller', {
      comp: 'Main',
      name: 'Ctrl',
      sliders: ['Amount', 'Delay'],
      layers: [1, 2],
    });

    expect(out.value).toMatchObject({
      success: true,
      nullIndex: 3,
      name: 'Ctrl',
      sliders: ['Amount', 'Delay'],
      linked: [1, 2],
    });
    const comp = ae.project.item(1) as MockCompItem;
    const nullLayer = comp.layer(3) as MockAVLayer;
    expect(nullLayer.nullLayer).toBe(true);
    const effects = nullLayer.property('ADBE Effect Parade') as MockPropertyGroup;
    expect(effects.numProperties).toBe(2);
    expect(comp.layer(1)!.parent).toBe(nullLayer);
    expect(comp.layer(2)!.parent).toBe(nullLayer);
  });

  it('creates a bare controller null when no sliders or layers are given', async () => {
    const { ctx } = await payloadContext();
    createComp(ctx);

    const out = invoke(ctx, 'rig.null_controller', { comp: 'Main' });

    expect(out.value).toMatchObject({
      success: true,
      nullIndex: 1,
      name: 'Controller',
      sliders: [],
      linked: [],
    });
  });

  it('reports a missing composition', async () => {
    const { ctx } = await payloadContext();

    const out = invoke(ctx, 'rig.null_controller', { comp: 'Nope' });

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'composition not found: Nope' });
  });

  it('refuses to build a rig when a target layer is missing', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    layerWithScale(ae);

    const out = invoke(ctx, 'rig.null_controller', {
      comp: 'Main',
      layers: [5],
    });

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'Layer not found: 5' });
    const comp = ae.project.item(1) as MockCompItem;
    expect(comp.numLayers).toBe(1);
  });
});
