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

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'Footage item not found' });
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

  it('layer.center moves every selected layer, not just the first', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    invoke(ctx, 'layer.add_null', { comp: 'Main' });
    invoke(ctx, 'layer.add_null', { comp: 'Main' });
    const first = comp.layer(1) as MockAVLayer;
    const second = comp.layer(2) as MockAVLayer;
    const positionOf = (layer: MockAVLayer): MockProperty =>
      (layer.property('ADBE Transform Group') as MockPropertyGroup).property('ADBE Position') as MockProperty;
    positionOf(first).setValue([0, 0]);
    positionOf(second).setValue([0, 0]);
    // selectedLayers is a 0-based JS array (CompItem.selectedLayers, Ref: https://ae-scripting.docsforadobe.dev/item/compitem/).
    comp.selectedLayers = [first, second];

    const out = invoke(ctx, 'layer.center', { comp: 'Main' });

    expect(out.value).toEqual({ success: true });
    expect(positionOf(first).value).toEqual([400, 300]);
    expect(positionOf(second).value).toEqual([400, 300]);
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

    const out = invoke(ctx, 'property.list', { comp: 'Main', depth: 2 });
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

  type ListedProperty = { matchName: string; numProperties?: number; properties?: ListedProperty[] };
  type ListedLayer = { index: number; name: string; properties: ListedProperty[] };

  // A layer whose Transform group holds Opacity and a nested Deep group (with Child).
  function layerWithNestedGroups(comp: MockCompItem, name: string): void {
    const layer = new MockAVLayer(name, 'Layer');
    const transform = new MockPropertyGroup('Transform', 'ADBE Transform Group');
    transform.add(new MockProperty('Opacity', 'ADBE Opacity', 100));
    const deep = transform.add(new MockPropertyGroup('Deep', 'ADBE Deep Group'));
    deep.add(new MockProperty('Child', 'ADBE Child', 1));
    layer.add(transform);
    comp.addLayer(layer);
  }

  it('does not expand groups at the default depth', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    layerWithNestedGroups(ae.project.item(1) as MockCompItem, 'Layer');

    const out = invoke(ctx, 'property.list', { comp: 'Main' });
    const layers = (out.value as { layers: ListedLayer[] }).layers;

    const transform = layers[0].properties.find((p) => p.matchName === 'ADBE Transform Group');
    expect(transform).toMatchObject({ numProperties: 2 });
    expect(transform!.properties).toBeUndefined();
  });

  it('expands one group level per depth step', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    layerWithNestedGroups(ae.project.item(1) as MockCompItem, 'Layer');

    const out = invoke(ctx, 'property.list', { comp: 'Main', depth: 2 });
    const layers = (out.value as { layers: ListedLayer[] }).layers;

    const transform = layers[0].properties.find((p) => p.matchName === 'ADBE Transform Group');
    expect(transform!.properties?.map((p) => p.matchName)).toEqual(['ADBE Opacity', 'ADBE Deep Group']);
    const deep = transform!.properties!.find((p) => p.matchName === 'ADBE Deep Group');
    expect(deep).toMatchObject({ numProperties: 1 });
    expect(deep!.properties).toBeUndefined();
  });

  it('lists only the layer at index when index is given', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    layerWithNestedGroups(comp, 'First');
    layerWithNestedGroups(comp, 'Second');

    const out = invoke(ctx, 'property.list', { comp: 'Main', index: 2 });
    const layers = (out.value as { layers: ListedLayer[] }).layers;

    expect(layers.map((l) => [l.index, l.name])).toEqual([[2, 'Second']]);
  });

  it('rejects an index that names no layer with INVALID_ARGS', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    layerWithNestedGroups(ae.project.item(1) as MockCompItem, 'Layer');

    const out = invoke(ctx, 'property.list', { comp: 'Main', index: 5 });

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'layer not found: 5' });
  });

  it('skips disabled properties and empty groups', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const layer = new MockAVLayer('Layer', 'Layer');
    const transform = new MockPropertyGroup('Transform', 'ADBE Transform Group');
    transform.add(new MockProperty('Opacity', 'ADBE Opacity', 100));
    const hidden = transform.add(new MockProperty('Hidden', 'ADBE Hidden', 0));
    hidden.enabled = false;
    layer.add(transform);
    const disabledGroup = layer.add(new MockPropertyGroup('Disabled', 'ADBE Disabled Group'));
    disabledGroup.add(new MockProperty('Inside', 'ADBE Inside', 1));
    (disabledGroup as unknown as { enabled: boolean }).enabled = false;
    layer.add(new MockPropertyGroup('Layer Styles', 'ADBE Layer Styles'));
    (ae.project.item(1) as MockCompItem).addLayer(layer);

    const out = invoke(ctx, 'property.list', { comp: 'Main', depth: 2 });
    const top = (out.value as { layers: ListedLayer[] }).layers[0].properties;

    expect(top.map((p) => p.matchName)).toEqual(['ADBE Transform Group']);
    expect(top[0].properties?.map((p) => p.matchName)).toEqual(['ADBE Opacity']);
  });
});

describe('effect handlers', () => {
  it('applies, lists, keys and removes an effect on the chosen layer', async () => {
    const { ctx, ae } = await payloadContext();
    createComp(ctx);
    const comp = ae.project.item(1) as MockCompItem;
    const first = new MockAVLayer('First', 'Layer');
    comp.addLayer(first);
    const second = new MockAVLayer('Second', 'Layer');
    comp.addLayer(second);

    const applied = invoke(ctx, 'effect.apply', {
      comp: 'Main',
      index: 2,
      effect: 'ADBE Slider Control',
    });
    expect(applied.value).toMatchObject({ effect: { matchName: 'ADBE Slider Control' } });
    // The effect lands on layer 2; layer 1's parade stays empty.
    const parade = second.property('ADBE Effect Parade') as MockPropertyGroup;
    expect(parade.numProperties).toBe(1);
    expect((first.property('ADBE Effect Parade') as MockPropertyGroup).numProperties).toBe(0);

    expect(invoke(ctx, 'effect.list_on_layer', { comp: 'Main', index: 2 }).value).toEqual({
      success: true,
      effects: [
        { index: 1, name: 'ADBE Slider Control', matchName: 'ADBE Slider Control', enabled: true },
      ],
    });

    const effect = parade.property(1) as MockPropertyGroup;
    const slider = effect.property('ADBE Slider Control-0001') as MockProperty;
    expect(
      invoke(ctx, 'effect.set_property', {
        comp: 'Main',
        index: 2,
        effect: 'ADBE Slider Control',
        property: 'ADBE Slider Control-0001',
        value: 42,
      }).value,
    ).toMatchObject({ success: true });
    expect(slider.value).toBe(42);

    invoke(ctx, 'effect.set_keyframe', {
      comp: 'Main',
      index: 2,
      effect: 'ADBE Slider Control',
      property: 'ADBE Slider Control-0001',
      time: 1,
      value: 7,
    });
    expect(slider.keys).toEqual([{ time: 1, value: 7 }]);

    expect(
      invoke(ctx, 'effect.remove', { comp: 'Main', index: 2, effect: 'ADBE Slider Control' }).value,
    ).toEqual({ success: true, removed: 'ADBE Slider Control' });
    expect(parade.numProperties).toBe(0);
  });

  it('lists the effects available in the application', async () => {
    const { ctx } = await payloadContext();

    const out = invoke(ctx, 'effect.list_available', null).value as {
      effects: { name: string; matchName: string; category: string }[];
    };

    expect(out.effects).toContainEqual({
      name: 'Glow',
      matchName: 'ADBE Glo2',
      category: 'Stylize',
    });
  });

  it('reports missing arguments and a missing effect', async () => {
    const { ctx } = await payloadContext();
    createComp(ctx);
    invoke(ctx, 'layer.add_shape', { comp: 'Main' });

    expect(invoke(ctx, 'effect.apply', { comp: 'Main' }).issue).toMatchObject({ code: 'INVALID_ARGS', message: 'Effect required' });
    expect(invoke(ctx, 'effect.remove', { comp: 'Main', effect: 'ADBE Nope' }).issue).toMatchObject({ code: 'INVALID_ARGS', message: 'Effect not found: ADBE Nope' });
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

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: expect.stringContaining('sideways') });
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

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS', message: 'No keyframe at time 5' });
  });
});
