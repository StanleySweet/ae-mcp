import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import {
  MockAE,
  MockAVLayer,
  MockCompItem,
  MockKeyframeEase,
  MockProperty,
  PropertyValueType,
  runInMockAE,
} from './mock-ae.js';

interface Outcome {
  ok: boolean;
  value?: Record<string, unknown>;
  issue?: { code: string; message: string };
}

interface Fixture {
  ctx: vm.Context;
  position: MockProperty;
  scale: MockProperty;
  opacity: MockProperty;
}

async function fixture(): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-animate-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  vm.runInContext(`AEMCP.invoke('comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 }, null)`, ctx);
  const comp = ae.project.item(1) as MockCompItem;
  comp.layers.addSolid([1, 0, 0], 'Target', 800, 600, 1, 5);
  const layer = comp.layer(1) as MockAVLayer;
  const transform = layer.property('ADBE Transform Group') as unknown as {
    property(name: string): MockProperty;
  };
  const position = transform.property('ADBE Position');
  position.value = [100, 200, 0];
  const scale = transform.property('ADBE Scale');
  const opacity = transform.property('ADBE Opacity');
  opacity.value = 100;
  return { ctx, position, scale, opacity };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): Outcome {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

function speeds(eases: MockKeyframeEase[]): number[] {
  return eases.map((ease) => ease.speed);
}

function influences(eases: MockKeyframeEase[]): number[] {
  return eases.map((ease) => ease.influence);
}

describe('animate: tracks', () => {
  it('sets keys on several properties in one call and eases every key', async () => {
    const { ctx, position, opacity } = await fixture();

    const outcome = invoke(ctx, 'animate', {
      comp: 'Main',
      layer: 1,
      tracks: {
        'ADBE Opacity': [[0, 0], [2, 100]],
        'ADBE Position': [[0, [100, 200, 0]], [2, [300, 200, 0]]],
      },
      curve: 'linear',
    });

    expect(outcome.issue).toBeUndefined();
    expect(outcome.ok).toBe(true);
    expect(opacity.numKeys).toBe(2);
    expect(position.numKeys).toBe(2);
    expect(opacity.keyOutInterpolationType(1)).toBe(2);
  });

  it('linear curve gives influence 33.33 and speed delta / duration; first and last outer sides are speed 0', async () => {
    const { ctx, opacity } = await fixture();

    invoke(ctx, 'animate', { comp: 'Main', layer: 1, tracks: { 'ADBE Opacity': [[0, 0], [2, 100]] }, curve: 'linear' });

    // Outgoing side of key 1: influence 33.33, speed 100 / 2 s.
    expect(influences(opacity.keyOutTemporalEase(1))[0]).toBeCloseTo(100 / 3, 6);
    expect(speeds(opacity.keyOutTemporalEase(1))[0]).toBeCloseTo(50, 6);
    // Incoming side of key 1 is the comp edge: speed 0.
    expect(speeds(opacity.keyInTemporalEase(1))[0]).toBe(0);
    // Incoming side of key 2: influence 33.33, speed 50.
    expect(influences(opacity.keyInTemporalEase(2))[0]).toBeCloseTo(100 / 3, 6);
    expect(speeds(opacity.keyInTemporalEase(2))[0]).toBeCloseTo(50, 6);
    // Outgoing side of the last key is the comp edge: speed 0.
    expect(speeds(opacity.keyOutTemporalEase(2))[0]).toBe(0);
  });

  it('expo_out matches the hand-computed ease for a 100 unit change over 1 s', async () => {
    const { ctx, opacity } = await fixture();

    invoke(ctx, 'animate', { comp: 'Main', layer: 1, tracks: { 'ADBE Opacity': [[0, 0], [1, 100]] }, curve: 'expo_out' });

    // Curve (0.16, 1, 0.3, 1): out influence 16, out speed (1 / 0.16) * 100 / 1 = 625.
    expect(influences(opacity.keyOutTemporalEase(1))[0]).toBeCloseTo(16, 6);
    expect(speeds(opacity.keyOutTemporalEase(1))[0]).toBeCloseTo(625, 6);
    // In influence (1 - 0.3) * 100 = 70; in speed (1 - 1) / (1 - 0.3) = 0 at the arrival.
    expect(influences(opacity.keyInTemporalEase(2))[0]).toBeCloseTo(70, 6);
    expect(speeds(opacity.keyInTemporalEase(2))[0]).toBeCloseTo(0, 6);
  });

  it('accepts a custom [x1, y1, x2, y2] curve', async () => {
    const { ctx, opacity } = await fixture();

    invoke(ctx, 'animate', { comp: 'Main', layer: 1, tracks: { 'ADBE Opacity': [[0, 0], [2, 50]] }, curve: [0.5, 0.5, 0.5, 0.5] });

    // Out: influence 50, speed (0.5 / 0.5) * 50 / 2 = 25. In: influence 50, speed (0.5 / 0.5) * 50 / 2 = 25.
    expect(influences(opacity.keyOutTemporalEase(1))[0]).toBeCloseTo(50, 6);
    expect(speeds(opacity.keyOutTemporalEase(1))[0]).toBeCloseTo(25, 6);
    expect(speeds(opacity.keyInTemporalEase(2))[0]).toBeCloseTo(25, 6);
  });

  it('gives a multi-dimension value one ease per dimension, speed from that dimension delta', async () => {
    const { ctx, scale } = await fixture();
    scale.propertyValueType = PropertyValueType.TwoD;
    scale.value = [100, 100];

    invoke(ctx, 'animate', { comp: 'Main', layer: 1, tracks: { 'ADBE Scale': [[0, [0, 0]], [1, [100, 50]]] }, curve: 'linear' });

    const out = scale.keyOutTemporalEase(1);
    expect(out.length).toBe(2);
    expect(speeds(out)[0]).toBeCloseTo(100, 6);
    expect(speeds(out)[1]).toBeCloseTo(50, 6);
  });

  it('gives a spatial property one ease whose speed is the distance between the points', async () => {
    const { ctx, position } = await fixture();
    position.isSpatial = true;
    position.value = [0, 0, 0];

    invoke(ctx, 'animate', { comp: 'Main', layer: 1, tracks: { 'ADBE Position': [[0, [0, 0, 0]], [1, [30, 40, 0]]] }, curve: 'linear' });

    const out = position.keyOutTemporalEase(1);
    expect(out.length).toBe(1);
    expect(speeds(out)[0]).toBeCloseTo(50, 6);
  });

  it('refuses unsorted key times, bad curves and unknown properties before writing anything', async () => {
    const { ctx, opacity } = await fixture();

    expect(invoke(ctx, 'animate', { comp: 'Main', layer: 1, tracks: { 'ADBE Opacity': [[2, 0], [1, 100]] } }).ok).toBe(false);
    expect(invoke(ctx, 'animate', { comp: 'Main', layer: 1, tracks: { 'ADBE Opacity': [[0, 0], [1, 100]] }, curve: 'wobbly' }).ok).toBe(false);
    expect(invoke(ctx, 'animate', { comp: 'Main', layer: 1, tracks: { 'ADBE Opacity': [[0, 0], [1, 100]] }, curve: [0, 0, 0.5, 1] }).ok).toBe(false);
    expect(invoke(ctx, 'animate', { comp: 'Main', layer: 1, tracks: { 'ADBE Nope': [[0, 0]] } }).ok).toBe(false);
    expect(opacity.numKeys).toBe(0);
  });
});

describe('animate: motion presets', () => {
  it('fade_in takes opacity from 0 to 100 over duration, starting at start', async () => {
    const { ctx, opacity } = await fixture();

    const outcome = invoke(ctx, 'animate', { comp: 'Main', layer: 1, preset: 'fade_in', start: 1, duration: 0.5 });

    expect(outcome.ok).toBe(true);
    expect(opacity.numKeys).toBe(2);
    expect(opacity.keyTime(1)).toBe(1);
    expect(opacity.keyValue(1)).toBe(0);
    expect(opacity.keyTime(2)).toBe(1.5);
    expect(opacity.keyValue(2)).toBe(100);
  });

  it('slide_in starts the position one distance to the left of its current value', async () => {
    const { ctx, position } = await fixture();

    const outcome = invoke(ctx, 'animate', { comp: 'Main', layer: 1, preset: 'slide_in', duration: 1, distance: 150, direction: 'left' });

    expect(outcome.ok).toBe(true);
    expect(position.keyValue(1)).toEqual([-50, 200, 0]);
    expect(position.keyValue(2)).toEqual([100, 200, 0]);
  });

  it('slide_in from the top moves y by minus the distance', async () => {
    const { ctx, position } = await fixture();

    invoke(ctx, 'animate', { comp: 'Main', layer: 1, preset: 'slide_in', duration: 1, direction: 'up' });

    expect(position.keyValue(1)).toEqual([100, 0, 0]);
    expect(position.keyValue(2)).toEqual([100, 200, 0]);
  });

  it('pop scales from 0 to the current scale with back_out', async () => {
    const { ctx, scale } = await fixture();

    const outcome = invoke(ctx, 'animate', { comp: 'Main', layer: 1, preset: 'pop', duration: 0.5 });

    expect(outcome.ok).toBe(true);
    expect(scale.keyValue(1)).toEqual([0, 0, 0]);
    expect(scale.keyValue(2)).toEqual([100, 100, 100]);
    // back_out: out influence 34, out speed (1.56 / 0.34) * 100 / 0.5.
    expect(influences(scale.keyOutTemporalEase(1))[0]).toBeCloseTo(34, 6);
    expect(speeds(scale.keyOutTemporalEase(1))[0]).toBeCloseTo((1.56 / 0.34) * 100 / 0.5, 6);
  });

  it('refuses an unknown preset, and tracks together with a preset', async () => {
    const { ctx } = await fixture();

    expect(invoke(ctx, 'animate', { comp: 'Main', layer: 1, preset: 'spin' }).ok).toBe(false);
    expect(invoke(ctx, 'animate', { comp: 'Main', layer: 1, preset: 'fade_in', tracks: { 'ADBE Opacity': [[0, 0]] } }).ok).toBe(false);
    expect(invoke(ctx, 'animate', { comp: 'Main', layer: 1 }).ok).toBe(false);
  });
});
