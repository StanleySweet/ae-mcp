import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockAVLayer, MockCompItem, MockProperty, MockPropertyGroup, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-keytimes-'));
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

// A comp with two layers: layer 1 has Opacity keys at 2 s and 0.5 s, layer 2 has none.
async function keyedContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const { ctx, ae } = await payloadContext();
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 });
  const comp = ae.project.item(1) as MockCompItem;
  const first = new MockAVLayer('Layer A', 'Layer A');
  const transform = new MockPropertyGroup('Transform', 'ADBE Transform Group');
  transform.add(new MockProperty('Opacity', 'ADBE Opacity', 100));
  first.add(transform);
  comp.addLayer(first);
  const second = new MockAVLayer('Layer B', 'Layer B');
  const transformB = new MockPropertyGroup('Transform', 'ADBE Transform Group');
  transformB.add(new MockProperty('Opacity', 'ADBE Opacity', 100));
  second.add(transformB);
  comp.addLayer(second);
  invoke(ctx, 'keyframe.add', { comp: 'Main', index: 1, property: 'ADBE Opacity', time: 2, value: 0 });
  invoke(ctx, 'keyframe.add', { comp: 'Main', index: 1, property: 'ADBE Opacity', time: 0.5, value: 100 });
  return { ctx, ae };
}

describe('keyframe.times', () => {
  it('lists the key times of one layer, sorted', async () => {
    const { ctx } = await keyedContext();

    const out = invoke(ctx, 'keyframe.times', { comp: 'Main', index: 1 });

    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ comp: 'Main', layers: 1, times: [0.5, 2] });
  });

  it('lists the key times of every layer when no layer is given', async () => {
    const { ctx } = await keyedContext();

    const out = invoke(ctx, 'keyframe.times', { comp: 'Main' });

    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ comp: 'Main', layers: 2, times: [0.5, 2] });
  });

  it('returns no times for a layer without keyframes', async () => {
    const { ctx } = await keyedContext();

    const out = invoke(ctx, 'keyframe.times', { comp: 'Main', index: 2 });

    expect(out.value).toEqual({ comp: 'Main', layers: 1, times: [] });
  });

  it('aborts with INVALID_ARGS for a missing layer', async () => {
    const { ctx } = await keyedContext();

    const out = invoke(ctx, 'keyframe.times', { comp: 'Main', index: 9 });

    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});
