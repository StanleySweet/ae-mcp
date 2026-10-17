import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockAVLayer, MockCompItem, MockMaskParade, runInMockAE } from './mock-ae.js';

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
