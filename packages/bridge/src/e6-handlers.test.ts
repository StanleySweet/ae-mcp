import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import {
  MockAE,
  MockCompItem,
  MockFootageItem,
  MockTextLayer,
  MockShapeLayer,
  MockAVLayer,
  MockProperty,
  MockPropertyGroup,
  runInMockAE,
} from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-e6-'));
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

describe('comp handlers', () => {
  it('comp.create adds a comp through the item collection', async () => {
    const { ctx, ae } = await payloadContext();

    const out = invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });

    expect(out.value).toMatchObject({ name: 'Main' });
    expect(ae.project.numItems).toBe(1);
    expect(ae.project.item(1)).toBeInstanceOf(MockCompItem);
  });

  it('comp.duplicate clones and registers the comp', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);

    const out = invoke(ctx, 'comp.duplicate', { name: 'Main' });

    expect(out.value).toMatchObject({ name: 'Main Copy' });
    expect(ae.project.numItems).toBe(2);
  });

  it('comp.precompose wraps the existing layers in a new comp', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    invoke(ctx, 'layer.add_shape', { comp: 'Main' });

    const out = invoke(ctx, 'comp.precompose', { name: 'Main', newName: 'Pre' });

    expect(out.value).toMatchObject({ name: 'Pre' });
    expect(ae.project.numItems).toBe(2);
  });

  it('project.undo runs the Edit > Undo command', async () => {
    const { ctx, ae } = await payloadContext();

    const out = invoke(ctx, 'project.undo', null);

    expect(out.value).toEqual({ success: true });
    expect(ae.executedCommands).toEqual([16]);
  });
});

describe('layer handlers', () => {
  it('layer.add_text creates a text layer', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);

    const out = invoke(ctx, 'layer.add_text', { comp: 'Main', text: 'Hello' });

    expect(out.value).toMatchObject({ name: 'Text' });
    expect(ae.project.item(1)).toBeInstanceOf(MockCompItem);
    expect((ae.project.item(1) as MockCompItem).layer(1)).toBeInstanceOf(MockTextLayer);
  });

  it('layer.add_shape creates a shape layer', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);

    invoke(ctx, 'layer.add_shape', { comp: 'Main' });

    expect((ae.project.item(1) as MockCompItem).layer(1)).toBeInstanceOf(MockShapeLayer);
  });

  it('layer.add_solid creates a solid layer', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);

    const out = invoke(ctx, 'layer.add_solid', { comp: 'Main', color: [1, 0, 0] });

    expect(out.value).toMatchObject({ name: 'Solid' });
    const layer = (ae.project.item(1) as MockCompItem).layer(1) as MockAVLayer;
    expect(layer).toBeInstanceOf(MockAVLayer);
    expect(layer.width).toBe(800);
  });

  it('layer.add_adjustment creates an adjustment layer', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);

    invoke(ctx, 'layer.add_adjustment', { comp: 'Main' });

    const layer = (ae.project.item(1) as MockCompItem).layer(1) as MockAVLayer;
    expect(layer.name).toBe('Adjustment');
    expect(layer.adjustmentLayer).toBe(true);
  });

  it('layer.add_null creates a null layer', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);

    invoke(ctx, 'layer.add_null', { comp: 'Main' });

    const layer = (ae.project.item(1) as MockCompItem).layer(1) as MockAVLayer;
    expect(layer.name).toBe('Null');
    expect(layer.nullLayer).toBe(true);
  });

  it('layer.add_footage adds an existing footage item as a layer', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    ae.project.add(new MockFootageItem(500, 'Movie.mov', 1920, 1080));

    const out = invoke(ctx, 'layer.add_footage', { comp: 'Main', name: 'Movie.mov' });

    expect(out.value).toMatchObject({ name: 'Movie.mov' });
    const layer = (ae.project.item(1) as MockCompItem).layer(1) as MockAVLayer;
    expect(layer.source).toBeInstanceOf(MockFootageItem);
  });

  it('layer.add_footage reports a missing footage item', async () => {
    const { ctx } = await payloadContext();
    createComp(ctx);

    const out = invoke(ctx, 'layer.add_footage', { comp: 'Main', name: 'Nope.mov' });

    expect(out.value).toEqual({ success: false, error: 'Footage item not found' });
  });

  it('layer.delete removes the layer from the composition', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    comp.addLayer(new MockAVLayer('Keep', 'Layer'));
    comp.addLayer(new MockAVLayer('Drop', 'Layer'));

    const out = invoke(ctx, 'layer.delete', { comp: 'Main', index: 2 });

    expect(out.value).toEqual({ success: true });
    expect(comp.numLayers).toBe(1);
    expect(comp.layer(1)?.name).toBe('Keep');
  });
});

describe('expression-driver warnings', () => {
  it('warns when an edit targets an expression-driven property', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const layer = new MockAVLayer('Layer', 'Layer');
    const position = new MockProperty('Position', 'ADBE Position', [0, 0]);
    position.expressionEnabled = true;
    position.expression = 'wiggle(2, 30)';
    layer.add(position);
    comp.addLayer(layer);

    const out = invoke(ctx, 'property.set', { comp: 'Main', name: 'Position', value: [10, 20] });

    expect(out.value).toMatchObject({ success: true });
    expect((out.value as { warning: string }).warning).toContain('wiggle(2, 30)');
  });

  it('does not warn for a property without an expression', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const layer = new MockAVLayer('Layer', 'Layer');
    layer.add(new MockProperty('Position', 'ADBE Position', [0, 0]));
    comp.addLayer(layer);

    const out = invoke(ctx, 'property.set', { comp: 'Main', name: 'Position', value: [10, 20] });

    expect(out.value).toEqual({ success: true });
  });

  it('sets a value of 0 instead of treating it as missing', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const layer = new MockAVLayer('Layer', 'Layer');
    const opacity = new MockProperty('Opacity', 'ADBE Opacity', 100);
    layer.add(opacity);
    comp.addLayer(layer);

    const out = invoke(ctx, 'property.set', { comp: 'Main', name: 'Opacity', value: 0 });

    expect(out.value).toEqual({ success: true });
    expect(opacity.value).toBe(0);
  });
});

describe('property layer index', () => {
  it('reads the property on the requested layer, not layer 1', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const first = new MockAVLayer('First', 'Layer');
    first.add(new MockProperty('Opacity', 'ADBE Opacity', 100));
    comp.addLayer(first);
    const second = new MockAVLayer('Second', 'Layer');
    second.add(new MockProperty('Opacity', 'ADBE Opacity', 25));
    comp.addLayer(second);

    const out = invoke(ctx, 'property.get', { comp: 'Main', index: 2, name: 'Opacity' });

    expect(out.value).toEqual({ name: 'Opacity', value: 25 });
  });

  it('writes the property on the requested layer', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    comp.addLayer(new MockAVLayer('First', 'Layer'));
    const second = new MockAVLayer('Second', 'Layer');
    const opacity = new MockProperty('Opacity', 'ADBE Opacity', 100);
    second.add(opacity);
    comp.addLayer(second);

    const out = invoke(ctx, 'property.set', { comp: 'Main', index: 2, name: 'Opacity', value: 0 });

    expect(out.value).toEqual({ success: true });
    expect(opacity.value).toBe(0);
  });

  it('resolves a nested property by its slash path', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const layer = new MockAVLayer('Layer', 'Layer');
    const transform = new MockPropertyGroup('Transform', 'ADBE Transform Group');
    const position = new MockProperty('Position', 'ADBE Position', [10, 20]);
    transform.add(position);
    layer.add(transform);
    comp.addLayer(layer);

    const out = invoke(ctx, 'property.get', { comp: 'Main', index: 1, name: 'Transform/Position' });

    expect(out.value).toEqual({ name: 'Position', value: [10, 20] });
  });
});

describe('property.list', () => {
  it('lists a layer properties, including nested groups', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const layer = new MockAVLayer('Layer', 'Layer');
    const transform = new MockPropertyGroup('Transform', 'ADBE Transform Group');
    transform.add(new MockProperty('Opacity', 'ADBE Opacity', 100));
    layer.add(transform);
    comp.addLayer(layer);

    const out = invoke(ctx, 'property.list', { comp: 'Main' });
    const layers = (
      out.value as {
        layers: { name: string; properties: { matchName: string; properties?: { matchName: string }[] }[] }[];
      }
    ).layers;

    expect(layers.length).toBe(1);
    const transformEntry = layers[0].properties.find((p) => p.matchName === 'ADBE Transform Group');
    expect(transformEntry).toBeDefined();
    expect(transformEntry!.properties?.some((c) => c.matchName === 'ADBE Opacity')).toBe(true);
  });
});

describe('expression handlers', () => {
  it('sets and enables an expression on the requested layer', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const first = new MockAVLayer('First', 'Layer');
    first.add(new MockProperty('Position', 'ADBE Position', [0, 0]));
    comp.addLayer(first);
    const second = new MockAVLayer('Second', 'Layer');
    const position = new MockProperty('Position', 'ADBE Position', [0, 0]);
    second.add(position);
    comp.addLayer(second);

    const out = invoke(ctx, 'expression.set', {
      comp: 'Main',
      index: 2,
      property: 'Position',
      value: 'wiggle(2, 30)',
    });

    expect(out.value).toEqual({ success: true, expression: 'wiggle(2, 30)', enabled: true });
    expect(position.expression).toBe('wiggle(2, 30)');
    expect(position.expressionEnabled).toBe(true);
  });

  it('clears and disables the expression', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const layer = new MockAVLayer('Layer', 'Layer');
    const position = new MockProperty('Position', 'ADBE Position', [0, 0]);
    position.expression = 'wiggle(2, 30)';
    position.expressionEnabled = true;
    layer.add(position);
    comp.addLayer(layer);

    const out = invoke(ctx, 'expression.clear', { comp: 'Main', index: 1, property: 'Position' });

    expect(out.value).toEqual({ success: true, enabled: false });
    expect(position.expression).toBe('');
    expect(position.expressionEnabled).toBe(false);
  });

  it('reports the expression error and an empty string when healthy', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const layer = new MockAVLayer('Layer', 'Layer');
    const position = new MockProperty('Position', 'ADBE Position', [0, 0]);
    layer.add(position);
    comp.addLayer(layer);

    expect(
      invoke(ctx, 'expression.check_errors', { comp: 'Main', index: 1, property: 'Position' }).value,
    ).toEqual({ success: true, error: '' });

    position.expressionError = 'missing ;';
    expect(
      invoke(ctx, 'expression.check_errors', { comp: 'Main', index: 1, property: 'Position' }).value,
    ).toEqual({ success: true, error: 'missing ;' });
  });
});

describe('text handlers', () => {
  it('applies a fill color even without a font size', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);

    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi', fillColor: [1, 0, 0] });

    const layer = (ae.project.item(1) as MockCompItem).layer(1) as MockTextLayer;
    const doc = (layer.property('Source Text') as MockProperty).value as { fillColor: number[] };
    expect(doc.fillColor).toEqual([1, 0, 0]);
  });

  it('sets and reads back font, justification, tracking and leading', async () => {
    const { ctx } = await payloadContext();
    createComp(ctx);
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi' });

    invoke(ctx, 'text.set', {
      comp: 'Main',
      layerIndex: 1,
      font: 'TimesNewRomanPSMT',
      justification: 'center',
      tracking: 50,
      leading: 100,
    });

    const out = invoke(ctx, 'text.read', { comp: 'Main', layerIndex: 1 });

    expect(out.value).toMatchObject({
      text: 'Hi',
      font: 'TimesNewRomanPSMT',
      justification: 'center',
      tracking: 50,
      leading: 100,
    });
  });

  it('rejects an unknown justification', async () => {
    const { ctx } = await payloadContext();
    createComp(ctx);
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi' });

    const out = invoke(ctx, 'text.set', { comp: 'Main', layerIndex: 1, justification: 'sideways' });

    expect(out.value).toMatchObject({ success: false });
    expect((out.value as { error: string }).error).toContain('sideways');
  });
});

describe('layer.bounds', () => {
  it('reports the layer bounds box, not the comp rect', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const layer = new MockAVLayer('Layer', 'Layer');
    layer.width = 200;
    layer.height = 100;
    comp.addLayer(layer);

    const out = invoke(ctx, 'layer.bounds', { comp: 'Main', index: 1 });

    expect(out.value).toEqual({
      left: -100,
      top: -50,
      right: 100,
      bottom: 50,
      width: 200,
      height: 100,
    });
  });

  it('is not the comp rect even when the layer fills the comp', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const layer = new MockAVLayer('Layer', 'Layer');
    layer.width = 40;
    layer.height = 20;
    comp.addLayer(layer);

    const out = invoke(ctx, 'layer.bounds', { comp: 'Main', index: 1 }) as {
      value: { left: number; top: number; right: number; bottom: number };
    };

    expect(out.value.right).toBe(20);
    expect(out.value.bottom).toBe(10);
  });
});

describe('marker handlers', () => {
  it('adds and lists comp-level markers', async () => {
    const { ctx } = await payloadContext();
    createComp(ctx);

    expect(invoke(ctx, 'marker.add', { comp: 'Main', time: 1, comment: 'cue' }).value).toEqual({
      success: true,
    });
    const listed = invoke(ctx, 'marker.list', { comp: 'Main' });

    expect(listed.value).toEqual({
      markers: [{ index: 1, time: 1, comment: 'cue', duration: 0 }],
    });
  });

  it('adds markers to a specific layer', async () => {
    const { ctx } = await payloadContext();
    createComp(ctx);
    invoke(ctx, 'layer.add_shape', { comp: 'Main' });

    invoke(ctx, 'marker.add', { comp: 'Main', layerIndex: 1, time: 2, comment: 'on layer' });
    const listed = invoke(ctx, 'marker.list', { comp: 'Main', layerIndex: 1 });

    expect(listed.value).toEqual({
      markers: [{ index: 1, time: 2, comment: 'on layer', duration: 0 }],
    });
  });

  it('adds a batch of markers', async () => {
    const { ctx } = await payloadContext();
    createComp(ctx);

    const out = invoke(ctx, 'marker.add_bulk', {
      comp: 'Main',
      markers: [
        { time: 0, comment: 'a' },
        { time: 3, comment: 'b' },
      ],
    });
    const listed = invoke(ctx, 'marker.list', { comp: 'Main' }) as { value: { markers: unknown[] } };

    expect(out.value).toEqual({ success: true, count: 2 });
    expect(listed.value.markers).toHaveLength(2);
  });
});

describe('keyframe handlers', () => {
  function layerWithScale(ae: MockAE): MockProperty {
    const comp = ae.project.item(1) as MockCompItem;
    const layer = new MockAVLayer('Layer', 'Layer');
    const scale = new MockProperty('Scale', 'ADBE Scale', [100, 100, 100]);
    layer.add(scale);
    comp.addLayer(layer);
    return scale;
  }

  it('adds and removes a keyframe on a nested transform property', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const scale = layerWithScale(ae);

    const added = invoke(ctx, 'keyframe.add', {
      comp: 'Main',
      index: 1,
      time: 1,
      value: [100, 100, 100],
      property: 'Scale',
    });
    expect(added.value).toMatchObject({ success: true, time: 1, property: 'Scale' });
    expect(scale.numKeys).toBe(1);

    const removed = invoke(ctx, 'keyframe.remove', {
      comp: 'Main',
      index: 1,
      time: 1,
      property: 'Scale',
    });
    expect(removed.value).toEqual({ success: true });
    expect(scale.numKeys).toBe(0);
  });

  it('keys a value of 0 instead of substituting the [0, 0] default', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const layer = new MockAVLayer('Layer', 'Layer');
    const opacity = new MockProperty('Opacity', 'ADBE Opacity', 100);
    layer.add(opacity);
    comp.addLayer(layer);

    const out = invoke(ctx, 'keyframe.add', {
      comp: 'Main',
      index: 1,
      time: 1,
      value: 0,
      property: 'Opacity',
    });

    expect(out.value).toMatchObject({ success: true });
    expect(opacity.numKeys).toBe(1);
    expect(opacity.keyValue(1)).toBe(0);
  });

  it('set_easing passes one KeyframeEase per value dimension', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const scale = layerWithScale(ae);
    invoke(ctx, 'keyframe.add', {
      comp: 'Main',
      index: 1,
      time: 1,
      value: [100, 100, 100],
      property: 'Scale',
    });

    const out = invoke(ctx, 'keyframe.set_easing', {
      comp: 'Main',
      index: 1,
      time: 1,
      property: 'Scale',
      easing: 'easeIn',
    });

    expect(out.value).toMatchObject({ success: true, easing: 'easeIn', keyIndex: 1 });
    expect(scale.interpolationTypes).toHaveLength(1);
    expect(scale.temporalEases).toHaveLength(1);
    expect(scale.temporalEases[0]!.inEase).toHaveLength(3);
    expect(scale.temporalEases[0]!.outEase).toHaveLength(3);
  });

  it('set_easing hold only changes the interpolation type', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const scale = layerWithScale(ae);
    invoke(ctx, 'keyframe.add', {
      comp: 'Main',
      index: 1,
      time: 1,
      value: [100, 100, 100],
      property: 'Scale',
    });

    const out = invoke(ctx, 'keyframe.set_easing', {
      comp: 'Main',
      index: 1,
      time: 1,
      property: 'Scale',
      easing: 'hold',
    });

    expect(out.value).toMatchObject({ success: true, easing: 'hold' });
    expect(scale.interpolationTypes).toEqual([{ keyIndex: 1, inType: 3, outType: 3 }]);
    expect(scale.temporalEases).toHaveLength(0);
  });

  it('set_easing reports a missing keyframe', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    layerWithScale(ae);

    const out = invoke(ctx, 'keyframe.set_easing', {
      comp: 'Main',
      index: 1,
      time: 5,
      property: 'Scale',
      easing: 'linear',
    });

    expect(out.value).toEqual({ success: false, error: 'No keyframe at time 5' });
  });
});
