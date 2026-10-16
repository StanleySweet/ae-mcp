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
  MockAVLayer,
  MockProperty,
  MockKeyframeEase,
  MockKeyframeInterpolationType,
  runInMockAE,
} from './mock-ae.js';

function invoke(ctx: vm.Context, tool: string, args: unknown): { value?: unknown; issue?: { code: string } } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

async function setup(): Promise<{ ctx: vm.Context; a: MockProperty; b: MockProperty }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-kf-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 10 });
  const comp = ae.project.item(1) as MockCompItem;
  const a = new MockProperty('Opacity', 'ADBE Opacity', 100);
  const b = new MockProperty('Rotation', 'ADBE Rotate Z', 0);
  for (const prop of [a, b]) {
    const layer = new MockAVLayer('L', 'L');
    layer.add(prop);
    comp.addLayer(layer);
  }
  return { ctx, a, b };
}

const times = (p: MockProperty): number[] => p.keys.map((k) => k.time);
const values = (p: MockProperty): unknown[] => p.keys.map((k) => k.value);

function keyed(a: MockProperty): void {
  a.key(1, 10).key(2, 20).key(4, 40);
  a.setInterpolationTypeAtKey(2, MockKeyframeInterpolationType.BEZIER, MockKeyframeInterpolationType.BEZIER);
  a.setTemporalEaseAtKey(2, [new MockKeyframeEase(0, 80)], [new MockKeyframeEase(0, 25)]);
}

describe('keyframe.offset', () => {
  it('shifts every key and keeps the temporal ease', async () => {
    const { ctx, a } = await setup();
    keyed(a);
    const out = invoke(ctx, 'keyframe.offset', { comp: 'Main', index: 1, property: 'ADBE Opacity', seconds: 3 });
    expect(out.issue).toBeUndefined();
    expect(times(a)).toEqual([4, 5, 7]);
    expect(values(a)).toEqual([10, 20, 40]);
    expect(a.keyInInterpolationType(2)).toBe(MockKeyframeInterpolationType.BEZIER);
    expect(a.keyInTemporalEase(2)[0].influence).toBe(80);
    expect(a.keyOutTemporalEase(2)[0].influence).toBe(25);
  });

  it('rejects a property without keys', async () => {
    const { ctx } = await setup();
    const out = invoke(ctx, 'keyframe.offset', { comp: 'Main', index: 1, property: 'ADBE Opacity', seconds: 1 });
    expect(out.issue?.code).toBe('INVALID_ARGS');
  });
});

describe('keyframe.reverse', () => {
  it('mirrors times within the span', async () => {
    const { ctx, a } = await setup();
    keyed(a);
    invoke(ctx, 'keyframe.reverse', { comp: 'Main', index: 1, property: 'ADBE Opacity' });
    expect(times(a)).toEqual([1, 3, 4]);
    expect(values(a)).toEqual([40, 20, 10]);
    expect(a.keyInTemporalEase(2)[0].influence).toBe(80);
  });
});

describe('keyframe.scale_time', () => {
  it('scales around the first key', async () => {
    const { ctx, a } = await setup();
    keyed(a);
    invoke(ctx, 'keyframe.scale_time', { comp: 'Main', index: 1, property: 'ADBE Opacity', factor: 2 });
    expect(times(a)).toEqual([1, 3, 7]);
  });

  it('rejects a non-positive factor', async () => {
    const { ctx, a } = await setup();
    keyed(a);
    const out = invoke(ctx, 'keyframe.scale_time', { comp: 'Main', index: 1, property: 'ADBE Opacity', factor: 0 });
    expect(out.issue?.code).toBe('INVALID_ARGS');
    expect(times(a)).toEqual([1, 2, 4]);
  });
});

describe('keyframe.copy', () => {
  it('copies times, values and eases to another property with an offset', async () => {
    const { ctx, a, b } = await setup();
    keyed(a);
    const out = invoke(ctx, 'keyframe.copy', {
      comp: 'Main',
      from: { index: 1, property: 'ADBE Opacity' },
      to: { index: 2, property: 'ADBE Rotate Z' },
      offset: 0.5,
    });
    expect(out.issue).toBeUndefined();
    expect(times(b)).toEqual([1.5, 2.5, 4.5]);
    expect(values(b)).toEqual([10, 20, 40]);
    expect(b.keyInInterpolationType(2)).toBe(MockKeyframeInterpolationType.BEZIER);
    expect(b.keyOutTemporalEase(2)[0].influence).toBe(25);
    expect(times(a)).toEqual([1, 2, 4]);
  });
});
