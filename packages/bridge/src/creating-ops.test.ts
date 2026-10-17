import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockFootageItem, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-creating-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

type Ref = { index: number; id: number; name: string; layers?: number[]; [key: string]: unknown };

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value: Ref; issue?: { code: string; message: string } } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

async function setup(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const { ctx, ae } = await payloadContext();
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  ae.project.add(new MockFootageItem(500, 'Movie.mov', 1920, 1080));
  return { ctx, ae };
}

// The returned reference must name the layer that is really at that index.
function expectRef(ae: MockAE, value: { index: number; id: number; name: string }): void {
  const layer = (ae.project.item(1) as MockCompItem).layer(value.index);
  expect(layer).not.toBeNull();
  expect(value.id).toBe(layer?.id);
  expect(value.name).toBe(layer?.name);
  expect(typeof value.id).toBe('number');
  expect(typeof value.name).toBe('string');
}

describe('creating operations return {index, id, name}', () => {
  it('layer.add_text, add_shape, add_solid, add_adjustment, add_null and add_footage', async () => {
    const { ctx, ae } = await setup();
    const ops: Array<[string, Record<string, unknown>]> = [
      ['layer.add_text', { comp: 'Main', text: 'Hi' }],
      ['layer.add_shape', { comp: 'Main' }],
      ['layer.add_solid', { comp: 'Main' }],
      ['layer.add_adjustment', { comp: 'Main' }],
      ['layer.add_null', { comp: 'Main' }],
      ['layer.add_footage', { comp: 'Main', name: 'Movie.mov' }],
    ];
    for (const [op, args] of ops) {
      const out = invoke(ctx, op, args);
      expect(out.ok, op).toBe(true);
      expectRef(ae, out.value);
    }
  });

  it('layer.add_camera and layer.add_light', async () => {
    const { ctx, ae } = await setup();

    const camera = invoke(ctx, 'layer.add_camera', { comp: 'Main' });
    expect(camera.ok).toBe(true);
    expectRef(ae, camera.value);

    const light = invoke(ctx, 'layer.add_light', { comp: 'Main' });
    expect(light.ok).toBe(true);
    expectRef(ae, light.value);
  });

  it('text.add and shape.add keep layerIndex and add the reference', async () => {
    const { ctx, ae } = await setup();

    const text = invoke(ctx, 'text.add', { comp: 'Main', text: 'Hello' });
    expect(text.value).toMatchObject({ success: true, layerIndex: 1, index: 1 });
    expectRef(ae, text.value);

    const shape = invoke(ctx, 'shape.add', { comp: 'Main', type: 'rect', size: [50, 50], layerName: 'Bar' });
    expect(shape.value).toMatchObject({ success: true, name: 'Bar' });
    expect(shape.value.layerIndex).toBe(shape.value.index);
    expectRef(ae, shape.value);
  });

  it('rig.null_controller returns the controller reference and keeps nullIndex', async () => {
    const { ctx, ae } = await setup();
    invoke(ctx, 'layer.add_solid', { comp: 'Main' });

    const out = invoke(ctx, 'rig.null_controller', { comp: 'Main', name: 'Ctrl', sliders: ['Amount'], layers: [1] });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ success: true, nullIndex: out.value.index, name: 'Ctrl' });
    expectRef(ae, out.value);
  });

  it('template.lower_third and template.title_card return the lead layer reference', async () => {
    const { ctx, ae } = await setup();

    const lower = invoke(ctx, 'template.lower_third', { comp: 'Main', title: 'Jane', subtitle: 'Director' });
    expect(lower.ok).toBe(true);
    expect(lower.value.layers?.length).toBeGreaterThan(0);
    expectRef(ae, lower.value);

    const card = invoke(ctx, 'template.title_card', { comp: 'Main', title: 'Opening' });
    expect(card.ok).toBe(true);
    expect(card.value.layers?.length).toBeGreaterThan(0);
    expectRef(ae, card.value);
  });
});
