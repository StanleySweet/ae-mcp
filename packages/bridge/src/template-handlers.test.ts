import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build } from './build.js';
import { MockAE, MockCompItem, MockPropertyGroup, MockProperty, PropertyValueType, runInMockAE } from './mock-ae.js';

async function payloadContext(): Promise<{ ctx: vm.Context; ae: MockAE }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-template-'));
  const ae = new MockAE();
  ae.env.HOME = home;
  const outDir = join(home, 'built');
  await build({ outDir });
  const ctx = runInMockAE(readFileSync(join(outDir, 'payload.jsx'), 'utf8'), ae);
  invoke(ctx, 'comp.create', { name: 'Main', width: 800, height: 600, fps: 24, duration: 10 });
  return { ctx, ae };
}

function invoke(ctx: vm.Context, tool: string, args: unknown): { ok: boolean; value?: { layers: number[] }; issue?: unknown } {
  return vm.runInContext(`AEMCP.invoke(${JSON.stringify(tool)}, ${JSON.stringify(args)}, null)`, ctx);
}

function prop(ae: MockAE, index: number, ...path: string[]): MockProperty {
  const comp = ae.project.item(1) as MockCompItem;
  let node = comp.layer(index) as unknown as MockPropertyGroup;
  for (const name of path) node = node.property(name) as MockPropertyGroup;
  return node as unknown as MockProperty;
}

describe('expression.snippet (#192)', () => {
  it.each([
    ['loop_pingpong', {}, 'loopOut("pingpong")'],
    ['bounce', { amplitude: 0.2, frequency: 3, decay: 4 }, '* 0.2 * Math.sin(3 * t'],
    ['inertia', {}, 'velocityAtTime'],
    ['time_counter', { rate: 2 }, 'time * 2'],
    ['countdown', { from: 30 }, '30 - time'],
  ])('applies %s', async (snippet, params, fragment) => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: '0' });
    const out = invoke(ctx, 'expression.snippet', { comp: 'Main', property: 'ADBE Text Document', snippet, ...params });
    expect(out.value).toMatchObject({ success: true, snippet, enabled: true });
    expect(prop(ae, 1, 'ADBE Text Properties', 'ADBE Text Document').expression).toContain(fragment);
  });

  it.each([
    ['bounce', { decay: -1 }],
    ['bounce', { frequency: 0 }],
    ['time_counter', { rate: 'fast' }],
    ['countdown', { from: -5 }],
  ])('rejects bad params for %s', async (snippet, params) => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: '0' });
    const out = invoke(ctx, 'expression.snippet', { comp: 'Main', property: 'ADBE Text Document', snippet, ...params });
    expect(out.issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('text.animate', () => {
  it('typewriter sets a Source Text expression', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hello' });
    const out = invoke(ctx, 'text.animate', { comp: 'Main', index: 1, preset: 'typewriter', duration: 2 });
    expect(out.value).toMatchObject({ success: true, preset: 'typewriter', property: 'ADBE Text Document' });
    const p = prop(ae, 1, 'ADBE Text Properties', 'ADBE Text Document');
    expect(p.expression).toContain('inPoint + 2');
    expect(p.expressionEnabled).toBe(true);
  });

  it('fade_in drives Opacity and slide_up drives Position', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'text.add', { comp: 'Main', text: 'Hi' });
    expect(invoke(ctx, 'text.animate', { comp: 'Main', preset: 'fade_in' }).value).toMatchObject({ property: 'ADBE Opacity' });
    expect(invoke(ctx, 'text.animate', { comp: 'Main', preset: 'slide_up' }).value).toMatchObject({ property: 'ADBE Position' });
    expect(prop(ae, 1, 'ADBE Transform Group', 'ADBE Opacity').expression).toContain('linear(');
    expect(prop(ae, 1, 'ADBE Transform Group', 'ADBE Position').expression).toContain('ease(');
  });

  it('refuses typewriter on a non-text layer, unknown presets and bad durations', async () => {
    const { ctx } = await payloadContext();
    invoke(ctx, 'layer.add_shape', { comp: 'Main' });
    expect(invoke(ctx, 'text.animate', { comp: 'Main', preset: 'typewriter' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
    expect(invoke(ctx, 'text.animate', { comp: 'Main', preset: 'spin' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
    expect(invoke(ctx, 'text.animate', { comp: 'Main', preset: 'fade_in', duration: 0 }).issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('template.lower_third', () => {
  it('builds bar, title and subtitle with eased Position keyframes', async () => {
    const { ctx, ae } = await payloadContext();
    const out = invoke(ctx, 'template.lower_third', { comp: 'Main', title: 'Jane Doe', subtitle: 'Director', duration: 5 });
    expect(out.value).toMatchObject({ success: true });
    expect([...out.value!.layers].sort()).toEqual([1, 2, 3]);
    const comp = ae.project.item(1) as MockCompItem;
    expect(comp.numLayers).toBe(3);
    for (const index of out.value!.layers as number[]) {
      const position = prop(ae, index, 'ADBE Transform Group', 'ADBE Position');
      expect(position.numKeys).toBe(2);
      expect(position.temporalEases).toHaveLength(2);
      expect(comp.layer(index)!.outPoint).toBe(5);
    }
  });

  it('omits the subtitle layer and requires a title', async () => {
    const { ctx } = await payloadContext();
    expect(invoke(ctx, 'template.lower_third', { comp: 'Main', title: 'Solo' }).value!.layers).toHaveLength(2);
    expect(invoke(ctx, 'template.lower_third', { comp: 'Main' }).issue).toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('aemcpEaseArray', () => {
  it('sizes the array by propertyValueType: 2 for TwoD, 3 for ThreeD, 1 otherwise', async () => {
    const { ctx } = await payloadContext();
    const sizes: [keyof typeof PropertyValueType, number][] = [
      ['OneD', 1],
      ['TwoD', 2],
      ['TwoD_SPATIAL', 1],
      ['ThreeD', 3],
      ['ThreeD_SPATIAL', 1],
    ];
    for (const [type, size] of sizes) {
      const p = new MockProperty('p', 'ADBE Opacity', 0);
      p.propertyValueType = PropertyValueType[type];
      (ctx as unknown as Record<string, unknown>).probe = p;
      expect(vm.runInContext('aemcpEaseArray(probe, 0, 66.67).length', ctx), type).toBe(size);
    }
    (ctx as unknown as Record<string, unknown>).probe = new MockProperty('p', 'ADBE Opacity', 0);
    expect(vm.runInContext('aemcpEaseArray(probe, 0.5, 33.33)[0].influence', ctx)).toBe(33.33);
  });

  it('lower_third sets one ease per direction on the spatial Position', async () => {
    const { ctx, ae } = await payloadContext();
    const out = invoke(ctx, 'template.lower_third', { comp: 'Main', title: 'Jane Doe', duration: 5 });
    for (const index of out.value!.layers as number[]) {
      const position = prop(ae, index, 'ADBE Transform Group', 'ADBE Position');
      expect(position.temporalEases[0]!.inEase).toHaveLength(1);
      expect(position.temporalEases[0]!.outEase).toHaveLength(1);
    }
  });

  it('title_card sizes Opacity eases to 1 and Scale eases to 3', async () => {
    const { ctx, ae } = await payloadContext();
    invoke(ctx, 'template.title_card', { comp: 'Main', title: 'Opening' });
    expect(prop(ae, 2, 'ADBE Transform Group', 'ADBE Opacity').temporalEases[0]!.inEase).toHaveLength(1);
    expect(prop(ae, 2, 'ADBE Transform Group', 'ADBE Scale').temporalEases[0]!.inEase).toHaveLength(3);
  });
});
