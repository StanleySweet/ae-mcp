import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockLightLayer, runInMockAE } from './mock-ae.js';

type Result = { ok: boolean; value?: Record<string, unknown>; issue?: { code: string } };

function invoke(ctx: vm.Context, tool: string, args: unknown): Result {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

async function setup(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-camlight-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  return { ctx, ae };
}

describe('camera, light and 3D handlers', () => {
  it('adds a camera with default name', async () => {
    const { ctx } = await setup();
    const r = invoke(ctx, 'layer.add_camera', { comp: 'Main' });
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ index: 1, name: 'Camera' });
  });

  it('adds a named camera at a centre point', async () => {
    const { ctx } = await setup();
    const r = invoke(ctx, 'layer.add_camera', { comp: 'Main', name: 'Cam A', centerPoint: [1, 2] });
    expect(r.value?.name).toBe('Cam A');
  });

  it('adds a light and sets its type', async () => {
    const { ctx, ae } = await setup();
    const r = invoke(ctx, 'layer.add_light', { comp: 'Main', lightType: 'spot' });
    expect(r.value).toMatchObject({ index: 1, name: 'Light', lightType: 'spot' });
    const layer = (ae.project.item(1) as MockCompItem).layer(1) as MockLightLayer;
    expect(layer.lightType).toBe(2);
  });

  it('rejects an unknown light type', async () => {
    const { ctx } = await setup();
    const r = invoke(ctx, 'layer.add_light', { comp: 'Main', lightType: 'laser' });
    expect(r.ok).toBe(false);
    expect(r.issue?.code).toBe('INVALID_ARGS');
  });

  it('toggles 3D on an AV layer', async () => {
    const { ctx } = await setup();
    invoke(ctx, 'layer.add_null', { comp: 'Main' });
    const r = invoke(ctx, 'layer.set_3d', { comp: 'Main', index: 1, enabled: true });
    expect(r.value).toEqual({ index: 1, threeDLayer: true });
  });

  it('refuses 3D on camera layers and missing layers', async () => {
    const { ctx } = await setup();
    invoke(ctx, 'layer.add_camera', { comp: 'Main' });
    expect(invoke(ctx, 'layer.set_3d', { comp: 'Main', index: 1, enabled: true }).issue?.code).toBe('INVALID_ARGS');
    expect(invoke(ctx, 'layer.set_3d', { comp: 'Main', index: 9, enabled: true }).issue?.code).toBe('INVALID_ARGS');
  });

  it('refuses 3D on light layers', async () => {
    const { ctx } = await setup();
    invoke(ctx, 'layer.add_light', { comp: 'Main' });
    const r = invoke(ctx, 'layer.set_3d', { comp: 'Main', index: 1, enabled: true });
    expect(r.ok).toBe(false);
    expect(r.issue?.code).toBe('INVALID_ARGS');
  });

  it('turns 3D on for shape and text layers, which are not AVLayer in AE', async () => {
    const { ctx, ae } = await setup();
    invoke(ctx, 'layer.add_shape', { comp: 'Main' });
    invoke(ctx, 'layer.add_text', { comp: 'Main', text: 'Hello' });
    // The sandbox reproduces AE: neither is `instanceof AVLayer`.
    const comp = ae.project.item(1) as MockCompItem;
    expect(vm.runInContext('(layer) => layer instanceof AVLayer', ctx)(comp.layer(1))).toBe(false);
    expect(vm.runInContext('(layer) => layer instanceof AVLayer', ctx)(comp.layer(2))).toBe(false);

    const shape = invoke(ctx, 'layer.set_3d', { comp: 'Main', index: 1, enabled: true });
    expect(shape.ok).toBe(true);
    expect(shape.value).toEqual({ index: 1, threeDLayer: true });
    const text = invoke(ctx, 'layer.set_3d', { comp: 'Main', index: 2, enabled: true });
    expect(text.ok).toBe(true);
    expect(text.value).toEqual({ index: 2, threeDLayer: true });
  });
});
