import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockBlendingMode, MockCompItem, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-blend-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are untyped JSON
function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: any; issue?: { code: string; message: string } } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

describe('layer.set_blend_mode', () => {
  it('sets a snake-case mode on a layer addressed by name', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Glow' });

    const out = invoke(ctx, 'layer.set_blend_mode', { comp: 'Main', layer: 'Glow', mode: 'soft_light' });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ index: 1, mode: 'soft_light' });
    const layer = (ae.project.item(1) as MockCompItem).layer(1) as unknown as { blendingMode: number };
    expect(layer.blendingMode).toBe(MockBlendingMode.SOFT_LIGHT);
  });

  it('refuses an unknown mode', async () => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    invoke(ctx, 'layer.add_null', { comp: 'Main' });

    const out = invoke(ctx, 'layer.set_blend_mode', { comp: 'Main', index: 1, mode: 'glowy' });

    expect(out.ok).toBe(false);
    expect(out.issue?.message).toContain('unknown blend mode: glowy');
  });
});

describe('shape.add rect roundness', () => {
  it('sets the rectangle corner radius', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });

    const out = invoke(ctx, 'shape.add', { comp: 'Main', type: 'rect', size: [300, 300], roundness: 60, fillColor: [1, 1, 1] });

    expect(out.ok).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- walking the mock property tree
    const layer = (ae.project.item(1) as MockCompItem).layer(1) as any;
    const roundness = layer
      .property('ADBE Root Vectors Group')
      .property(1)
      .property('ADBE Vectors Group')
      .property('ADBE Vector Shape - Rect')
      .property('ADBE Vector Rect Roundness').value;
    expect(roundness).toBe(60);
  });
});

// layer.set_parent wrote layer.parentIndex, which AE ignores; the parent must be Layer.parent.
describe('layer.set_parent', () => {
  it('parents by index or name and reports the parent index', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Child' });
    invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Rig' });

    const out = invoke(ctx, 'layer.set_parent', { comp: 'Main', layer: 'Child', parent: 'Rig' });

    expect(out.ok).toBe(true);
    const comp = ae.project.item(1) as MockCompItem;
    const child = comp.layer(out.value.index) as unknown as { parent: { name: string; index: number } | null };
    expect(child.parent?.name).toBe('Rig');
    expect(out.value.parentIndex).toBe(child.parent?.index);

    expect(invoke(ctx, 'layer.set_parent', { comp: 'Main', layer: 'Child', parent: 0 }).value).toMatchObject({ parentIndex: null });
    expect(child.parent).toBeNull();
  });
});

describe('Advanced 3D support', () => {
  it('switches the comp renderer and refuses an unknown one', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });

    expect(invoke(ctx, 'comp.set_settings', { comp: 'Main', renderer: 'Advanced 3D' }).ok).toBe(true);
    expect((ae.project.item(1) as unknown as { renderer: string }).renderer).toBe('Advanced 3D');

    const bad = invoke(ctx, 'comp.set_settings', { comp: 'Main', renderer: 'Ray-traced' });
    expect(bad.issue?.message).toContain('available: Classic 3D, Advanced 3D');
  });

  it('refuses an environment light source layer, which crashed AE 26.5 on render (#282)', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
    invoke(ctx, 'layer.add_null', { comp: 'Main', name: 'Env Map' });

    const out = invoke(ctx, 'layer.add_light', { comp: 'Main', name: 'Env', lightType: 'environment', lightSource: 'Env Map' });

    expect(out.ok).toBe(false);
    expect(out.issue?.message).toContain('#282');
    expect((ae.project.item(1) as MockCompItem).numLayers).toBe(1);
  });

  it('adds an environment light without a source layer', async () => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });

    const out = invoke(ctx, 'layer.add_light', { comp: 'Main', name: 'Env', lightType: 'environment' });

    expect(out.ok).toBe(true);
  });
});
