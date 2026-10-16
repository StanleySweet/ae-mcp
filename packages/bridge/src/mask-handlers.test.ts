import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockAVLayer, MockCompItem, MockMaskParade, MockProperty, MockPropertyGroup, runInMockAE } from './mock-ae.js';

// The mock's Masks group carries fr_FR display names, so these tests fail if a
// handler looks masks up by English display name instead of match name (#177).
async function maskLayerContext(): Promise<{ ctx: vm.Context; masks: MockMaskParade }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-mask-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  vm.runInContext(
    `AEMCP.invoke('comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 }, null)`,
    ctx,
  );
  const layer = new MockAVLayer('Solid', 'Layer');
  const masks = layer.add(new MockMaskParade());
  (ae.project.item(1) as MockCompItem).addLayer(layer);
  return { ctx, masks };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: unknown; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

function maskPath(masks: MockMaskParade, index: number): { vertices: number[][]; closed: boolean } {
  const atom = masks.property(index) as MockPropertyGroup;
  return (atom.property('ADBE Mask Shape') as MockProperty).value as { vertices: number[][]; closed: boolean };
}

describe('mask ops', () => {
  it('mask.add adds an ADBE Mask Atom and sets its path', async () => {
    const { ctx, masks } = await maskLayerContext();

    const out = invoke(ctx, 'mask.add', {
      comp: 'Main',
      layerIndex: 1,
      vertices: [[100, 100], [500, 100], [500, 400]],
      closed: true,
    });

    expect(out).toMatchObject({ ok: true, value: { success: true, maskIndex: 1 } });
    expect((masks.property(1) as MockPropertyGroup).matchName).toBe('ADBE Mask Atom');
    expect(maskPath(masks, 1).vertices).toEqual([[100, 100], [500, 100], [500, 400]]);
  });

  it('mask.set updates the path of the given mask', async () => {
    const { ctx, masks } = await maskLayerContext();
    invoke(ctx, 'mask.add', { comp: 'Main', layerIndex: 1 });
    invoke(ctx, 'mask.add', { comp: 'Main', layerIndex: 1 });

    const out = invoke(ctx, 'mask.set', { comp: 'Main', layerIndex: 1, maskIndex: 2, vertices: [[0, 0], [10, 10]], closed: false });

    expect(out).toMatchObject({ ok: true, value: { success: true } });
    expect(maskPath(masks, 2)).toMatchObject({ vertices: [[0, 0], [10, 10]], closed: false });
  });

  it('mask.read returns the path of the given mask', async () => {
    const { ctx } = await maskLayerContext();
    invoke(ctx, 'mask.add', { comp: 'Main', layerIndex: 1, vertices: [[1, 2], [3, 4]], closed: true });

    const out = invoke(ctx, 'mask.read', { comp: 'Main', layerIndex: 1, maskIndex: 1 });

    expect(out).toMatchObject({ ok: true, value: { vertices: [[1, 2], [3, 4]], closed: true } });
  });
});
