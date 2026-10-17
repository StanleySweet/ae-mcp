import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockPropertyGroup, MockProperty, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-templates-'));
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

const TRANSFORM = 'ADBE Transform Group';

describe('template.title_card', () => {
  it('builds a background solid, a title and an optional subtitle with eased keys', async () => {
    const { ctx, ae } = await payloadContext();
    const out = invoke(ctx, 'template.title_card', { comp: 'Main', title: 'Opening', subtitle: 'Part 1', duration: 5 });
    expect(out.value).toEqual({ layers: [1, 2, 3] });
    const comp = ae.project.item(1) as MockCompItem;
    expect(comp.layer(1)!.name).toBe('Title Background');
    expect(comp.layer(2)!.outPoint).toBe(5);
    const opacity = prop(ae, 2, TRANSFORM, 'ADBE Opacity');
    expect(opacity.numKeys).toBe(2);
    expect(opacity.temporalEases).toHaveLength(2);
    expect(prop(ae, 2, TRANSFORM, 'ADBE Scale').numKeys).toBe(2);
  });

  it('omits the subtitle and requires a title', async () => {
    const { ctx } = await payloadContext();
    expect(invoke(ctx, 'template.title_card', { comp: 'Main', title: 'Solo' }).value).toEqual({ layers: [1, 2] });
    expect(invoke(ctx, 'template.title_card', { comp: 'Main' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('template.transition', () => {
  async function twoLayers() {
    const context = await payloadContext();
    invoke(context.ctx, 'text.add', { comp: 'Main', text: 'A' });
    invoke(context.ctx, 'text.add', { comp: 'Main', text: 'B' });
    const comp = context.ae.project.item(1) as MockCompItem;
    comp.layer(1)!.outPoint = 4;
    return context;
  }

  it('fade overlaps to onto from and crossfades Opacity', async () => {
    const { ctx, ae } = await twoLayers();
    const out = invoke(ctx, 'template.transition', { comp: 'Main', from: 1, to: 2, style: 'fade', duration: 1 });
    expect(out.value).toMatchObject({ style: 'fade', start: 3, duration: 1, set: ['from.opacity', 'to.opacity'] });
    const comp = ae.project.item(1) as MockCompItem;
    expect(comp.layer(2)!.startTime).toBe(3);
    expect(prop(ae, 1, TRANSFORM, 'ADBE Opacity').numKeys).toBe(2);
    expect(prop(ae, 2, TRANSFORM, 'ADBE Opacity').numKeys).toBe(2);
  });

  it('push and zoom key Position and Scale', async () => {
    const { ctx, ae } = await twoLayers();
    expect(invoke(ctx, 'template.transition', { comp: 'Main', from: 1, to: 2, style: 'push' }).value!.set).toEqual(['from.position', 'to.position']);
    expect(prop(ae, 2, TRANSFORM, 'ADBE Position').numKeys).toBe(2);
    expect(invoke(ctx, 'template.transition', { comp: 'Main', from: 1, to: 2, style: 'zoom' }).value!.set).toEqual(['from.scale', 'from.opacity']);
    expect(prop(ae, 1, TRANSFORM, 'ADBE Scale').numKeys).toBe(2);
  });

  it('refuses an unknown style, unknown layers and a duration longer than from', async () => {
    const { ctx } = await twoLayers();
    expect(invoke(ctx, 'template.transition', { comp: 'Main', from: 1, to: 2, style: 'iris' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
    expect(invoke(ctx, 'template.transition', { comp: 'Main', from: 1, to: 9, style: 'fade' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
    expect(invoke(ctx, 'template.transition', { comp: 'Main', from: 1, to: 2, style: 'fade', duration: 5 }).issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('template.logo_reveal', () => {
  it.each([
    ['fade_scale', ['opacity', 'scale'], ['ADBE Opacity', 'ADBE Scale']],
    ['slide', ['position'], ['ADBE Position']],
    ['spin', ['rotation', 'opacity'], ['ADBE Rotate Z', 'ADBE Opacity']],
  ])('%s keys its transform', async (style, set, matchNames) => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Logo' });
    const out = invoke(ctx, 'template.logo_reveal', { comp: 'Main', index: 1, style });
    expect(out.value).toEqual({ index: 1, style, set });
    for (const name of matchNames) expect(prop(ae, 1, TRANSFORM, name).numKeys).toBe(2);
  });

  it('slide starts 200 px below the resting position', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Logo' });
    invoke(ctx, 'template.logo_reveal', { comp: 'Main', index: 1, style: 'slide' });
    const position = prop(ae, 1, TRANSFORM, 'ADBE Position');
    expect(position.numKeys).toBe(2);
    const start = position.keys[0].value as number[];
    const rest = position.keys[1].value as number[];
    expect(start[0]).toBe(rest[0]);
    expect(start[1] - rest[1]).toBe(200);
  });

  it('rejects an unknown style and a missing layer', async () => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Logo' });
    expect(invoke(ctx, 'template.logo_reveal', { comp: 'Main', index: 1, style: 'bounce' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
    expect(invoke(ctx, 'template.logo_reveal', { comp: 'Main', index: 5, style: 'slide' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('look.apply', () => {
  it.each([
    ['glow', 'ADBE Glo2'],
    ['soft_blur', 'ADBE Gaussian Blur 2'],
    ['film_grain', 'ADBE Noise'],
    ['drop_shadow', 'ADBE Drop Shadow'],
    ['vignette', 'CS Vignette'],
  ])('adds the %s effect', async (look, matchName) => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi' });
    expect(invoke(ctx, 'look.apply', { comp: 'Main', index: 1, look }).value).toEqual({ index: 1, look, effect: matchName, effects: [matchName] });
    const parade = prop(ae, 1, 'ADBE Effect Parade') as unknown as MockPropertyGroup;
    expect(parade.property(1)).toMatchObject({ matchName });
  });

  it('rejects an unknown look', async () => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi' });
    expect(invoke(ctx, 'look.apply', { comp: 'Main', index: 1, look: 'sepia' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('expression.snippet (#217)', () => {
  it.each([
    ['wiggle_smooth', {}, 'wiggle(2, 10, 1)'],
    ['wiggle_smooth', { frequency: 3, amplitude: 4, octaves: 2 }, 'wiggle(3, 4, 2)'],
    ['loop_cycle', {}, 'loopOut("cycle")'],
    ['loop_offset', {}, 'loopOut("offset")'],
    ['spring', { frequency: 3, decay: 4 }, 'Math.sin(3 * t * 2 * Math.PI) / (3 * 2 * Math.PI) / Math.exp(4 * t)'],
    ['clock', {}, 'Math.floor(time / 60)'],
  ])('applies %s', async (snippet, params, fragment) => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: '0' });
    const out = invoke(ctx, 'expression.snippet', { comp: 'Main', property: 'ADBE Text Document', snippet, ...params });
    expect(out.value).toMatchObject({ success: true, snippet, enabled: true });
    expect(prop(ae, 1, 'ADBE Text Properties', 'ADBE Text Document').expression).toContain(fragment);
  });

  it('rejects a negative spring decay and a zero wiggle octave count', async () => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: '0' });
    expect(invoke(ctx, 'expression.snippet', { comp: 'Main', property: 'ADBE Text Document', snippet: 'spring', decay: -1 }).issue).toMatchObject({ code: 'INVALID_ARGS' });
    expect(invoke(ctx, 'expression.snippet', { comp: 'Main', property: 'ADBE Text Document', snippet: 'wiggle_smooth', octaves: 0 }).issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});
