import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockPropertyGroup, MockProperty, runInMockAE } from './mock-ae.js';

// #225: styles, presets, looks and snippets that drive first-party effects or
// expressions. Effect parameter match names come from the live probe
// (docs/findings/2026-10-17-effect-param-matchnames.md).

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-effect-templates-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 10 });
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: Record<string, unknown>; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

function prop(ae: MockAE, index: number, ...path: string[]): MockProperty {
  const comp = ae.project.item(1) as MockCompItem;
  let node = comp.layer(index) as unknown as MockPropertyGroup;
  for (const name of path) node = node.property(name) as MockPropertyGroup;
  return node as unknown as MockProperty;
}

// A parameter of an effect on a layer, by the effect's and the parameter's match names.
function param(ae: MockAE, index: number, effect: string, parameter: string): MockProperty {
  return prop(ae, index, 'ADBE Effect Parade', effect, parameter);
}

const TRANSFORM = 'ADBE Transform Group';

describe('template.transition wipe', () => {
  it('keys Linear Wipe Completion on from from 0 to 100 and leaves to alone', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'A' });
    invoke(ctx, 'text.add', { comp: 'Main', text: 'B' });
    (ae.project.item(1) as MockCompItem).layer(1)!.outPoint = 4;
    const out = invoke(ctx, 'template.transition', { comp: 'Main', from: 1, to: 2, style: 'wipe', duration: 1 });
    expect(out.value).toMatchObject({ style: 'wipe', start: 3, set: ['from.wipe'] });
    const completion = param(ae, 1, 'ADBE Linear Wipe', 'ADBE Linear Wipe-0001');
    expect(completion.numKeys).toBe(2);
    expect(completion.keys.map((k) => k.value)).toEqual([0, 100]);
    expect(completion.keys.map((k) => k.time)).toEqual([3, 4]);
    expect(prop(ae, 2, TRANSFORM, 'ADBE Opacity').numKeys).toBe(0);
  });
});

describe('template.lower_third styles', () => {
  it.each(['classic', 'modern', 'minimal', 'news'])('%s builds bar, title and subtitle with eased keys', async (style) => {
    const { ctx, ae } = await payloadContext();
    const out = invoke(ctx, 'template.lower_third', { comp: 'Main', title: 'Jane', subtitle: 'Director', style });
    expect(out.value!.layers).toHaveLength(3);
    for (const index of out.value!.layers as number[]) {
      expect(prop(ae, index, TRANSFORM, 'ADBE Position').numKeys).toBe(2);
    }
  });

  it('refuses an unknown style', async () => {
    const { ctx } = await payloadContext();
    expect(invoke(ctx, 'template.lower_third', { comp: 'Main', title: 'X', style: 'neon' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('template.title_card styles', () => {
  it('cinematic fades slowly without scaling; default scales', async () => {
    const { ctx, ae } = await payloadContext();
    const cine = invoke(ctx, 'template.title_card', { comp: 'Main', title: 'Cine', style: 'cinematic' });
    const cineTitle = (cine.value!.layers as number[])[1];
    expect(prop(ae, cineTitle, TRANSFORM, 'ADBE Scale').numKeys).toBe(0);
    expect(prop(ae, cineTitle, TRANSFORM, 'ADBE Opacity').keys[1].time).toBeCloseTo(1.5);
    const def = invoke(ctx, 'template.title_card', { comp: 'Main', title: 'Def' });
    const defTitle = (def.value!.layers as number[])[1];
    expect(prop(ae, defTitle, TRANSFORM, 'ADBE Scale').numKeys).toBe(2);
  });

  it('minimal uses a light background and refuses unknown styles', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'template.title_card', { comp: 'Main', title: 'Min', style: 'minimal' });
    expect((ae.project.item(1) as MockCompItem).layer(1)!.name).toBe('Title Background');
    expect(invoke(ctx, 'template.title_card', { comp: 'Main', title: 'X', style: 'loud' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('template.logo_reveal glitch', () => {
  it('keys Turbulent Displace amount 60 to 0 and sets a flicker expression on Opacity', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Logo' });
    const out = invoke(ctx, 'template.logo_reveal', { comp: 'Main', index: 1, style: 'glitch' });
    expect(out.value).toEqual({ index: 1, style: 'glitch', set: ['turbulent_displace.amount', 'opacity'] });
    const amount = param(ae, 1, 'ADBE Turbulent Displace', 'ADBE Turbulent Displace-0002');
    expect(amount.keys.map((k) => k.value)).toEqual([60, 0]);
    const opacity = prop(ae, 1, TRANSFORM, 'ADBE Opacity');
    expect(opacity.expressionEnabled).toBe(true);
    expect(opacity.expression).toContain('inPoint + 0.8');
  });
});

describe('text.animate presets', () => {
  it('scale_in drives Scale with an ease expression', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi' });
    expect(invoke(ctx, 'text.animate', { comp: 'Main', index: 1, preset: 'scale_in' }).value).toMatchObject({ property: 'ADBE Scale' });
    expect(prop(ae, 1, TRANSFORM, 'ADBE Scale').expression).toContain('[80, 80], [100, 100]');
  });

  it('wave drives Position with a sine expression', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi' });
    expect(invoke(ctx, 'text.animate', { comp: 'Main', index: 1, preset: 'wave' }).value).toMatchObject({ property: 'ADBE Position' });
    expect(prop(ae, 1, TRANSFORM, 'ADBE Position').expression).toContain('Math.sin');
  });

  it('blur_in keys Gaussian Blur blurriness from 30 to 0 over duration', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi' });
    const out = invoke(ctx, 'text.animate', { comp: 'Main', index: 1, preset: 'blur_in', duration: 2 });
    expect(out.value).toMatchObject({ success: true, preset: 'blur_in', property: 'ADBE Gaussian Blur 2-0001', duration: 2 });
    const blur = param(ae, 1, 'ADBE Gaussian Blur 2', 'ADBE Gaussian Blur 2-0001');
    expect(blur.keys.map((k) => k.value)).toEqual([30, 0]);
    expect(blur.keys.map((k) => k.time)).toEqual([0, 2]);
  });
});

describe('look.apply tuned looks', () => {
  it('sets tuned parameters on an existing look', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi' });
    invoke(ctx, 'look.apply', { comp: 'Main', index: 1, look: 'glow' });
    expect(param(ae, 1, 'ADBE Glo2', 'ADBE Glo2-0003').value).toBe(25);
    expect(param(ae, 1, 'ADBE Glo2', 'ADBE Glo2-0002').value).toBe(60);
  });

  it.each([
    ['neon', ['ADBE Glo2'], { 'ADBE Glo2': { 'ADBE Glo2-0003': 60 } }],
    ['vhs', ['ADBE Noise', 'ADBE Turbulent Displace'], { 'ADBE Noise': { 'ADBE Noise-0001': 12 }, 'ADBE Turbulent Displace': { 'ADBE Turbulent Displace-0002': 2 } }],
    ['chromatic', ['ADBE Turbulent Displace'], { 'ADBE Turbulent Displace': { 'ADBE Turbulent Displace-0002': 5 } }],
    ['duotone', ['ADBE Tint'], { 'ADBE Tint': { 'ADBE Tint-0002': [1, 0.8, 0.4], 'ADBE Tint-0003': 100 } }],
    ['cinematic', ['ADBE Brightness & Contrast 2', 'CS Vignette'], { 'ADBE Brightness & Contrast 2': { 'ADBE Brightness & Contrast 2-0002': 15 }, 'CS Vignette': { 'CS Vignette-0001': 0.6 } }],
  ])('%s adds %j with its parameters', async (look, effects, values) => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi' });
    const out = invoke(ctx, 'look.apply', { comp: 'Main', index: 1, look });
    expect(out.value).toMatchObject({ look, effects });
    for (const [effect, params] of Object.entries(values)) {
      for (const [name, value] of Object.entries(params)) {
        expect(param(ae, 1, effect, name).value, name).toEqual(value);
      }
    }
  });

  it('refuses an unknown look', async () => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi' });
    expect(invoke(ctx, 'look.apply', { comp: 'Main', index: 1, look: 'sepia' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('expression.snippet additions', () => {
  it.each([
    ['bounce_soft', {}, 'Math.exp(4 * t)'],
    ['bounce_hard', {}, 'Math.exp(6 * t)'],
    ['inertia_strong', {}, '(1 - Math.exp(-2 * t)) / 2'],
    ['random_flicker', { amount: 0.3 }, 'value * (1 - 0.3 * r)'],
    ['count_up', { to: 50, seconds: 4 }, 'linear(time, 0, 4, 0, 50)'],
    ['follow', { target: 'Lead Layer', delay: 0.5 }, 'thisComp.layer("Lead Layer").transform.position.valueAtTime(time - 0.5)'],
  ])('applies %s', async (snippet, params, fragment) => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: '0' });
    const out = invoke(ctx, 'expression.snippet', { comp: 'Main', index: 1, property: 'ADBE Transform Group/ADBE Position', snippet, ...params });
    expect(out.value).toMatchObject({ success: true, snippet, enabled: true });
    expect(prop(ae, 1, TRANSFORM, 'ADBE Position').expression).toContain(fragment);
  });

  it('refuses follow without a target or with a quote in it, and a flicker amount above 1', async () => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: '0' });
    const base = { comp: 'Main', index: 1, property: 'ADBE Transform Group/ADBE Position' };
    expect(invoke(ctx, 'expression.snippet', { ...base, snippet: 'follow' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
    expect(invoke(ctx, 'expression.snippet', { ...base, snippet: 'follow', target: 'a"b' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
    expect(invoke(ctx, 'expression.snippet', { ...base, snippet: 'random_flicker', amount: 2 }).issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});
