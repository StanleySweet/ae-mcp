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
