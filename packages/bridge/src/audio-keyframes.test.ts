import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockAVLayer, MockCompItem, MockProperty, MockPropertyGroup, runInMockAE } from './mock-ae.js';

interface Outcome {
  ok: boolean;
  value?: Record<string, unknown>;
  issue?: { code: string; message: string };
}

interface Fixture {
  ctx: vm.Context;
  ae: MockAE;
  /** Audio Levels of the audio layer (layer 2). */
  levels: MockProperty;
  /** Scale of the target layer (layer 1). */
  scale: MockProperty;
}

async function fixture(): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-audio-keys-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  vm.runInContext(`AEMCP.invoke('comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 5 }, null)`, ctx);
  const comp = ae.project.item(1) as MockCompItem;
  comp.layers.addSolid([1, 0, 0], 'Target', 800, 600, 1, 5);
  const target = comp.layer(1) as MockAVLayer;
  const transform = target.property('ADBE Transform Group') as MockPropertyGroup;
  const scaleProp = transform.property('ADBE Scale') as MockProperty;
  const audio = new MockAVLayer('Tone', 'Layer');
  audio.hasAudio = true;
  const group = audio.add(new MockPropertyGroup('Audio', 'ADBE Audio Group'));
  const levels = group.add(new MockProperty('Audio Levels', 'ADBE Audio Levels', [0, 0]));
  comp.addLayer(audio);
  // Loud at the start of the comp and silent at the end: the level falls from 0 dB to -60 dB.
  levels.setValueAtTime(0, [0, 0]);
  levels.setValueAtTime(5, [-60, -60]);
  return { ctx, ae, levels, scale: scaleProp };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): Outcome {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

describe('audio.to_keyframes', () => {
  it('writes one keyframe per frame, following the amplitude', async () => {
    const { ctx, scale } = await fixture();

    const outcome = invoke(ctx, 'audio.to_keyframes', {
      comp: 'Main',
      audioLayer: 2,
      targetLayer: 1,
      property: 'ADBE Scale',
    });

    expect(outcome.issue).toBeUndefined();
    expect(outcome.ok).toBe(true);
    // 5 s at 24 fps is 120 frames, plus the first frame at 0 s.
    expect(scale.numKeys).toBe(121);
    expect(scale.keys[0]?.value).toEqual([100, 100, 100]);
    expect(scale.keys[120]?.value).toEqual([0, 0, 0]);
  });

  it('scales the full-volume value by the scale parameter', async () => {
    const { ctx, scale } = await fixture();

    const outcome = invoke(ctx, 'audio.to_keyframes', {
      comp: 'Main',
      audioLayer: 2,
      targetLayer: 1,
      property: 'ADBE Scale',
      scale: 50,
    });

    expect(outcome.ok).toBe(true);
    expect(scale.keys[0]?.value).toEqual([50, 50, 50]);
    expect(scale.keys[120]?.value).toEqual([0, 0, 0]);
  });

  it('holds the keyframe nearest each cut point', async () => {
    const { ctx, scale } = await fixture();

    const outcome = invoke(ctx, 'audio.to_keyframes', {
      comp: 'Main',
      audioLayer: 2,
      targetLayer: 1,
      property: 'ADBE Scale',
      cuts: [1.0],
    });

    expect(outcome.ok).toBe(true);
    // 1.0 s is frame 25 (key index 25), and HOLD is interpolation type 3.
    expect(scale.keys[24]?.outType).toBe(3);
  });

  it('refuses an unknown layer, an unknown property, and a property that already has keys', async () => {
    const { ctx, scale } = await fixture();

    expect(invoke(ctx, 'audio.to_keyframes', { comp: 'Main', audioLayer: 2, targetLayer: 9, property: 'ADBE Scale' }).issue?.code).toBe('INVALID_ARGS');
    expect(invoke(ctx, 'audio.to_keyframes', { comp: 'Main', audioLayer: 2, targetLayer: 1, property: 'ADBE Nope' }).issue?.code).toBe('INVALID_ARGS');

    scale.setValueAtTime(0, [100, 100, 100]);
    const keyed = invoke(ctx, 'audio.to_keyframes', { comp: 'Main', audioLayer: 2, targetLayer: 1, property: 'ADBE Scale' });
    expect(keyed.issue?.code).toBe('INVALID_ARGS');
    expect(scale.numKeys).toBe(1);
  });
});
