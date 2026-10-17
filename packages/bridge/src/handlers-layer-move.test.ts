import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-layer-move-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: unknown; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

/** A comp "Main" with layers A (bottom-most added first) ... so the stack top to bottom is A, B, C, D. */
async function stackedComp(): Promise<{ ctx: vm.Context; ae: MockAE; ids: Record<string, number> }> {
  const { ctx, ae } = await payloadContext();
  // Like real AE, a new layer lands on top: adding D, C, B, A leaves A at the top.
  ae.project.newLayersOnTop = true;
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  const ids: Record<string, number> = {};
  for (const name of ['D', 'C', 'B', 'A']) {
    const out = invoke(ctx, 'layer.add_null', { comp: 'Main', name });
    ids[name] = (out.value as { id: number }).id;
  }
  return { ctx, ae, ids };
}

function names(ae: MockAE): string[] {
  const comp = ae.project.item(1) as MockCompItem;
  const out: string[] = [];
  for (let i = 1; i <= comp.numLayers; i++) out.push(comp.layer(i)!.name);
  return out;
}

describe('layer.move', () => {
  it('moves a layer to the top of the stack and returns its new index', async () => {
    const { ctx, ae } = await stackedComp();

    const out = invoke(ctx, 'layer.move', { comp: 'Main', layer: 'D', to: 'top' });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ index: 1, name: 'D' });
    expect(names(ae)).toEqual(['D', 'A', 'B', 'C']);
  });

  it('moves a layer to the bottom of the stack', async () => {
    const { ctx, ae } = await stackedComp();

    const out = invoke(ctx, 'layer.move', { comp: 'Main', index: 1, to: 'bottom' });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ index: 4, name: 'A' });
    expect(names(ae)).toEqual(['B', 'C', 'D', 'A']);
  });

  it('places a layer directly before a target given by name', async () => {
    const { ctx, ae } = await stackedComp();

    const out = invoke(ctx, 'layer.move', { comp: 'Main', layer: 'D', to: 'before', target: 'B' });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ index: 2, name: 'D' });
    expect(names(ae)).toEqual(['A', 'D', 'B', 'C']);
  });

  it('places a layer directly after a target given by index', async () => {
    const { ctx, ae } = await stackedComp();

    const out = invoke(ctx, 'layer.move', { comp: 'Main', index: 4, to: 'after', target: 2 });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ index: 3, name: 'D' });
    expect(names(ae)).toEqual(['A', 'B', 'D', 'C']);
  });

  it('accepts a target given as {id}', async () => {
    const { ctx, ae, ids } = await stackedComp();

    const out = invoke(ctx, 'layer.move', { comp: 'Main', layer: 'A', to: 'after', target: { id: ids.C } });

    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ index: 3, name: 'A' });
    expect(names(ae)).toEqual(['B', 'C', 'A', 'D']);
  });

  it('refuses before or after without a target', async () => {
    const { ctx, ae } = await stackedComp();

    const out = invoke(ctx, 'layer.move', { comp: 'Main', layer: 'D', to: 'before' });

    expect(out.ok).toBe(false);
    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS' });
    expect(names(ae)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('refuses a target that is the layer itself', async () => {
    const { ctx, ae } = await stackedComp();

    const out = invoke(ctx, 'layer.move', { comp: 'Main', layer: 'D', to: 'after', target: 'D' });

    expect(out.ok).toBe(false);
    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS' });
    expect(names(ae)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('refuses an unknown direction', async () => {
    const { ctx } = await stackedComp();

    const out = invoke(ctx, 'layer.move', { comp: 'Main', layer: 'D', to: 'sideways' });

    expect(out.ok).toBe(false);
    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS' });
  });

  it('refuses an unknown target layer', async () => {
    const { ctx } = await stackedComp();

    const out = invoke(ctx, 'layer.move', { comp: 'Main', layer: 'D', to: 'before', target: 'Nope' });

    expect(out.ok).toBe(false);
    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});
