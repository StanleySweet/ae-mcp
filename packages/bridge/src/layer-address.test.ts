import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockAVLayer, MockCompItem, MockMaskParade, MockProperty, MockPropertyGroup, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-address-'));
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

// Comp Main holds, bottom to top: Beta (index 3), Alpha (index 2), Beta (index 1).
// Layer.add* puts each new layer on top, so the last one added is index 1.
async function setup(): Promise<{ ctx: vm.Context; ae: MockAE; ids: { alpha: number; betaTop: number; betaBottom: number } }> {
  const { ctx, ae } = await payloadContext();
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Beta' });
  invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Alpha' });
  invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Beta' });
  const comp = ae.project.item(1) as MockCompItem;
  const ids = {
    betaBottom: comp.layer(3)?.id as number,
    alpha: comp.layer(2)?.id as number,
    betaTop: comp.layer(1)?.id as number,
  };
  return { ctx, ae, ids };
}

describe('layer addressing by index, name or id', () => {
  it('keeps the index argument working', async () => {
    const { ctx, ae } = await setup();

    const r = invoke(ctx, 'layer.rename', { comp: 'Main', index: 2, name: 'Gamma' });

    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ index: 2, name: 'Gamma' });
    expect((ae.project.item(1) as MockCompItem).layer(2)?.name).toBe('Gamma');
  });

  it('accepts an exact unique layer name', async () => {
    const { ctx, ae } = await setup();

    const r = invoke(ctx, 'layer.rename', { comp: 'Main', layer: 'Alpha', name: 'Gamma' });

    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ index: 2, name: 'Gamma' });
    expect((ae.project.item(1) as MockCompItem).layer(2)?.name).toBe('Gamma');
  });

  it('accepts a layer id as {id}', async () => {
    const { ctx, ae, ids } = await setup();

    expect(invoke(ctx, 'layer.bounds', { comp: 'Main', layer: { id: ids.alpha } }).ok).toBe(true);

    const r = invoke(ctx, 'layer.rename', { comp: 'Main', layer: { id: ids.alpha }, name: 'Delta' });

    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ index: 2, name: 'Delta' });
    expect((ae.project.item(1) as MockCompItem).layer(2)?.name).toBe('Delta');
  });

  it('refuses an ambiguous name and lists the matching layers', async () => {
    const { ctx, ae, ids } = await setup();

    const r = invoke(ctx, 'layer.rename', { comp: 'Main', layer: 'Beta', name: 'Gamma' });

    expect(r.issue?.code).toBe('INVALID_ARGS');
    expect(r.issue?.message).toContain('"Beta"');
    expect(r.issue?.message).toContain('index 3');
    expect(r.issue?.message).toContain(`id ${ids.betaBottom}`);
    expect(r.issue?.message).toContain('index 1');
    expect(r.issue?.message).toContain(`id ${ids.betaTop}`);
    expect((ae.project.item(1) as MockCompItem).layer(1)?.name).toBe('Beta');
  });

  it('refuses a name that matches no layer and names the value', async () => {
    const { ctx } = await setup();

    const r = invoke(ctx, 'layer.rename', { comp: 'Main', layer: 'Nope', name: 'Gamma' });

    expect(r.issue?.code).toBe('INVALID_ARGS');
    expect(r.issue?.message).toContain('Nope');
  });

  it('refuses an id that matches no layer and names the value', async () => {
    const { ctx } = await setup();

    const r = invoke(ctx, 'layer.bounds', { comp: 'Main', layer: { id: 99999 } });

    expect(r.issue?.code).toBe('INVALID_ARGS');
    expect(r.issue?.message).toContain('99999');
  });

  it('refuses a call that names no layer', async () => {
    const { ctx } = await setup();

    const r = invoke(ctx, 'layer.rename', { comp: 'Main', name: 'Gamma' });

    expect(r.issue?.code).toBe('INVALID_ARGS');
    expect(r.issue?.message).toContain('layer');
  });
});

// Shape, mask, marker and text ops took only layerIndex; they now take layer too.
// 'Mask Host' is an AV layer with a Masks group (as in mask-handlers.test.ts), since the
// mock shape layer has none. Lookups go by name, so the stacking order does not matter.
async function typedSetup(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const { ctx, ae } = await payloadContext();
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi' });
  invoke(ctx, 'layer.rename', { comp: 'Main', index: 1, name: 'Title' });
  invoke(ctx, 'layer.add_shape', { comp: 'Main' });
  const host = new MockAVLayer('Mask Host', 'Layer');
  host.add(new MockMaskParade());
  (ae.project.item(1) as MockCompItem).addLayer(host);
  return { ctx, ae };
}

function idOf(ae: MockAE, name: string): number {
  const comp = ae.project.item(1) as MockCompItem;
  for (let i = 1; i <= comp.numLayers; i++) {
    if (comp.layer(i)?.name === name) return comp.layer(i)?.id as number;
  }
  throw new Error(`no layer named ${name}`);
}

describe('layer addressing on shape, mask, marker and text ops', () => {
  it('shape.read takes a layer name or {id}, and still takes layerIndex', async () => {
    const { ctx, ae } = await typedSetup();
    expect(invoke(ctx, 'shape.read', { comp: 'Main', layer: 'Shape' }).ok).toBe(true);
    expect(invoke(ctx, 'shape.read', { comp: 'Main', layer: { id: idOf(ae, 'Shape') } }).ok).toBe(true);
    expect(invoke(ctx, 'shape.read', { comp: 'Main', layerIndex: 2 }).ok).toBe(true);
  });

  it('mask.add and mask.read take a layer name', async () => {
    const { ctx } = await typedSetup();
    const vertices = [[0, 0], [10, 0], [10, 10]];

    const added = invoke(ctx, 'mask.add', { comp: 'Main', layer: 'Mask Host', vertices, closed: true });
    expect(added.ok).toBe(true);

    const read = invoke(ctx, 'mask.read', { comp: 'Main', layer: 'Mask Host', maskIndex: 1 });
    expect(read.value).toMatchObject({ vertices, closed: true });
  });

  it('marker.add and marker.list take a layer name and leave comp markers alone', async () => {
    const { ctx } = await typedSetup();

    expect(invoke(ctx, 'marker.add', { comp: 'Main', layer: 'Shape', time: 1, comment: 'cue' }).ok).toBe(true);

    expect(invoke(ctx, 'marker.list', { comp: 'Main', layer: 'Shape' }).value).toEqual({
      markers: [{ index: 1, time: 1, comment: 'cue', duration: 0 }],
    });
    expect(invoke(ctx, 'marker.list', { comp: 'Main' }).value).toEqual({ markers: [] });
  });

  it('text.set and text.read take a layer name or {id}', async () => {
    const { ctx, ae } = await typedSetup();

    expect(invoke(ctx, 'text.set', { comp: 'Main', layer: 'Title', tracking: 50 }).ok).toBe(true);

    const read = invoke(ctx, 'text.read', { comp: 'Main', layer: { id: idOf(ae, 'Title') } });
    expect(read.value).toMatchObject({ text: 'Hi', tracking: 50 });
  });
});

// The same layer, addressed three ways: by index, by exact name and by {id}. Alpha is index 2
// in setup(), and its name is unique, so every form must reach the same layer.
function alphaRefs(ids: { alpha: number }): Array<{ label: string; ref: Record<string, unknown> }> {
  return [
    { label: 'index', ref: { index: 2 } },
    { label: 'name', ref: { layer: 'Alpha' } },
    { label: 'id', ref: { layer: { id: ids.alpha } } },
  ];
}

describe('layer addressing on property, effect, keyframe and transform ops', () => {
  it('property.set and property.list take index, name or {id}', async () => {
    for (const { label, ref } of alphaRefs({ alpha: 0 }).slice(0, 2)) {
      const { ctx, ae } = await setup();
      const set = invoke(ctx, 'property.set', { comp: 'Main', ...ref, name: 'Opacity', value: 30 });
      expect(set.ok, label).toBe(true);
      const opacity = ((ae.project.item(1) as MockCompItem).layer(2) as unknown as MockPropertyGroup)
        .property('ADBE Transform Group') as MockPropertyGroup;
      expect((opacity.property('ADBE Opacity') as MockProperty).value, label).toBe(30);
    }
    const { ctx, ids } = await setup();
    const listed = invoke(ctx, 'property.list', { comp: 'Main', layer: { id: ids.alpha } });
    expect(listed.ok).toBe(true);
    expect((listed.value as { layers: Array<{ name: string }> }).layers.map((l) => l.name)).toEqual(['Alpha']);
  });

  it('property.set takes {id} as well', async () => {
    const { ctx, ae, ids } = await setup();
    expect(invoke(ctx, 'property.set', { comp: 'Main', layer: { id: ids.alpha }, name: 'Opacity', value: 45 }).ok).toBe(true);
    const transform = (ae.project.item(1) as MockCompItem).layer(2) as unknown as MockPropertyGroup;
    expect(((transform.property('ADBE Transform Group') as MockPropertyGroup).property('ADBE Opacity') as MockProperty).value).toBe(45);
  });

  it('layer.set_transform takes index, name or {id}', async () => {
    for (const { label, ref } of alphaRefs({ alpha: 0 })) {
      const { ctx, ae, ids } = await setup();
      const useRef = label === 'id' ? { layer: { id: ids.alpha } } : ref;
      const r = invoke(ctx, 'layer.set_transform', { comp: 'Main', ...useRef, opacity: 25 });
      expect(r.ok, label).toBe(true);
      const layer = (ae.project.item(1) as MockCompItem).layer(2) as unknown as MockPropertyGroup;
      expect(((layer.property('ADBE Transform Group') as MockPropertyGroup).property('ADBE Opacity') as MockProperty).value, label).toBe(25);
    }
  });

  it('effect.set_property takes index, name or {id}', async () => {
    for (const label of ['index', 'name', 'id']) {
      const { ctx, ae, ids } = await setup();
      const ref = label === 'index' ? { index: 2 } : label === 'name' ? { layer: 'Alpha' } : { layer: { id: ids.alpha } };
      expect(invoke(ctx, 'effect.apply', { comp: 'Main', ...ref, effect: 'ADBE Slider Control' }).ok, label).toBe(true);
      const r = invoke(ctx, 'effect.set_property', {
        comp: 'Main',
        ...ref,
        effect: 'ADBE Slider Control',
        property: 'ADBE Slider Control-0001',
        value: 42,
      });
      expect(r.ok, label).toBe(true);
      const alpha = (ae.project.item(1) as MockCompItem).layer(2) as unknown as MockPropertyGroup;
      const parade = alpha.property('ADBE Effect Parade') as MockPropertyGroup;
      const slider = (parade.property(1) as MockPropertyGroup).property('ADBE Slider Control-0001') as MockProperty;
      expect(slider.value, label).toBe(42);
    }
  });

  it('keyframe.remove takes index, name or {id}', async () => {
    for (const label of ['index', 'name', 'id']) {
      const { ctx, ae, ids } = await setup();
      const ref = label === 'index' ? { index: 2 } : label === 'name' ? { layer: 'Alpha' } : { layer: { id: ids.alpha } };
      expect(invoke(ctx, 'keyframe.add', { comp: 'Main', ...ref, property: 'Opacity', time: 1, value: 50 }).ok, label).toBe(true);
      const alpha = (ae.project.item(1) as MockCompItem).layer(2) as unknown as MockPropertyGroup;
      const opacity = (alpha.property('ADBE Transform Group') as MockPropertyGroup).property('ADBE Opacity') as MockProperty;
      expect(opacity.numKeys, label).toBe(1);
      expect(invoke(ctx, 'keyframe.remove', { comp: 'Main', ...ref, property: 'Opacity', time: 1 }).ok, label).toBe(true);
      expect(opacity.numKeys, label).toBe(0);
    }
  });

  it('mask.add takes index, name or {id} on the same layer', async () => {
    const { ctx, ae } = await typedSetup();
    const comp = ae.project.item(1) as MockCompItem;
    let hostIndex = 0;
    for (let i = 1; i <= comp.numLayers; i++) if (comp.layer(i)?.name === 'Mask Host') hostIndex = i;
    // The mock gives id only to layers it creates itself, so give the manually added host one.
    (comp.layer(hostIndex) as unknown as { id: number }).id = 900;
    const hostId = idOf(ae, 'Mask Host');
    const vertices = [[0, 0], [10, 0], [10, 10]];
    expect(invoke(ctx, 'mask.add', { comp: 'Main', index: hostIndex, vertices, closed: true }).ok).toBe(true);
    expect(invoke(ctx, 'mask.add', { comp: 'Main', layer: 'Mask Host', vertices, closed: true }).ok).toBe(true);
    expect(invoke(ctx, 'mask.add', { comp: 'Main', layer: { id: hostId }, vertices, closed: true }).ok).toBe(true);
  });
});
